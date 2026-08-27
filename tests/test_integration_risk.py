"""Integration test: run the risk check against the real Alpaca paper account state.

Marked `integration` — not part of the default fast unit run. Run explicitly with:
    pytest -m integration

Places no orders and calls no LLM: it reads equity / open positions / day P&L from the
paper account, builds an `AccountRiskState`, and checks that the risk check produces a
coherent verdict on a synthetic in-band candidate.
"""

import pytest

from app.alpaca_client import assert_paper_trading, get_trading_client
from app.config import get_settings, load_strategy_config
from app.options.spreads import SpreadCandidate
from app.risk_check import AccountRiskState, evaluate_candidate

pytestmark = pytest.mark.integration


@pytest.fixture(scope="module")
def trading_client():
    client = get_trading_client(get_settings())
    assert_paper_trading(client)  # never a live endpoint — constraint #1
    return client


@pytest.fixture(scope="module")
def account_state(trading_client) -> AccountRiskState:
    account = trading_client.get_account()
    positions = trading_client.get_all_positions()
    equity = float(account.equity)
    day_pnl = equity - float(account.last_equity)
    return AccountRiskState(
        equity=equity,
        open_positions=len(positions),
        day_pnl=round(day_pnl, 2),
        capital_at_risk=0.0,  # per-spread max loss arrives with the Supabase decision log
    )


def _in_band_candidate(equity: float) -> SpreadCandidate:
    """A well-formed 5-wide bull-put spread whose max loss is ~0.4% of equity — comfortably
    inside the 2% per-trade cap for a $100k paper account."""
    return SpreadCandidate(
        symbol="SPY",
        right="P",
        expiry="2026-09-26",
        dte=30,
        short_strike=440.0,
        long_strike=435.0,
        strike_width=5.0,
        delta_short=-0.20,
        credit=1.0,
        max_loss=400.0,
        breakeven=439.0,
        net_quote_width=0.4,
    )


def test_account_state_is_sane(account_state):
    assert account_state.equity > 0
    assert account_state.open_positions >= 0


def test_verdict_is_coherent_against_real_account(account_state):
    strategy = load_strategy_config()
    verdict = evaluate_candidate(_in_band_candidate(account_state.equity), account_state, strategy)

    # R4 always exposes the defined max loss, whatever the outcome.
    assert verdict.max_loss == 400.0
    assert {r.rule for r in verdict.results} == {"R4", "R6", "R7"}

    r6 = next(r for r in verdict.results if r.rule == "R6")
    assert r6.detail["equity"] == account_state.equity
    assert r6.detail["open_positions"] == account_state.open_positions

    # approved iff no rule rejected — the verdict must not contradict itself.
    assert verdict.approved == (verdict.rejections == [])

    # On a fresh paper account (no positions, no daily loss) the in-band candidate passes.
    if account_state.open_positions == 0 and account_state.day_pnl > -(
        account_state.equity * strategy["risk"]["daily_drawdown_stop_pct"] / 100
    ):
        assert verdict.approved is True
