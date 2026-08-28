"""Unit tests for app/exits.py — leg pairing back into spreads and the R5 exit rules.

The rule matrix pins the exact thresholds (a mark equal to a trigger fires) and the
fail-closed behaviour: an unmeasurable spread never fires the P/L rules, while the
short-leg ITM rule still protects with nothing but the underlying's last price.
"""

from datetime import date

import pytest

from app.exits import (
    RULE_LOSS_MULTIPLE,
    RULE_PROFIT_TARGET,
    RULE_SHORT_ITM,
    OpenSpread,
    evaluate_exit,
    exit_summary_sentences,
    pair_open_spreads,
)


def pos(symbol, qty, side, entry):
    """One Alpaca position dump as the pairing code sees it."""
    return {"symbol": symbol, "qty": qty, "side": side, "avg_entry_price": entry}


def make_spread(
    right="P",
    short_strike=440.0,
    long_strike=435.0,
    qty=1,
    short_entry=1.20,
    long_entry=0.30,
    short_symbol=None,
    long_symbol=None,
):
    """A spread with entry credit 0.90 and max loss (5 - 0.90) * 100 = $410."""
    if short_symbol is None:
        short_symbol = f"SPY260918{right}{int(short_strike * 1000):08d}"
    if long_symbol is None:
        long_symbol = f"SPY260918{right}{int(long_strike * 1000):08d}"
    return OpenSpread(
        short_symbol=short_symbol,
        long_symbol=long_symbol,
        right=right,
        expiry=date(2026, 9, 18),
        short_strike=short_strike,
        long_strike=long_strike,
        qty=qty,
        short_entry_price=short_entry,
        long_entry_price=long_entry,
    )


# --- pairing ---------------------------------------------------------------------------------


def test_put_legs_pair_into_one_spread():
    spreads, anomalies = pair_open_spreads(
        [
            pos("SPY260918P00440000", 1, "short", 1.20),
            pos("SPY260918P00435000", 1, "long", 0.30),
        ]
    )
    assert anomalies == []
    assert len(spreads) == 1
    s = spreads[0]
    assert s.right == "P"
    assert (s.short_strike, s.long_strike) == (440.0, 435.0)
    assert s.qty == 1
    assert s.entry_credit == pytest.approx(0.90)
    assert s.max_loss_per_spread == pytest.approx(410.0)


def test_call_spread_pairs_with_the_higher_strike():
    spreads, anomalies = pair_open_spreads(
        [
            pos("SPY260918C00440000", 1, "short", 0.80),
            pos("SPY260918C00445000", 1, "long", 0.20),
        ]
    )
    assert anomalies == []
    assert spreads[0].long_strike == 445.0


def test_same_strikes_merge_into_one_spread_with_combined_qty():
    spreads, anomalies = pair_open_spreads(
        [
            pos("SPY260918P00440000", 2, "short", 1.20),
            pos("SPY260918P00435000", 1, "long", 0.30),
            pos("SPY260918P00435000", 1, "long", 0.30),
        ]
    )
    assert anomalies == []
    assert len(spreads) == 1
    assert spreads[0].qty == 2


def test_short_pairs_with_the_nearest_protective_strike():
    # One short, two protective longs: the nearest strike pairs, the other long
    # stays unpaired — and an unpaired long is an anomaly by design.
    spreads, anomalies = pair_open_spreads(
        [
            pos("SPY260918P00440000", 1, "short", 1.20),
            pos("SPY260918P00430000", 1, "long", 0.10),
            pos("SPY260918P00435000", 1, "long", 0.30),
        ]
    )
    assert spreads[0].long_strike == 435.0
    assert len(anomalies) == 1
    assert "unpaired protective" in anomalies[0]["reason"]


def test_naked_short_is_an_anomaly():
    spreads, anomalies = pair_open_spreads(
        [pos("SPY260918P00440000", 1, "short", 1.20)]
    )
    assert spreads == []
    assert len(anomalies) == 1
    assert "naked exposure" in anomalies[0]["reason"]


def test_unpaired_long_is_an_anomaly():
    spreads, anomalies = pair_open_spreads(
        [pos("SPY260918P00435000", 1, "long", 0.30)]
    )
    assert spreads == []
    assert "unpaired protective" in anomalies[0]["reason"]


