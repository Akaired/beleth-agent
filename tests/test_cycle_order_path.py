"""Unit tests for the cycle script's order-path glue (`scripts/check_market_data.py`).

The production cycle is: gate-approved candidates -> LLM decision -> `_prepare_order` ->
persist decision -> submit. The LLM layer is tested in `test_decision.py`, the order
construction in `test_orders.py`; here it is the glue — that a trade decision becomes a
sendable plan on exactly its chosen candidate, and that every broken pre-condition fails
closed with a sentence that lands in the persisted summary instead of an order.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest

from scripts.check_market_data import _match_candidate, _prepare_order


_STRATEGY = {
    "risk": {"max_risk_per_trade_pct_of_equity": 2.0},
    "structure": {"credit_slippage_usd": 0.02},
}

# The production defaults after the 2026-08-28 review: dynamic entry slippage (half the
# candidate's bid/ask width, floored at 0.02) plus a no-trade above half the measured credit.
_PROD_STRATEGY = {
    "risk": {"max_risk_per_trade_pct_of_equity": 2.0},
    "structure": {
        "credit_slippage_usd": 0.02,
        "credit_slippage_frac_of_spread": 0.5,
        "max_slippage_frac_of_credit": 0.5,
    },
}


def _candidate(**overrides):
    from app.options.spreads import SpreadCandidate

    fields = dict(
        symbol="SPY",
        right="P",
        expiry="2026-09-18",
        dte=21,
        short_strike=440.0,
        long_strike=435.0,
        strike_width=5.0,
        delta_short=-0.20,
        credit=1.0,
        max_loss=400.0,
        breakeven=439.0,
        net_quote_width=0.4,
        short_symbol="SPY260918P00440000",
        long_symbol="SPY260918P00435000",
    )
    fields.update(overrides)
    return SpreadCandidate(**fields)


def test_match_candidate_finds_by_leg_symbols():
    candidates = [_candidate(), _candidate(right="C", long_strike=445.0)]
    chosen = candidates[0].as_dict()
    assert _match_candidate(candidates, chosen) is candidates[0]


def test_match_candidate_returns_none_for_an_unknown_or_missing_choice():
    candidates = [_candidate()]
    assert _match_candidate(candidates, None) is None
    impostor = dict(candidates[0].as_dict(), short_symbol="SPY260918P00999999")
    assert _match_candidate(candidates, impostor) is None


def test_prepare_order_builds_a_sendable_plan_from_the_chosen_candidate():
    candidate = _candidate()
    plan, note = _prepare_order(
        candidate.as_dict(),
        [candidate],
        equity=100_000.0,
        strategy_config=_STRATEGY,
    )
    assert plan is not None and note.startswith(" One multi-leg order")
    fields = plan["request"].to_request_fields()
    assert fields["qty"] == 5  # floor(2000 / 400)
    assert fields["limit_price"] == -0.98  # credit 1.00 - 0.02 slippage
    assert [leg["position_intent"] for leg in fields["legs"]] == ["sell_to_open", "buy_to_open"]
    assert plan["credit"] == 0.98 and plan["max_loss"] == 400.0
    assert plan["request"].client_order_id.startswith("beleth-")


def test_prepare_order_fails_closed_without_a_chosen_candidate():
    plan, note = _prepare_order(None, [], equity=100_000.0, strategy_config=_STRATEGY)
    assert plan is None
    assert "No order was sent" in note and "fail-closed" in note


def test_prepare_order_fails_closed_when_nothing_fits_the_cap():
    candidate = _candidate(max_loss=4_000.0, credit=1.0)  # cap $2,000 < $4,000
    plan, note = _prepare_order(
        candidate.as_dict(),
        [candidate],
        equity=100_000.0,
        strategy_config=_STRATEGY,
    )
    assert plan is None
    assert "cannot fit even one spread" in note


def test_prepare_order_fails_closed_without_a_fillable_credit():
    candidate = _candidate(credit=0.01)  # slippage 0.02 would eat the whole credit
    plan, note = _prepare_order(
        candidate.as_dict(),
        [candidate],
        equity=100_000.0,
        strategy_config=_STRATEGY,
    )
    assert plan is None
    assert "no fillable net-credit limit" in note


def test_prepare_order_fails_closed_on_a_structure_the_cycle_never_built():
    # A decision naming a candidate the cycle has no object for can never become an order.
    impostor = dict(_candidate().as_dict(), short_symbol="SPY260918P00999999")
    plan, note = _prepare_order(
        impostor, [_candidate()], equity=100_000.0, strategy_config=_STRATEGY
    )
    assert plan is None
    assert "did not carry a candidate this cycle built" in note


def test_prepare_order_with_prod_defaults_walks_the_limit_by_half_the_spread():
    # Real day-1 candidate: bid/ask width 0.10, measured credit 0.25. Dynamic slippage
    # 0.5 * 0.10 = 0.05 (> 0.02 floor); 0.05 is 20% of the credit, inside the 50% cap.
    candidate = _candidate(credit=0.25, max_loss=75.0, net_quote_width=0.10)
    plan, note = _prepare_order(
        candidate.as_dict(), [candidate], equity=100_000.0, strategy_config=_PROD_STRATEGY
    )
    assert plan is not None
    assert plan["request"].to_request_fields()["limit_price"] == -0.20  # 0.25 - 0.05
    assert "0.05 slippage off the 0.25 measured mid" in note


def test_prepare_order_with_prod_defaults_still_trades_the_0_14_spread():
    # width 0.14, credit 0.22 -> slippage 0.07 (32% of credit, inside the cap).
    candidate = _candidate(credit=0.22, max_loss=78.0, net_quote_width=0.14)
    plan, _ = _prepare_order(
        candidate.as_dict(), [candidate], equity=100_000.0, strategy_config=_PROD_STRATEGY
    )
    assert plan is not None
    assert plan["request"].to_request_fields()["limit_price"] == -0.15  # 0.22 - 0.07


def test_prepare_order_no_trades_when_slippage_would_eat_over_half_the_credit():
    # Real day-1 candidate: width 0.47, credit 0.305. Slippage 0.235 is 77% of the credit,
    # past the 50% cap -> explicit no-trade instead of an order that rests unfilled.
    candidate = _candidate(credit=0.305, max_loss=69.5, net_quote_width=0.47)
    plan, note = _prepare_order(
        candidate.as_dict(), [candidate], equity=100_000.0, strategy_config=_PROD_STRATEGY
    )
    assert plan is None
    assert "above the 50% cap" in note and "fail-closed" in note


def test_prepare_order_applies_the_r9_vix_taper_to_the_quantity():
    # Full budget: 2% of 100k = $2,000; $400 max loss -> 5 spreads. Taper to 50% -> 2.
    candidate = _candidate(max_loss=400.0)
    plan, _ = _prepare_order(
        candidate.as_dict(),
        [candidate],
        equity=100_000.0,
        strategy_config=_STRATEGY,
        risk_pct_multiplier=0.5,
    )
    assert plan is not None
    assert plan["request"].to_request_fields()["qty"] == 2  # floor(1000 / 400)


def test_prepare_order_no_trades_when_the_r9_taper_leaves_room_for_zero_spreads():
    # $1,900 max loss fits once at the full $2,000 budget but not at the tapered $1,000.
    candidate = _candidate(max_loss=1_900.0)
    plan, note = _prepare_order(
        candidate.as_dict(),
        [candidate],
        equity=100_000.0,
        strategy_config=_STRATEGY,
        risk_pct_multiplier=0.5,
    )
    assert plan is None
    assert "R9 VIX taper cut the per-trade budget to 50%" in note


def test_prepare_order_uses_the_candidate_dict_numbers_the_gate_saw():
    # as_dict rounds credit to 4dp and max_loss to 2dp; sizing and pricing must consume
    # exactly those numbers so the order matches what the gate and the LLM approved.
    candidate = _candidate(credit=1.0049, max_loss=400.49)
    chosen = candidate.as_dict()
    assert chosen["credit"] == 1.0049 and chosen["max_loss"] == 400.49
    plan, _ = _prepare_order(
        chosen, [candidate], equity=100_000.0, strategy_config=_STRATEGY
    )
    assert plan is not None
    assert plan["request"].to_request_fields()["qty"] == 4  # floor(2000 / 400.49)
    assert plan["credit"] == 0.98  # floor(1.0049 - 0.02) to the cent


# --- exit glue: dedup + closing plans --------------------------------------------------------------


class _FakeLeg:
    def __init__(self, symbol, intent):
        self.symbol = symbol
        self.position_intent = intent


class _FakeOrder:
    def __init__(self, *legs, client_order_id=None):
        self.legs = list(legs)
        self.client_order_id = client_order_id


_ENTRY_LEGS = [
    _FakeLeg("SPY260918P00440000", "sell_to_open"),
    _FakeLeg("SPY260918P00435000", "buy_to_open"),
]

_CLOSE_LEGS = [
    _FakeLeg("SPY260918P00440000", "buy_to_close"),
    _FakeLeg("SPY260918P00435000", "sell_to_close"),
]


def _triggered_exit():
    from datetime import date

    from app.exits import OpenSpread, evaluate_exit

    spread = OpenSpread(
        short_symbol="SPY260918P00440000",
        long_symbol="SPY260918P00435000",
        right="P",
        expiry=date(2026, 9, 18),
        short_strike=440.0,
        long_strike=435.0,
        qty=2,
        short_entry_price=1.20,
        long_entry_price=0.30,
    )
    # Mark 0.45 == the 50% profit target on entry credit 0.90 -> close.
    return evaluate_exit(
        spread,
        short_bid=0.80, short_ask=0.90,
        long_bid=0.35, long_ask=0.45,
        underlying_last=450.0,
        profit_target_pct=50,
        loss_multiple=2,
        exit_on_short_itm=True,
    )


_EXIT_STRATEGY = {"exit": {"close_slippage_usd": 0.05}}


def test_working_exit_leg_sets_collect_closing_orders_only():
    from scripts.check_market_data import working_exit_leg_sets

    orders = [_FakeOrder(*_ENTRY_LEGS), _FakeOrder(*_CLOSE_LEGS)]
    assert working_exit_leg_sets(orders) == {
        frozenset({"SPY260918P00440000", "SPY260918P00435000"})
    }
    assert working_exit_leg_sets([_FakeOrder(*_ENTRY_LEGS)]) == set()
    assert working_exit_leg_sets([]) == set()


def test_resting_entry_leg_sets_collect_opening_orders_only():
    from scripts.check_market_data import resting_entry_leg_sets, working_exit_leg_sets

    orders = [_FakeOrder(*_ENTRY_LEGS), _FakeOrder(*_CLOSE_LEGS)]
    # The two helpers are mirror filters over the same intents: an entry order blocks
    # new entries and never matches an exit dedup, and vice versa.
    assert resting_entry_leg_sets(orders) == {
        frozenset({"SPY260918P00440000", "SPY260918P00435000"})
    }
    assert resting_entry_leg_sets([_FakeOrder(*_CLOSE_LEGS)]) == set()
    assert resting_entry_leg_sets([]) == set()
    assert working_exit_leg_sets(orders) == {
        frozenset({"SPY260918P00440000", "SPY260918P00435000"})
    }
    assert working_exit_leg_sets([_FakeOrder(*_ENTRY_LEGS)]) == set()


def test_leg_set_helpers_fall_back_to_client_order_id_without_leg_intents():
    # Live incident 2026-08-28: the paper API listed resting orders but the cycle could
    # not read any leg position_intent, so the intent-only guard matched nothing and
    # entry orders stacked. Without readable intents, classification falls back to the
    # client order id the agent stamps on its own orders; a foreign unreadable order
    # blocks entries (fail-closed) but is never treated as a closing.
    from scripts.check_market_data import resting_entry_leg_sets, working_exit_leg_sets

    leg = _FakeLeg("SPY261009P00742000", "")
    agent_entry = _FakeOrder(leg, client_order_id="beleth-abc123")
    agent_close = _FakeOrder(leg, client_order_id="beleth-exit-def456")
    foreign = _FakeOrder(leg, client_order_id="manual-order-1")

    assert resting_entry_leg_sets([agent_entry]) == {
        frozenset({"SPY261009P00742000"})
    }
    assert resting_entry_leg_sets([agent_close]) == set()
    assert resting_entry_leg_sets([foreign]) == {frozenset({"SPY261009P00742000"})}
    assert working_exit_leg_sets([agent_close]) == {frozenset({"SPY261009P00742000"})}
    assert working_exit_leg_sets([agent_entry, foreign]) == set()


def test_resting_entry_leg_sets_block_an_order_reported_without_legs():
    # Worst-case serialization: an agent entry order arrives with no legs at all. It
    # must still block new entries — committed risk that cannot be inspected is risk.
    from scripts.check_market_data import resting_entry_leg_sets, working_exit_leg_sets

    entry = _FakeOrder(client_order_id="beleth-abc123")
    assert resting_entry_leg_sets([entry]) == {frozenset({"unreadable-legs"})}
    assert working_exit_leg_sets([entry]) == set()


def test_underlying_prices_are_fetched_per_spread_symbol(monkeypatch):
    # The short-leg ITM rule compares a spread against its OWN underlying: a QQQ cycle
    # must never measure an SPY spread against QQQ's price (it would misread ITM/OTM
    # and could trigger a spurious close).
    import scripts.check_market_data as cmd
    from datetime import date

    from app.exits import OpenSpread

    calls: list[str] = []

    def fake_fetch_last_price(client, symbol):
        calls.append(symbol)
        return {"SPY": 772.0, "QQQ": 720.0}[symbol]

    monkeypatch.setattr(cmd, "fetch_last_price", fake_fetch_last_price)

    def spread(occ):
        return OpenSpread(
            short_symbol=occ,
            long_symbol=occ.replace("00440000", "00435000"),
            right="P",
            expiry=date(2026, 9, 18),
            short_strike=440.0,
            long_strike=435.0,
            qty=1,
            short_entry_price=1.0,
            long_entry_price=0.1,
        )

    spreads = [spread("SPY260918P00440000"), spread("QQQ260918P00440000")]
    prices = cmd._underlying_prices_for_spreads(object(), spreads)
    assert prices == {"SPY": 772.0, "QQQ": 720.0}
    assert calls == ["SPY", "QQQ"]  # one call per distinct symbol, not per spread


def test_a_failed_underlying_quote_disables_only_the_itm_rule(monkeypatch):
    import scripts.check_market_data as cmd
    from datetime import date

    from app.exits import OpenSpread

    def failing_fetch_last_price(client, symbol):
        raise RuntimeError("quote feed down")

    monkeypatch.setattr(cmd, "fetch_last_price", failing_fetch_last_price)

    spread = OpenSpread(
        short_symbol="SPY260918P00440000",
        long_symbol="SPY260918P00435000",
        right="P",
        expiry=date(2026, 9, 18),
        short_strike=440.0,
        long_strike=435.0,
        qty=1,
        short_entry_price=1.0,
        long_entry_price=0.1,
    )
    prices = cmd._underlying_prices_for_spreads(object(), [spread])
    assert prices == {"SPY": None}  # the P/L rules still fire; only ITM is off


def test_prepare_closings_builds_one_plan_per_triggered_spread():
    from scripts.check_market_data import _prepare_closings

    plans, notes = _prepare_closings(
        [_triggered_exit()], working_leg_sets=set(), strategy_config=_EXIT_STRATEGY
    )
    assert len(plans) == 1
    plan = plans[0]
    fields = plan["request"].to_request_fields()
    assert fields["qty"] == 2  # the spread's own remaining quantity, not the risk cap
    assert fields["limit_price"] == 0.50  # mark 0.45 + 0.05 concession
    assert [leg["position_intent"] for leg in fields["legs"]] == [
        "buy_to_close", "sell_to_close"
    ]
    assert plan["exit_reason"] == "profit_target"
    assert plan["client_order_id"].startswith("beleth-exit-")
    assert "closing order" in notes and "is being sent" in notes


def test_prepare_closings_skips_a_spread_already_working():
    from scripts.check_market_data import _prepare_closings

    evaluation = _triggered_exit()
    spread = evaluation.spread
    working = {frozenset({spread.short_symbol, spread.long_symbol})}
    plans, notes = _prepare_closings(
        [evaluation], working_leg_sets=working, strategy_config=_EXIT_STRATEGY
    )
    assert plans == []
    assert "already working" in notes and "not duplicated" in notes


def test_prepare_closings_fails_closed_without_a_measurable_mark():
    from scripts.check_market_data import _prepare_closings

    from app.exits import evaluate_exit

    # The ITM rule fires with no usable leg quotes: the close is triggered but cannot
    # be priced, so no order is built and the fail-closed note lands in the summary.
    evaluation = evaluate_exit(
        _triggered_exit().spread,
        short_bid=None, short_ask=None,
        long_bid=None, long_ask=None,
        underlying_last=439.0,
        profit_target_pct=50,
        loss_multiple=2,
        exit_on_short_itm=True,
    )
    assert evaluation.triggered is True
    plans, notes = _prepare_closings(
        [evaluation], working_leg_sets=set(), strategy_config=_EXIT_STRATEGY
    )
    assert plans == []
    assert "no closing order" in notes and "fail-closed" in notes