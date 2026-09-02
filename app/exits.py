"""R5 — exit rules: open legs paired back into spreads, then checked against the exits.

Alpaca reports positions per contract, but the strategy's unit is the vertical spread its
two legs form. This module pairs the account's open option legs back into spreads (same
root, expiry and right; one short leg + one protective long leg), then runs the strategy's
R5 rules against each spread's live economics:

* **profit target** — close when the cost to buy the spread back has fallen to
  ``exit.profit_target_pct_of_max_credit`` percent of the entry credit (default 50%).
* **loss close** — close once the cost to close reaches ``exit.loss_close_credit_multiple``
  times the entry credit (default 2x).
* **short leg ITM** — close immediately when the short leg goes in the money
  (``exit.loss_close_on_short_leg_itm``); needs only the strike and the underlying, so it
  still protects the position when leg quotes are unusable.

Entry economics come from the account itself (``avg_entry_price`` per leg: what the short
was sold for minus what the long cost), so exit management never depends on the trades log
staying complete. Legs that do not pair — a lone short (naked exposure), an unpaired long,
a non-option position — are surfaced as anomalies and block new entries until resolved:
the account should only ever hold covered structures.

Everything here is pure; IO (positions, quotes) happens in the caller. Closing orders are
built and submitted by ``app/orders.py`` / the cycle script — always one ``mleg`` order
per spread closing both legs inside it, never a naked leg.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from typing import Any

from app.occ import InvalidOccSymbolError, OccSymbol, parse_occ_symbol

CONTRACT_MULTIPLIER = 100

RULE_PROFIT_TARGET = "profit_target"
RULE_LOSS_MULTIPLE = "loss_credit_multiple"
RULE_SHORT_ITM = "short_leg_itm"

# Reason order when several rules fire at once: defensive closes first.
_RULE_PRIORITY = (RULE_SHORT_ITM, RULE_LOSS_MULTIPLE, RULE_PROFIT_TARGET)

_RULE_LABEL = {
    RULE_PROFIT_TARGET: "profit target reached",
    RULE_LOSS_MULTIPLE: "loss close reached",
    RULE_SHORT_ITM: "short leg in the money",
}


@dataclass(frozen=True)
class OpenSpread:
    """An open vertical spread reconstructed from the account's individual legs."""

    short_symbol: str
    long_symbol: str
    right: str  # "C" | "P"
    expiry: date
    short_strike: float
    long_strike: float
    qty: int
    short_entry_price: float | None  # avg entry price per leg (positive numbers)
    long_entry_price: float | None

    @property
    def root(self) -> str:
        return parse_occ_symbol(self.short_symbol).root

    @property
    def strike_width(self) -> float:
        return abs(self.short_strike - self.long_strike)

    @property
    def entry_credit(self) -> float | None:
        """Filled net credit per share, or ``None`` when a leg's entry price is unknown —
        the P/L rules then cannot fire (the ITM rule still can)."""
        if self.short_entry_price is None or self.long_entry_price is None:
            return None
        return self.short_entry_price - self.long_entry_price

    @property
    def max_loss_per_spread(self) -> float | None:
        credit = self.entry_credit
        if credit is None:
            return None
        return (self.strike_width - credit) * 100

    def as_dict(self) -> dict[str, Any]:
        credit = self.entry_credit
        max_loss = self.max_loss_per_spread
        return {
            "symbol": self.root,
            "right": self.right,
            "expiry": self.expiry.isoformat(),
            "dte": self.expiry.toordinal() - date.today().toordinal(),
            "strikes": [self.short_strike, self.long_strike],
            "strike_width": self.strike_width,
            "qty": self.qty,
            "entry_credit": None if credit is None else round(credit, 4),
            "max_loss": None if max_loss is None else round(max_loss, 2),
            "short_symbol": self.short_symbol,
            "long_symbol": self.long_symbol,
        }


@dataclass(frozen=True)
class _Leg:
    occ: OccSymbol
    qty: int
    entry_price: float | None


def _leg_from_position(dump: Mapping[str, Any]) -> _Leg | None:
    """One Alpaca position dump as an option leg, or ``None`` when it is not a parseable
    option position (the caller surfaces it as an anomaly)."""
    try:
        occ = parse_occ_symbol(str(dump.get("symbol") or ""))
        qty = abs(int(float(dump.get("qty") or 0)))
    except (InvalidOccSymbolError, TypeError, ValueError):
        return None
    if qty < 1:
        return None
    entry = dump.get("avg_entry_price")
    try:
        entry_price = None if entry is None else float(entry)
    except (TypeError, ValueError):
        entry_price = None
    return _Leg(occ, qty, entry_price)