def test_non_option_position_is_an_anomaly():
    spreads, anomalies = pair_open_spreads(
        [pos("SPY", 100, "long", 450.0)]
    )
    assert spreads == []
    assert "not a parseable option position" in anomalies[0]["reason"]


def test_multi_contract_partial_pairing_leaves_the_remainder_naked():
    # 2 naked short contracts with only 1 protective long: 1 spread + 1 anomaly.
    spreads, anomalies = pair_open_spreads(
        [
            pos("SPY260918P00440000", 2, "short", 1.20),
            pos("SPY260918P00435000", 1, "long", 0.30),
        ]
    )
    assert len(spreads) == 1 and spreads[0].qty == 1
    assert len(anomalies) == 1 and "naked" in anomalies[0]["reason"]


# --- the R5 rules ------------------------------------------------------------------------------


def test_profit_target_fires_at_the_exact_threshold():
    # credit 0.90, 50% target -> close at 0.45; mark exactly 0.45 fires.
    e = evaluate_exit(
        make_spread(),
        short_bid=0.80, short_ask=0.90,  # short mid 0.85
        long_bid=0.35, long_ask=0.45,    # long mid 0.40 -> mark 0.45
        underlying_last=450.0,
        profit_target_pct=50,
        loss_multiple=2,
        exit_on_short_itm=True,
    )
    assert e.triggered and e.rule == RULE_PROFIT_TARGET
    assert e.detail["mark_to_close"] == 0.45
    assert e.detail["profit_target_price"] == 0.45


def test_between_target_and_loss_close_holds():
    # mark 0.46 is above the 0.45 target and far below the 1.80 loss close: hold.
    e = evaluate_exit(
        make_spread(),
        short_bid=0.80, short_ask=0.91,
        long_bid=0.35, long_ask=0.45,
        underlying_last=450.0,
        profit_target_pct=50,
        loss_multiple=2,
        exit_on_short_itm=True,
    )
    assert not e.triggered
    assert "holding" in e.reason


def test_loss_close_fires_at_the_exact_multiple():
    # mark 1.80 == 2x credit 0.90 fires; short strike NOT breached.
    e = evaluate_exit(
        make_spread(),
        short_bid=2.00, short_ask=2.10,   # short mid 2.05
        long_bid=0.20, long_ask=0.30,     # long mid 0.25 -> mark 1.80
        underlying_last=445.0,
        profit_target_pct=50,
        loss_multiple=2,
        exit_on_short_itm=True,
    )
    assert e.triggered and e.rule == RULE_LOSS_MULTIPLE


def test_short_leg_itm_fires_for_puts_below_the_strike():
    e = evaluate_exit(
        make_spread(),
        short_bid=1.00, short_ask=1.10,
        long_bid=0.40, long_ask=0.50,
        underlying_last=439.5,  # below the 440 short put strike
        profit_target_pct=50,
        loss_multiple=2,
        exit_on_short_itm=True,
    )
    assert e.triggered and e.rule == RULE_SHORT_ITM


def test_short_leg_itm_fires_for_calls_above_the_strike():
    e = evaluate_exit(
        make_spread(right="C", long_strike=445.0),
        short_bid=1.00, short_ask=1.10,
        long_bid=0.40, long_ask=0.50,
        underlying_last=440.5,  # above the 440 short call
        profit_target_pct=50,
        loss_multiple=2,
        exit_on_short_itm=True,
    )
    assert e.triggered and e.rule == RULE_SHORT_ITM


def test_short_leg_itm_takes_priority_over_the_loss_close():
    # Loss close also fires, but the defensive rule wins the reason.
    e = evaluate_exit(
        make_spread(),
        short_bid=2.00, short_ask=2.10,
        long_bid=0.20, long_ask=0.30,
        underlying_last=439.0,
        profit_target_pct=50,
        loss_multiple=2,
        exit_on_short_itm=True,
    )
    assert e.triggered and e.rule == RULE_SHORT_ITM
    assert RULE_LOSS_MULTIPLE in e.detail["rules_fired"]


