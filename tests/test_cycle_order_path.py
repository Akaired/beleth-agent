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