def pair_open_spreads(
    position_dumps: Sequence[Mapping[str, Any]],
) -> tuple[list[OpenSpread], list[dict[str, Any]]]:
    """Pair the account's open option legs back into the verticals they form.

    Shorts pair with the nearest-strike long on the protective side (lower strike for
    puts, higher for calls); multiple spreads on the same strikes merge into one
    ``OpenSpread`` with their combined quantity. Everything that does not pair comes back
    as an anomaly — the caller blocks new entries on those and says why.
    """
    shorts: list[_Leg] = []
    longs: list[_Leg] = []
    anomalies: list[dict[str, Any]] = []

    for dump in position_dumps:
        leg = _leg_from_position(dump)
        if leg is None:
            anomalies.append(
                {
                    "reason": "not a parseable option position",
                    "position": {"symbol": dump.get("symbol"), "qty": dump.get("qty")},
                }
            )
            continue
        if str(dump.get("side") or "").lower() == "short":
            shorts.append(leg)
        else:
            longs.append(_Leg(leg.occ, leg.qty, leg.entry_price))

    opened: dict[tuple[str, str], dict[str, Any]] = {}

    def _consume(short: _Leg, protective_side: str) -> None:
        """Pair as much of one short leg as possible; remainder becomes an anomaly."""
        remaining = short.qty
        while remaining > 0:
            pool = [
                (index, leg)
                for index, leg in enumerate(longs)
                if leg.qty > 0
                and (
                    leg.occ.strike < short.occ.strike
                    if protective_side == "P"
                    else leg.occ.strike > short.occ.strike
                )
            ]
            if not pool:
                anomalies.append(
                    {
                        "reason": "short leg without its protective long leg (naked exposure)",
                        "position": {"symbol": short.occ.raw, "qty": remaining},
                    }
                )
                return
            index, paired = min(pool, key=lambda item: abs(item[1].occ.strike - short.occ.strike))
            qty = min(remaining, paired.qty)
            key = (short.occ.raw, paired.occ.raw)
            entry = opened.setdefault(
                key,
                {
                    "short_symbol": short.occ.raw,
                    "long_symbol": paired.occ.raw,
                    "right": short.occ.right,
                    "expiry": short.occ.expiry,
                    "short_strike": short.occ.strike,
                    "long_strike": paired.occ.strike,
                    "qty": 0,
                    "short_entry_price": short.entry_price,
                    "long_entry_price": paired.entry_price,
                },
            )
            entry["qty"] += qty
            remaining -= qty
            # Decrement exactly the paired leg (two longs may share a symbol).
            longs[index] = _Leg(paired.occ, paired.qty - qty, paired.entry_price)

    for short in sorted(shorts, key=lambda leg: (leg.occ.expiry, leg.occ.strike)):
        _consume(short, short.occ.right)

    for leg in longs:
        if leg.qty > 0:
            anomalies.append(
                {
                    "reason": "long leg without a short leg to cover (unpaired protective)",
                    "position": {"symbol": leg.occ.raw, "qty": leg.qty},
                }
            )

    spreads = [
        OpenSpread(
            short_symbol=row["short_symbol"],
            long_symbol=row["long_symbol"],
            right=row["right"],
            expiry=row["expiry"],
            short_strike=row["short_strike"],
            long_strike=row["long_strike"],
            qty=row["qty"],
            short_entry_price=row["short_entry_price"],
            long_entry_price=row["long_entry_price"],
        )
        for row in sorted(opened.values(), key=lambda r: (r["expiry"], r["short_strike"]))
    ]
    return spreads, anomalies


@dataclass(frozen=True)
class ExitEvaluation:
    """R5's verdict on one open spread: hold, or the rule(s) that demand a close."""

    spread: OpenSpread
    triggered: bool
    rule: str | None  # most urgent rule that fired, None when holding
    reason: str  # names R5 and quotes every number it used
    detail: dict[str, Any]

    def as_dict(self) -> dict[str, Any]:
        return {
            "spread": self.spread.as_dict(),
            "triggered": self.triggered,
            "rule": self.rule,
            "reason": self.reason,
            "detail": self.detail,
        }