def test_itm_rule_can_be_disabled():
    e = evaluate_exit(
        make_spread(),
        short_bid=1.00, short_ask=1.10,
        long_bid=0.40, long_ask=0.50,
        underlying_last=439.5,
        profit_target_pct=50,
        loss_multiple=2,
        exit_on_short_itm=False,
    )
    assert not e.triggered


def test_missing_leg_quotes_hold_but_itm_still_protects():
    # No usable quotes: the P/L rules cannot fire, the ITM rule still can.
    e = evaluate_exit(
        make_spread(),
        short_bid=None, short_ask=None,
        long_bid=None, long_ask=None,
        underlying_last=439.0,
        profit_target_pct=50,
        loss_multiple=2,
        exit_on_short_itm=True,
    )
    assert e.triggered and e.rule == RULE_SHORT_ITM
    assert e.detail["mark_to_close"] is None


def test_missing_quotes_without_itm_means_hold_with_an_incomplete_measurement():
    e = evaluate_exit(
        make_spread(),
        short_bid=None, short_ask=None,
        long_bid=None, long_ask=None,
        underlying_last=450.0,
        profit_target_pct=50,
        loss_multiple=2,
        exit_on_short_itm=True,
    )
    assert not e.triggered
    assert "incomplete" in e.reason


def test_zero_width_quotes_do_not_price_a_mark():
    # bid == ask == 0 is unusable, not a free spread.
    e = evaluate_exit(
        make_spread(),
        short_bid=0.0, short_ask=0.0,
        long_bid=0.0, long_ask=0.0,
        underlying_last=450.0,
        profit_target_pct=50,
        loss_multiple=2,
        exit_on_short_itm=True,
    )
    assert not e.triggered
    assert e.detail["mark_to_close"] is None


def test_unknown_entry_credit_disables_the_pl_rules():
    e = evaluate_exit(
        make_spread(short_entry=None),
        short_bid=2.00, short_ask=2.10,
        long_bid=0.20, long_ask=0.30,
        underlying_last=450.0,
        profit_target_pct=50,
        loss_multiple=2,
        exit_on_short_itm=True,
    )
    # A huge mark cannot fire the loss close when the entry credit is unknown.
    assert not e.triggered
    assert e.detail["profit_target_price"] is None
    assert e.detail["loss_close_price"] is None


# --- summary sentences --------------------------------------------------------------------------


def test_summary_is_empty_with_no_open_positions():
    assert exit_summary_sentences([], market_open=True) == ""


def test_summary_reports_held_positions():
    e = evaluate_exit(
        make_spread(),
        short_bid=0.80, short_ask=0.91,
        long_bid=0.35, long_ask=0.45,
        underlying_last=450.0,
        profit_target_pct=50,
        loss_multiple=2,
        exit_on_short_itm=True,
    )
    text = exit_summary_sentences([e], market_open=True)
    assert text.startswith("Open positions: 1 spread(s) checked against the exit rules")


def test_closed_market_says_the_close_waits():
    e = evaluate_exit(
        make_spread(),
        short_bid=1.00, short_ask=1.10,
        long_bid=0.40, long_ask=0.50,
        underlying_last=439.0,
        profit_target_pct=50,
        loss_multiple=2,
        exit_on_short_itm=True,
    )
    text = exit_summary_sentences([e], market_open=False)
    assert "the market is closed" in text


def test_summary_counts_triggered_and_held():
    held = evaluate_exit(
        make_spread(),
        short_bid=0.80, short_ask=0.91,
        long_bid=0.35, long_ask=0.45,
        underlying_last=450.0,
        profit_target_pct=50,
        loss_multiple=2,
        exit_on_short_itm=True,
    )
    fired = evaluate_exit(
        make_spread(short_strike=441.0, long_strike=436.0),
        short_bid=1.00, short_ask=1.10,
        long_bid=0.40, long_ask=0.50,
        underlying_last=440.0,
        profit_target_pct=50,
        loss_multiple=2,
        exit_on_short_itm=True,
    )
    text = exit_summary_sentences([held, fired], market_open=True)
    assert text.startswith("1 to close, 1 held within the rules. ")