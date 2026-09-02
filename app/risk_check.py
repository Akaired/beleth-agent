"""Explicit pre-trade risk check — the gate every order must pass before it can reach Alpaca.

*Every* order passes an explicit risk check whose rejections are logged and surfaced with the
same prominence as executed trades. The order path is wired *through* this gate — never around
it.

Each rule produces an explicit pass/fail verdict with a human-readable reason that names the
rule id and quotes the numbers it used, so a dashboard reader can see exactly why a candidate
was approved or rejected. The module is pure — all IO (reading the account and open positions
from Alpaca) happens in the caller, which passes the numbers in via ``AccountRiskState`` (see
``scripts/check_risk.py``).

Rules implemented here (see ``docs/strategy.md``):

* **R4 — defined risk only.** ``app/options/spreads.py`` already computes the candidate's
  maximum loss and breakeven; this check *exposes* them on the verdict (top-level ``max_loss``
  / ``breakeven`` and in the R4 reason) so the number is shown *before* an order is submitted —
  including when the check approves. A candidate whose max loss cannot be computed (missing leg
  quotes) is rejected: undefined risk fails closed.
* **R6 — sizing.** The candidate's own max loss must not exceed
  ``risk.max_risk_per_trade_pct_of_equity`` percent of account equity, and the number of open
  positions must stay below ``risk.max_concurrent_positions``. Capital already at risk across
  open positions is surfaced here for transparency; it is gated separately by the account-level
  ``apply_aggregate_cap`` (R11).
* **R7 — daily stop.** If the day's drawdown has already reached
  ``risk.daily_drawdown_stop_pct`` percent of equity, every new candidate is rejected
  regardless of the other rules, and that is stated as the reason.

Two further gates run *after* the per-candidate rules, in the caller, because they are
properties of the whole account rather than of one candidate — both emit their own visible
rejection row and both ship inert until configured:

* **R10 — entry blocked by account state** (``block_entries``): a resting entry order, unpaired
  legs, an unreadable order book. Kept distinct from R6 (sizing) so the dashboard can tell an
  account-state block from a real sizing failure.
* **R11 — aggregate risk cap** (``apply_aggregate_cap``): committed risk across open positions
  plus this candidate's max loss must stay within ``risk.max_aggregate_risk_pct_of_equity``.

R5 (exit rules for open positions) lives in ``app/exits.py`` — it manages positions the order
path has already opened, so it is evaluated in the cycle script, not in this pre-trade gate.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Any

from app.options.contracts import CONTRACT_MULTIPLIER
from app.options.spreads import SpreadCandidate


@dataclass(frozen=True)
class AccountRiskState:
    """Real account state the risk check reasons over. The caller reads this from Alpaca.

    ``day_pnl`` is signed (``equity - last_equity``): negative means down on the day.
    ``capital_at_risk`` is the summed known max loss across open defined-risk positions; it is
    ``0.0`` until the decision log (Supabase) can supply per-spread max loss,
    since an Alpaca ``Position`` on its own does not carry it.
    """

    equity: float
    open_positions: int
    day_pnl: float
    capital_at_risk: float = 0.0


@dataclass(frozen=True)
class RuleResult:
    rule: str  # "R4" | "R6" | "R7" | "R10" (block_entries) | "R11" (apply_aggregate_cap)
    passed: bool
    reason: str  # human-readable, names the rule and quotes the numbers used
    detail: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {
            "rule": self.rule,
            "passed": self.passed,
            "reason": self.reason,
            "detail": self.detail,
        }


@dataclass(frozen=True)
class RiskVerdict:
    approved: bool
    max_loss: float | None  # R4: shown explicitly even on approval
    breakeven: float | None
    results: list[RuleResult]
    candidate: dict[str, Any]

    @property
    def rejections(self) -> list[RuleResult]:
        return [r for r in self.results if not r.passed]

    def as_dict(self) -> dict[str, Any]:
        return {
            "approved": self.approved,
            "max_loss": self.max_loss,
            "breakeven": self.breakeven,
            "rejected_by": [r.rule for r in self.rejections],
            "results": [r.as_dict() for r in self.results],
            "candidate": self.candidate,
        }


def _usd(x: float | None) -> str:
    return "unknown" if x is None else f"${x:,.2f}"


def check_r4(candidate: SpreadCandidate) -> RuleResult:
    """Defined risk only: max loss must be computed and structurally bounded, and is shown
    on the verdict whatever the outcome."""
    max_loss = candidate.max_loss
    breakeven = candidate.breakeven
    # (width - credit) * multiplier, and credit >= 0, so width * multiplier bounds it.
    structural_cap = candidate.strike_width * CONTRACT_MULTIPLIER

    if max_loss is None:
        return RuleResult(
            "R4",
            False,
            "R4 (defined risk only): maximum loss cannot be computed for this candidate "
            "(missing leg quotes). Undefined risk is rejected — the check fails closed.",
            {"max_loss": None, "strike_width": candidate.strike_width},
        )

    if max_loss <= 0 or max_loss > structural_cap:
        return RuleResult(
            "R4",
            False,
            f"R4 (defined risk only): computed max loss {_usd(max_loss)} falls outside the "
            f"structural bound (0, {_usd(structural_cap)}] for a "
            f"{candidate.strike_width:.2f}-wide vertical — the structure is malformed.",
            {
                "max_loss": max_loss,
                "structural_cap_usd": structural_cap,
                "strike_width": candidate.strike_width,
            },
        )

    return RuleResult(
        "R4",
        True,
        f"R4 (defined risk only): max loss is defined and bounded at {_usd(max_loss)}, "
        f"breakeven {breakeven:.2f}, within the {_usd(structural_cap)} structural cap for a "
        f"{candidate.strike_width:.2f}-wide vertical.",
        {
            "max_loss": max_loss,
            "breakeven": breakeven,
            "structural_cap_usd": structural_cap,
            "strike_width": candidate.strike_width,
        },
    )


def check_r6(
    candidate: SpreadCandidate,
    state: AccountRiskState,
    *,
    max_risk_per_trade_pct: float,
    max_concurrent_positions: int,
) -> RuleResult:
    """Sizing: per-trade risk within the configured percent of equity, and open-position
    count below the configured maximum. Both limits come from ``config/strategy.yaml``."""
    max_loss = candidate.max_loss
    per_trade_cap = state.equity * max_risk_per_trade_pct / 100
    pct_of_equity = (
        max_loss / state.equity * 100 if max_loss is not None and state.equity > 0 else None
    )

    detail = {
        "candidate_max_loss": max_loss,
        "candidate_pct_of_equity": None if pct_of_equity is None else round(pct_of_equity, 4),
        "per_trade_cap_usd": round(per_trade_cap, 2),
        "per_trade_cap_pct": max_risk_per_trade_pct,
        "equity": state.equity,
        "open_positions": state.open_positions,
        "max_concurrent_positions": max_concurrent_positions,
        "capital_at_risk_current": state.capital_at_risk,
    }

    problems: list[str] = []
    if max_loss is None:
        problems.append("candidate max loss is unknown, so it cannot be sized")
    elif max_loss > per_trade_cap:
        problems.append(
            f"candidate risk {_usd(max_loss)} ({pct_of_equity:.2f}% of equity) exceeds the "
            f"{max_risk_per_trade_pct:.2f}% per-trade cap ({_usd(per_trade_cap)})"
        )
    if state.open_positions >= max_concurrent_positions:
        problems.append(
            f"{state.open_positions} positions already open, at or above the "
            f"{max_concurrent_positions}-position limit"
        )

    if problems:
        return RuleResult("R6", False, "R6 (sizing): " + "; ".join(problems) + ".", detail)

    at_risk_note = (
        f"; {_usd(state.capital_at_risk)} already at risk across open positions"
        if state.capital_at_risk
        else ""
    )
    return RuleResult(
        "R6",
        True,
        f"R6 (sizing): candidate risk {_usd(max_loss)} is {pct_of_equity:.2f}% of equity, "
        f"within the {max_risk_per_trade_pct:.2f}% cap ({_usd(per_trade_cap)}); "
        f"{state.open_positions} of {max_concurrent_positions} position slots used"
        f"{at_risk_note}.",
        detail,
    )


def check_r7(
    state: AccountRiskState,
    *,
    daily_drawdown_stop_pct: float,
) -> RuleResult:
    """Daily stop: once the day's drawdown reaches the configured percent of equity, no new
    position is opened for the rest of the day. Reaching the threshold exactly trips it."""
    stop_usd = state.equity * daily_drawdown_stop_pct / 100
    drawdown_usd = max(0.0, -state.day_pnl)  # positive magnitude; 0 when flat or up
    drawdown_pct = drawdown_usd / state.equity * 100 if state.equity > 0 else 0.0

    detail = {
        "day_pnl": state.day_pnl,
        "drawdown_usd": round(drawdown_usd, 2),
        "drawdown_pct": round(drawdown_pct, 4),
        "stop_pct": daily_drawdown_stop_pct,
        "stop_usd": round(stop_usd, 2),
        "equity": state.equity,
    }

    tripped = stop_usd > 0 and drawdown_usd >= stop_usd
    if tripped:
        return RuleResult(
            "R7",
            False,
            f"R7 (daily stop): today's drawdown {_usd(drawdown_usd)} ({drawdown_pct:.2f}% of "
            f"equity) has reached the {daily_drawdown_stop_pct:.2f}% daily stop "
            f"({_usd(stop_usd)}) — no new position is opened for the rest of the day, "
            "regardless of the other rules.",
            detail,
        )

    return RuleResult(
        "R7",
        True,
        f"R7 (daily stop): today's drawdown {_usd(drawdown_usd)} ({drawdown_pct:.2f}% of "
        f"equity) is within the {daily_drawdown_stop_pct:.2f}% daily stop ({_usd(stop_usd)}).",
        detail,
    )


def evaluate_candidate(
    candidate: SpreadCandidate,
    state: AccountRiskState,
    strategy_config: dict[str, Any],
) -> RiskVerdict:
    """Run R4, R6 and R7 against one candidate. Approved only if every rule passes; R7
    failing on its own is enough to reject (its reason says so explicitly)."""
    risk_cfg = strategy_config["risk"]
    results = [
        check_r4(candidate),
        check_r6(
            candidate,
            state,
            max_risk_per_trade_pct=risk_cfg["max_risk_per_trade_pct_of_equity"],
            max_concurrent_positions=risk_cfg["max_concurrent_positions"],
        ),
        check_r7(state, daily_drawdown_stop_pct=risk_cfg["daily_drawdown_stop_pct"]),
    ]
    return RiskVerdict(
        approved=all(r.passed for r in results),
        max_loss=candidate.max_loss,
        breakeven=candidate.breakeven,
        results=results,
        candidate=candidate.as_dict(),
    )


def evaluate_candidates(
    candidates: list[SpreadCandidate],
    state: AccountRiskState,
    strategy_config: dict[str, Any],
) -> list[RiskVerdict]:
    return [evaluate_candidate(c, state, strategy_config) for c in candidates]


def block_entries(verdicts: list[RiskVerdict], blocks: list[dict[str, str]]) -> list[RiskVerdict]:
    """Reject every currently-approved verdict with one extra **R10** row naming the
    account-state problems that block new entries — a resting entry order, unpaired
    option legs, open spreads whose risk cannot be computed, an unreadable order book.
    Exits are untouched: closing risk is never gated by this.

    R10 is deliberately its own rule id, kept distinct from R6 (sizing) so an
    account-state block ("an entry order is already resting") reads differently from a
    real sizing or position-count failure in the dashboard. Each ``block`` is
    ``{"kind": ..., "reason": ...}``; ``kind`` is one of
    ``resting_entry_order`` / ``position_anomaly`` / ``open_orders_unreadable`` and is
    kept in ``detail["kinds"]`` so a reader can tell them apart.

    The caller (``scripts/check_market_data.py``) supplies the blocks it found while
    pairing open positions; the check stays pure and the rejection lands in the same
    ``risk_checks`` rows as every other rule (constraint #3 — visible, not silent).
    """
    if not blocks:
        return list(verdicts)
    reasons = [b["reason"] for b in blocks]
    kinds = sorted({b["kind"] for b in blocks})
    reason_text = "R10 (entry blocked by account state): " + "; ".join(reasons) + "."
    detail = {"kinds": kinds, "reasons": list(reasons)}
    out: list[RiskVerdict] = []
    for verdict in verdicts:
        if not verdict.approved:
            out.append(verdict)
            continue
        out.append(
            replace(
                verdict,
                results=[
                    *verdict.results,
                    RuleResult("R10", False, reason_text, dict(detail)),
                ],
                approved=False,
            )
        )
    return out


def apply_aggregate_cap(
    verdicts: list[RiskVerdict],
    state: AccountRiskState,
    *,
    max_aggregate_risk_pct: float,
) -> list[RiskVerdict]:
    """Second-stage, account-level gate (**R11**): reject any still-approved verdict
    whose own max loss, added to the capital already at risk across open positions,
    would breach ``risk.max_aggregate_risk_pct_of_equity`` percent of equity.

    Like ``block_entries`` this runs *after* the per-candidate rules and emits one extra
    visible rejection row — it is not a structural property of the candidate but of the
    whole book, so it does not belong inside ``evaluate_candidate``. It is a conservative
    floor: the projection adds a single spread's max loss (quantity is sized down later
    in ``compute_quantity``), so a pass here never *under*-counts committed risk.

    ``max_aggregate_risk_pct`` of 0 disables the cap — the feature ships inert until the
    value is set. A verdict whose max loss is unknown is left to R4 (which already fails
    it); R11 does not double-punish.
    """
    if max_aggregate_risk_pct <= 0:
        return list(verdicts)
    cap_usd = state.equity * max_aggregate_risk_pct / 100
    out: list[RiskVerdict] = []
    for verdict in verdicts:
        if not verdict.approved or verdict.max_loss is None:
            out.append(verdict)
            continue
        projected = state.capital_at_risk + verdict.max_loss
        if projected <= cap_usd:
            out.append(verdict)
            continue
        detail = {
            "candidate_max_loss": verdict.max_loss,
            "capital_at_risk_current": state.capital_at_risk,
            "projected_capital_at_risk": round(projected, 2),
            "aggregate_cap_usd": round(cap_usd, 2),
            "aggregate_cap_pct": max_aggregate_risk_pct,
            "equity": state.equity,
        }
        out.append(
            replace(
                verdict,
                results=[
                    *verdict.results,
                    RuleResult(
                        "R11",
                        False,
                        f"R11 (aggregate risk cap): adding this spread's max loss "
                        f"{_usd(verdict.max_loss)} to {_usd(state.capital_at_risk)} "
                        f"already at risk would reach {_usd(projected)}, past the "
                        f"{max_aggregate_risk_pct:.2f}% aggregate cap ({_usd(cap_usd)}) "
                        "— no new entry until open risk comes down.",
                        detail,
                    ),
                ],
                approved=False,
            )
        )
    return out


# --- R9: VIX-regime size taper -------------------------------------------------------------
#
# A *sizing* input, not a per-candidate structural rule: it scales the per-trade risk budget
# by a 0.0-1.0 multiplier read off the VIX's own 1-year percentile, and hard-blocks new
# entries only in the extreme-complacency tail. Prefer the taper to a block (strategy note A5:
# low VIX is a weak timing signal; strategy note C5: on a ~5-day window a hard block can mean
# zero trades all week). Historical base rates that motivate keeping the block deep and the taper
# gentle (VIX close, 1990-2026, 252d lookback): percentile < 25 on ~33% of days and usually a
# multi-week regime (66% of such days sit in episodes >= 10 trading days), < 10 on ~18%,
# < 3 on ~8%. Everything ships at 0 = inert.


def vix_size_multiplier(
    percentile: float | None,
    *,
    taper_upper_pct: float,
    taper_lower_pct: float,
    taper_floor_frac: float,
    block_below_pct: float,
) -> tuple[float, str]:
    """R9. Return ``(multiplier, reason)``: a 0.0-1.0 scale on
    ``risk.max_risk_per_trade_pct_of_equity`` for this cycle, plus a human-readable line.

    One straight line, no flat segment: full size (1.0) at/above ``taper_upper_pct``,
    linearly down to ``taper_floor_frac`` at/below ``taper_lower_pct``. Strictly below
    ``block_below_pct`` the multiplier is ``0.0`` — a hard block, which the caller turns
    into an R9 rejection row via ``apply_vix_regime``. Everything between the floor
    percentile and the block percentile stays at ``taper_floor_frac`` (a smaller trade,
    never a second no-trade path).

    Inert when the taper band is unset (``taper_upper_pct <= taper_lower_pct``) and
    ``block_below_pct <= 0``, or when the percentile is unknown (VIX unavailable) — an
    absent VIX never blocks trading; R2 (backwardation) is the real regime gate.
    """
    if percentile is None:
        return 1.0, "R9 (VIX taper): VIX 1y percentile unavailable — taper not applied."
    if block_below_pct > 0 and percentile < block_below_pct:
        return (
            0.0,
            f"R9 (VIX taper): VIX 1y percentile {percentile:.1f} is below the "
            f"{block_below_pct:.0f} block floor — no new premium sold into this "
            "extreme-complacency regime.",
        )
    if taper_upper_pct <= taper_lower_pct:
        return 1.0, "R9 (VIX taper): no taper band configured — full size."
    if percentile >= taper_upper_pct:
        return (
            1.0,
            f"R9 (VIX taper): VIX 1y percentile {percentile:.1f} at or above the "
            f"{taper_upper_pct:.0f} taper ceiling — full size.",
        )
    if percentile <= taper_lower_pct:
        fraction = taper_floor_frac
    else:
        span = taper_upper_pct - taper_lower_pct
        fraction = taper_floor_frac + (1.0 - taper_floor_frac) * (
            (percentile - taper_lower_pct) / span
        )
    return (
        fraction,
        f"R9 (VIX taper): VIX 1y percentile {percentile:.1f} between the "
        f"{taper_lower_pct:.0f} floor and the {taper_upper_pct:.0f} ceiling — per-trade "
        f"size scaled to {fraction * 100:.0f}% of the cap.",
    )


def apply_vix_regime(
    verdicts: list[RiskVerdict], multiplier: float, reason: str
) -> list[RiskVerdict]:
    """If R9 hard-blocks (``multiplier == 0.0``), reject every still-approved verdict with
    one extra R9 row carrying ``reason`` — same visible-rejection shape as ``block_entries``
    and ``apply_aggregate_cap``. A partial taper (``0 < multiplier < 1``) is a sizing input,
    not a rejection: verdicts are returned unchanged and the multiplier reaches
    ``compute_quantity`` through the order-prep path instead.
    """
    if multiplier > 0.0:
        return list(verdicts)
    out: list[RiskVerdict] = []
    for verdict in verdicts:
        if not verdict.approved:
            out.append(verdict)
            continue
        out.append(
            replace(
                verdict,
                results=[
                    *verdict.results,
                    RuleResult("R9", False, reason, {"vix_size_multiplier": 0.0}),
                ],
                approved=False,
            )
        )
    return out