def evaluate_exit(
    spread: OpenSpread,
    *,
    short_bid: float | None,
    short_ask: float | None,
    long_bid: float | None,
    long_ask: float | None,
    underlying_last: float | None,
    profit_target_pct: float,
    loss_multiple: float,
    exit_on_short_itm: bool,
) -> ExitEvaluation:
    """Run the R5 rules on one open spread.

    The mark is the per-share cost to close (short mid minus long mid). The P/L rules
    need both the filled entry credit and a usable mark; when either is missing they do
    not fire — only the short-leg ITM rule (strike vs underlying) still protects. No
    measurement means no action, never a guess.
    """
    short_mid = _mid(short_bid, short_ask)
    long_mid = _mid(long_bid, long_ask)
    credit = spread.entry_credit
    mark = None if (short_mid is None or long_mid is None) else round(short_mid - long_mid, 4)
    # The debit that actually crosses the spread now: buy the short leg at its ask, sell
    # the long leg at its bid. The closing order is priced off this, not the mid — a
    # mid-priced close rests unfilled whenever the book is wide (deep-OTM, thin legs).
    marketable_close = (
        None
        if (short_ask is None or long_bid is None or short_ask <= 0 or long_bid <= 0)
        else round(short_ask - long_bid, 4)
    )

    detail: dict[str, Any] = {
        "qty": spread.qty,
        "entry_credit": None if credit is None else round(credit, 4),
        "mark_to_close": mark,
        "marketable_close": marketable_close,
        "short_leg_mid": short_mid,
        "long_leg_mid": long_mid,
        "underlying_last": underlying_last,
        "short_strike": spread.short_strike,
        "profit_target_price": None,
        "loss_close_price": None,
        "rules_fired": [],
    }
    if credit is not None and credit > 0:
        detail["profit_target_price"] = round(credit * (1 - profit_target_pct / 100), 4)
        detail["loss_close_price"] = round(credit * loss_multiple, 4)

    if mark is not None and credit is not None and credit > 0:
        if mark <= detail["profit_target_price"]:
            detail["rules_fired"].append(RULE_PROFIT_TARGET)
        if mark >= detail["loss_close_price"]:
            detail["rules_fired"].append(RULE_LOSS_MULTIPLE)
    if exit_on_short_itm and underlying_last is not None:
        itm = (
            underlying_last < spread.short_strike
            if spread.right == "P"
            else underlying_last > spread.short_strike
        )
        if itm:
            detail["rules_fired"].append(RULE_SHORT_ITM)

    fired = detail["rules_fired"]
    structure = (
        f"{spread.qty} x {spread.right} {spread.short_strike:.2f}/"
        f"{spread.long_strike:.2f} exp {spread.expiry.isoformat()}"
    )
    if not fired:
        if mark is not None and credit is not None and credit > 0 and underlying_last is not None:
            return ExitEvaluation(
                spread,
                False,
                None,
                f"R5 (exit): holding {structure} — cost to close {mark:.2f} vs entry credit "
                f"{credit:.2f} (target {detail['profit_target_price']:.2f}, loss close "
                f"{detail['loss_close_price']:.2f}); short strike {spread.short_strike:.2f} "
                f"vs underlying {underlying_last:.2f}.",
                detail,
            )
        return ExitEvaluation(
            spread,
            False,
            None,
            f"R5 (exit): holding {structure} — live measurement incomplete, holding until it is not.",
            detail,
        )

    rule = next(r for r in _RULE_PRIORITY if r in fired)
    numbers = []
    if mark is not None and credit is not None:
        numbers.append(f"cost to close {mark:.2f} vs entry credit {credit:.2f}")
    if underlying_last is not None:
        numbers.append(
            f"underlying {underlying_last:.2f} vs short strike {spread.short_strike:.2f}"
        )
    reason = (
        f"R5 (exit): closing {structure} — {_RULE_LABEL[rule]}"
        + (f" ({'; '.join(numbers)})" if numbers else "")
        + "."
    )
    return ExitEvaluation(spread, True, rule, reason, detail)


def exit_summary_sentences(evaluations: list[ExitEvaluation], *, market_open: bool) -> str:
    """The open-positions paragraph a cycle prepends to its summary: what is open, what
    fires, and — market closed — that the close waits for the next open."""
    if not evaluations:
        return ""
    triggered = [e for e in evaluations if e.triggered]
    if not triggered:
        return (
            f"Open positions: {len(evaluations)} spread(s) checked against the exit rules, "
            "all within them. "
        )
    held = len(evaluations) - len(triggered)
    sentences = []
    for e in triggered:
        sentence = e.reason.rstrip(".")
        if not market_open:
            sentence += " — the market is closed, so the closing order waits for the next open"
        sentences.append(sentence + ".")
    head = f"{len(triggered)} to close, {held} held within the rules. " if held else ""
    return head + " ".join(sentences) + " "


def _mid(bid: float | None, ask: float | None) -> float | None:
    if bid is None or ask is None or bid <= 0 or ask <= 0:
        return None
    return round((bid + ask) / 2, 4)
