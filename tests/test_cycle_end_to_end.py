"""End-to-end tests for the trading cycle.

`scripts/check_market_data.py` is what the resident runner executes for every symbol,
every cycle, in production — it is the agent. It had no test that ran it whole: only its
extracted helpers were covered, and `main()` itself, where the ordering guarantees live,
was not exercised at all.

These drive `main()` with fake edges (the Alpaca clients, the VIX fetch, the LLM
transport, the Supabase funnel) and real everything-in-between, and assert the
invariants that must survive any change to the cycle:

* no order is ever submitted before the decision row is persisted;
* an unconfigured Supabase means zero submissions, whatever the decision was;
* exits are mechanical and are sent before any new entry;
* the exit code and the shape of stdout do not move.
"""

from __future__ import annotations

import json
from datetime import date, timedelta

import pytest
import yaml

from app import config as app_config
from app import persistence
from app.config import STRATEGY_CONFIG_PATH, get_settings
from tests.cycle_fakes import (
    FakeOptionClient,
    FakeQuote,
    FakeStockClient,
    FakeSupabase,
    FakeTradingClient,
    fred_csv,
    llm_response,
    occ,
    position,
    put_credit_chain,
    scripted_llm,
)

TODAY = date.today()
DTES = [7, 14, 21, 30, 45]


@pytest.fixture
def strategy_file(tmp_path):
    """The shipped strategy config, with the macro calendar pointed at an empty file.

    The real `config/macro_events.yaml` is hand-maintained for a date window, so a test
    that reads it passes or fails depending on the day it runs — and it did, once
    Nonfarm Payrolls came inside the R3 block window and every tenor went dark. Every
    other parameter stays as shipped, so these tests exercise the values the agent
    actually runs on; only the calendar is made deterministic. `calendar_events` puts
    events back for the test that checks the gate bites.
    """
    events = tmp_path / "macro_events.yaml"
    events.write_text("events: []\n")
    strategy = yaml.safe_load(STRATEGY_CONFIG_PATH.read_text())
    strategy["macro_calendar"]["events_file"] = str(events)
    path = tmp_path / "strategy.yaml"
    path.write_text(yaml.safe_dump(strategy, sort_keys=False))
    return path, events


@pytest.fixture
def cycle(monkeypatch, strategy_file):
    """Wire every edge to a fake and hand back a handle for tuning them.

    The seams are attributes of modules the cycle does not own — `app.config`,
    `app.alpaca_client`, `app.market.vix`, `app.decision`, `app.persistence` — so they
    keep working when the cycle's own functions move.
    """
    import scripts.check_market_data as cmd
    from app import alpaca_client, decision
    from app.market import vix

    monkeypatch.setenv("ALPACA_API_KEY", "k")
    monkeypatch.setenv("ALPACA_SECRET_KEY", "s")
    monkeypatch.setenv("OPENROUTER_KEY", "o")
    monkeypatch.setenv("SUPABASE_URL", "https://fake.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")
    monkeypatch.delenv("LLM_FALLBACK_KEY", raising=False)
    get_settings.cache_clear()

    strategy_path, events_path = strategy_file
    monkeypatch.setattr(app_config, "STRATEGY_CONFIG_PATH", strategy_path)

    handle = _Cycle(cmd, monkeypatch)
    handle.events_path = events_path
    monkeypatch.setattr(alpaca_client, "TradingClient", lambda **_kw: handle.trading)
    monkeypatch.setattr(alpaca_client, "OptionHistoricalDataClient", lambda **_kw: handle.options)
    monkeypatch.setattr(alpaca_client, "StockHistoricalDataClient", lambda **_kw: handle.stocks)
    monkeypatch.setattr(vix, "_http_get", lambda _url: handle.vix_csv)
    monkeypatch.setattr(decision, "_default_complete", handle.llm)
    monkeypatch.setattr(persistence, "_request", handle.supabase)
    monkeypatch.setattr("sys.argv", ["check_market_data.py", "SPY"])

    yield handle
    get_settings.cache_clear()


class _Cycle:
    def __init__(self, cmd, monkeypatch) -> None:
        self.cmd = cmd
        self._monkeypatch = monkeypatch
        self.chain = put_credit_chain(today=TODAY, dtes=DTES)
        self.trading = FakeTradingClient()
        self.options = FakeOptionClient(self.chain)
        self.stocks = FakeStockClient()
        self.vix_csv = fred_csv()
        self.supabase = FakeSupabase()
        self.llm = scripted_llm(llm_response(action="no_trade"))

    def set_llm(self, complete_fn) -> None:
        """Retarget the LLM transport. `_default_complete` is resolved at call time
        (app/decision.py), not bound as a default argument, so patching the module
        attribute reaches the running cycle."""
        from app import decision

        self.llm = complete_fn
        self._monkeypatch.setattr(decision, "_default_complete", complete_fn)

    def run(self) -> int:
        return self.cmd.main()


# ── the invariants ───────────────────────────────────────────────────────────


def test_a_quiet_cycle_persists_a_decision_and_sends_nothing(cycle):
    assert cycle.run() == 0
    assert cycle.trading.submitted == []
    assert len(cycle.supabase.rows("decisions")) == 1


def test_stdout_is_the_evidence_package_as_json(cycle, capsys):
    assert cycle.run() == 0
    out = capsys.readouterr().out
    package = json.loads(out[out.index("{") : out.rindex("}") + 1])
    assert package["underlying"]["symbol"] == "SPY"
    for key in ("as_of", "market_open", "vix", "vrp", "calendar", "candidates", "account"):
        assert key in package, key


def test_no_order_is_submitted_before_the_decision_row_is_written(cycle):
    """The ordering guarantee the whole persistence path exists for: an order live at the
    broker with no decision row is the one state this project must never produce."""
    cycle.set_llm(scripted_llm(llm_response(action="trade", candidate_index=0)))

    submitted_at: list[int] = []
    original = cycle.trading.submit_order

    def watched(request):
        submitted_at.append(len(cycle.supabase.calls))
        return original(request)

    cycle.trading.submit_order = watched
    assert cycle.run() == 0

    decision_at = next(i for i, c in enumerate(cycle.supabase.calls) if c.table == "decisions")
    assert submitted_at, "expected the cycle to submit an entry order"
    for at in submitted_at:
        assert at > decision_at, "an order was submitted before the decision was persisted"


def test_supabase_unconfigured_means_no_order_at_all(cycle, monkeypatch, capsys):
    """Fail-closed: with nowhere to log the decision, nothing may reach the broker."""
    monkeypatch.setenv("SUPABASE_URL", "")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "")
    get_settings.cache_clear()
    cycle.set_llm(scripted_llm(llm_response(action="trade", candidate_index=0)))

    assert cycle.run() == 0
    assert cycle.trading.submitted == []
    assert cycle.supabase.calls == []
    assert "no order is sent" in capsys.readouterr().err


def test_a_failed_decision_write_stops_the_cycle_with_exit_1(cycle, capsys):
    cycle.supabase.fail_on_table = "decisions"
    assert cycle.run() == 1
    assert cycle.trading.submitted == []
    assert "persistence failed" in capsys.readouterr().err


def test_the_market_being_closed_never_calls_the_llm_and_never_trades(cycle):
    cycle.trading = FakeTradingClient(market_open=False)

    def explode(*_a, **_k):
        raise AssertionError("the LLM must not be consulted while the market is closed")

    cycle.set_llm(explode)

    assert cycle.run() == 0
    assert cycle.trading.submitted == []
    rows = cycle.supabase.rows("decisions")
    assert rows and rows[0]["decision_source"] == "risk_engine"
    assert rows[0]["action"] == "no_trade"


def test_a_triggered_exit_is_sent_before_any_new_entry(cycle):
    """Exits are risk reduction and are mechanical — never LLM-gated, never queued behind
    an entry."""
    expiry = TODAY.replace()
    short = occ(expiry, "P", 440)
    long_ = occ(expiry, "P", 435)
    cycle.trading = FakeTradingClient(
        positions=[
            position(short, -2, 2.00, "short"),
            position(long_, 2, 0.50, "long"),
        ]
    )
    # Both legs cheap to buy back: the profit target has been reached.
    cycle.options = FakeOptionClient(
        cycle.chain,
        quotes={short: FakeQuote(0.20, 0.25), long_: FakeQuote(0.02, 0.05)},
    )

    assert cycle.run() == 0
    exits = [r for r in cycle.supabase.rows("trades") if r.get("kind") == "exit"]
    assert exits, "expected a closing order to be persisted"
    assert cycle.trading.submitted, "expected a closing order to be submitted"


def test_an_unreadable_order_book_blocks_new_entries(cycle):
    """Fail-closed: a resting entry order the cycle cannot see would otherwise be
    stacked on every few minutes."""
    cycle.trading = FakeTradingClient(orders_error=RuntimeError("alpaca 500"))
    cycle.set_llm(scripted_llm(llm_response(action="trade", candidate_index=0)))

    assert cycle.run() == 0
    assert cycle.trading.submitted == []
    checks = cycle.supabase.rows("risk_checks")
    assert any("open orders could not be listed" in str(c.get("reason", "")) for c in checks), (
        "expected a visible rejection row naming the unreadable order book"
    )


def test_every_write_the_cycle_makes_lands_in_the_expected_tables(cycle):
    assert cycle.run() == 0
    tables = [t for t in cycle.supabase.tables() if t]
    for expected in ("decisions", "risk_checks", "agent_status"):
        assert expected in tables, expected


def test_a_macro_event_inside_the_window_blocks_every_tenor(cycle):
    """R3. The gate is normally made inert for these tests, so this is the one that
    proves it bites: an event two days out and no candidate is even built."""
    cycle.events_path.write_text(
        "events:\n"
        f"  - name: Test Payrolls\n"
        f"    datetime_et: '{(TODAY + timedelta(days=2)).isoformat()} 08:30'\n"
        "    importance: major\n"
        "    source: test\n"
    )
    cycle.set_llm(_never_called)

    assert cycle.run() == 0
    assert cycle.trading.submitted == []
    rows = cycle.supabase.rows("decisions")
    assert rows and rows[0]["action"] == "no_trade"
    assert "macro calendar blocks" in rows[0]["summary"]
    assert rows[0]["evidence"]["candidates"] == []


def _never_called(*_args, **_kwargs):
    raise AssertionError("the LLM must not be consulted with no approved candidate")
