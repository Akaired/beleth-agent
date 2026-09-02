"""The decision a cycle persists — deterministic verdict and LLM decision layer.

Two decision sources share one ``DecisionDraft``:

- ``decide_from_risk_engine`` — the deterministic verdict, used whenever the LLM has nothing
  to weigh (market closed, no candidate survived the risk gate) or when the LLM itself failed.
- ``decide_from_llm`` — the LLM decision layer: the model receives the evidence package plus
  the candidates that *already passed* the pre-trade risk gate and records exactly one choice
  through a structured tool call. It adds judgment, never permission: it can only pick from
  the approved list, it cannot invent structures, strikes or sizes, and its failure degrades
  to the deterministic no-trade — never to a trade.

Summaries are the plain-language verdicts the anonymous homepage renders, so they must stand
alone and stay honest: they always disclose which layer decided.
A ``trade`` decision describes the structure and the risk-approved size; the order outcome
lives in the trades log the same cycle writes, so the summary never pre-claims a fill.
"""

from __future__ import annotations

import json
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass, replace
from datetime import datetime
from typing import TYPE_CHECKING, Any

from app.config import REPO_ROOT

if TYPE_CHECKING:
    from app.risk_check import RiskVerdict

# Suffix for deterministic verdicts reached without consulting the LLM: the market was closed,
# or no candidate survived the risk gate, so there was nothing for the model to weigh.
LLM_NOT_CONSULTED_SUFFIX = (
    " Decided by the deterministic risk engine — the LLM is consulted only when the market is"
    " open and a candidate has passed the risk gate."
)

STRATEGY_PATH = REPO_ROOT / "docs" / "strategy.md"

# One structured tool: the model's entire influence on the cycle is a single submit_decision
# call. Everything else (evidence, candidates, gate verdicts) is read-only context.
SUBMIT_DECISION_TOOL = {
    "type": "function",
    "function": {
        "name": "submit_decision",
        "description": (
            "Record your trading decision for this cycle. Call it exactly once. To open a "
            "position, set action to 'trade' and pick one candidate by its index in the "
            "numbered approved list. To stay flat, set action to 'no_trade'."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["trade", "no_trade"],
                    "description": (
                        "'trade' to open one approved candidate, 'no_trade' to decline."
                    ),
                },
                "candidate_index": {
                    "type": "integer",
                    "description": (
                        "Index of the chosen candidate in the numbered approved list. "
                        "Required when action is 'trade'; omit it when declining."
                    ),
                },
                "reasoning": {
                    "type": "string",
                    "description": (
                        "1-3 sentences in plain language explaining the decision, shown on the "
                        "public dashboard. No jargon walls, no promises of profit."
                    ),
                },
            },
            "required": ["action", "reasoning"],
        },
    },
}

_MAX_LLM_TURNS = 4
_LLM_TIMEOUT_SECONDS = 120.0
# A rate-limited primary provider gets exactly one paced retry after this pause before the
# cycle moves on to the fallback provider (free-tier limits are shared upstream pools that
# clear on their own — a short wait often gets a slot back).
_RATE_LIMIT_RETRY_SECONDS = 60.0

_SYSTEM_PROMPT_HEAD = """You are Beleth, a conservative, cautious options-trading agent. You trade
defined-risk vertical credit spreads on U.S. index ETFs, on a paper-trading account, only when a
measured volatility risk premium pays you for the risk you take. Losses are normal and expected;
you never promise gains, and when in doubt you stay flat.

STRATEGY (binding — every claim carries its source):

"""

_SYSTEM_PROMPT_TAIL = """

END OF STRATEGY.

YOUR ROLE IN THIS CYCLE
The user message carries (1) the evidence package — numbers computed by deterministic code this
cycle — and (2) the candidates that ALREADY passed the pre-trade risk gate (R4 defined risk, R6
sizing, R7 daily stop, plus the account-level R10 entry block, R11 aggregate risk cap and R9
VIX-regime block). The gate is final: you cannot approve anything it rejected, and you
cannot invent structures, strikes, expiries or sizes. The number of contracts is computed by the
sizing layer later — you choose whether to trade and which structure, nothing else.

Your judgment adds: whether the premium on offer is worth the risk today, given the regime, the
distance to known macro events and the quality of the quotes — and the discipline to decline
when it is not. Declining is always a correct answer; an agent that knows how to stay still is
part of this project, not a fault.

Record your decision by calling the submit_decision tool exactly once. Its `reasoning` is shown
on the public dashboard: 1-3 sentences, plain language, honest about uncertainty.
"""


@dataclass(frozen=True)
class DecisionDraft:
    """Everything a cycle persists as its decision. Pure data — IO happens in the caller.

    ``llm_*`` are filled by ``decide_from_llm`` (and by its fallback, which records the
    failed consultation); the pure risk-engine path leaves them ``None``.
    """

    as_of: datetime
    symbol: str
    action: str  # "trade" | "no_trade"
    decision_source: str  # "risk_engine" | "llm"
    summary: str
    market_open: bool
    equity: float
    day_pnl: float
    evidence: dict[str, Any]
    strategy_config: dict[str, Any]
    llm_model: str | None = None
    llm_reasoning: str | None = None
    llm_usage: dict[str, Any] | None = None
    # Set on a 'trade' decision: the chosen candidate's dict, handed to the order path so
    # sizing and submission act on exactly the structure the decision picked. Always None
    # on a no_trade — the caller must treat a trade without one as a fail-closed fault.
    # One deliberate exception: an exit-only cycle (a triggered R5 close became the order)
    # is action='trade' with chosen_candidate None — the closing order carries its own
    # spread, not a candidate from this cycle's scan.
    chosen_candidate: dict[str, Any] | None = None


def decide_from_risk_engine(
    *,
    as_of: datetime,
    symbol: str,
    market_open: bool,
    equity: float,
    day_pnl: float,
    evidence: dict[str, Any],
    strategy_config: dict[str, Any],
    verdicts: Sequence[RiskVerdict],
    llm_note: str | None = None,
) -> DecisionDraft:
    """Deterministic verdict for one cycle: no candidates -> say why; candidates -> report
    what the risk gate did with them. ``llm_note`` overrides the default disclosure of why the
    LLM was not consulted (used by the LLM layer's own failure fallback)."""
    if not market_open:
        headline = "No trade: the market is closed."
    elif not verdicts:
        headline = _no_candidate_summary(evidence=evidence, strategy_config=strategy_config)
    else:
        headline = _verdict_summary(verdicts)
    return DecisionDraft(
        as_of=as_of,
        symbol=symbol,
        action="no_trade",
        decision_source="risk_engine",
        summary=headline
        + _ensure_leading_space(llm_note if llm_note is not None else LLM_NOT_CONSULTED_SUFFIX),
        market_open=market_open,
        equity=equity,
        day_pnl=day_pnl,
        evidence=evidence,
        strategy_config=strategy_config,
    )


def _ensure_leading_space(text: str) -> str:
    return text if text.startswith(" ") else (" " + text if text else "")


def _no_candidate_summary(*, evidence: dict[str, Any], strategy_config: dict[str, Any]) -> str:
    """Why nothing even reached the risk gate. Priority: regime gate (R2) > macro calendar
    (R3) > VRP threshold (R1/R8)."""
    regime = strategy_config.get("regime", {})
    if (
        regime.get("block_new_shorts_on_backwardation")
        and (evidence.get("vix") or {}).get("term_structure") == "backwardation"
    ):
        return (
            "No trade: the volatility term structure is inverted (backwardation) — the regime "
            "gate blocks every new short-premium position."
        )

    blocks = evidence.get("calendar", {}).get("blocks_detail") or []
    if blocks:
        described = ", ".join(f"{b.get('dte')} DTE ({b.get('event')})" for b in blocks)
        return f"No trade: macro calendar blocks every candidate tenor — {described}."

    per_tenor = evidence.get("vrp", {}).get("per_tenor") or []
    if not per_tenor:
        return "No trade: no tenor VRP measurements available."
    measured = [t for t in per_tenor if t.get("vrp_vs_rv20") is not None]
    if not measured:
        return (
            "No trade: no realized-vol baseline (RV20 unavailable) to measure the "
            "volatility risk premium against."
        )
    threshold = strategy_config.get("tenor_scan", {}).get("vrp_threshold_vol_points", "configured")
    best = max(measured, key=lambda t: t["vrp_vs_rv20"])
    return (
        f"No trade: best VRP was {best['vrp_vs_rv20']:.2f} vol points ({best['dte']} DTE), "
        f"below the {threshold} vol-point threshold — no tenor qualifies."
    )


def _verdict_summary(verdicts: Sequence[RiskVerdict]) -> str:
    approved = [v for v in verdicts if v.approved]
    if not approved:
        rejected_by = sorted({r.rule for v in verdicts for r in v.rejections})
        return (
            f"No trade: {len(verdicts)} candidate(s) built, all rejected by the risk gate "
            f"({', '.join(rejected_by)})."
        )
    losses = [v.max_loss for v in approved if v.max_loss is not None]
    smallest = min(losses) if losses else 0.0
    return (
        f"No trade: {len(approved)} of {len(verdicts)} candidate(s) passed the risk gate "
        f"(smallest max loss ${smallest:,.2f}) but the cycle stood down without sending "
        "an order."
    )


# --- LLM decision layer ---------------------------------------------------------------------


def _load_strategy() -> str:
    return STRATEGY_PATH.read_text(encoding="utf-8")


def _usd(value: float | None) -> str:
    return "unknown" if value is None else f"${value:,.2f}"


def _direction(candidate: dict[str, Any]) -> str:
    return "bull put" if candidate["right"] == "P" else "bear call"


def _credit_text(candidate: dict[str, Any]) -> str:
    credit = candidate.get("credit")
    return "credit unavailable" if credit is None else f"~${credit:.2f}/share credit"


def build_decision_messages(
    *,
    evidence: dict[str, Any],
    approved: Sequence[RiskVerdict],
    strategy: str | None = None,
) -> list[dict[str, Any]]:
    """System prompt (strategy + protocol) and the user message for one decision call.

    The evidence package's own ``candidates`` list is stripped from the model's copy: those
    are pre-gate structures, and the model must choose only from the risk-approved list shown
    numbered below it — it cannot even see a structure it is not allowed to pick.
    """
    strategy_text = strategy if strategy is not None else _load_strategy()
    evidence_for_model = {k: v for k, v in evidence.items() if k != "candidates"}

    lines = []
    for index, verdict in enumerate(approved):
        c = verdict.candidate
        lines.append(
            f"[{index}] {c['symbol']} {_direction(c)} {c['strikes'][0]}/{c['strikes'][1]} "
            f"expiring {c['expiry']} ({c['dte']} DTE) | {_credit_text(c)} | "
            f"max loss {_usd(verdict.max_loss)} per spread | breakeven {c.get('breakeven')} | "
            f"short-leg delta {c.get('delta_short')} | combined bid/ask width "
            f"{c.get('bid_ask_spread')}"
        )

    user_content = (
        "Evidence package for this cycle (computed by deterministic code):\n"
        f"{json.dumps(evidence_for_model, indent=2, default=str)}\n\n"
        "Candidates that passed the pre-trade risk gate (your only choice set):\n"
        + ("\n".join(lines) if lines else "(none — this cycle should not reach you)")
        + "\n\nRecord your decision by calling the submit_decision tool exactly once."
    )
    return [
        {
            "role": "system",
            "content": _SYSTEM_PROMPT_HEAD + strategy_text + _SYSTEM_PROMPT_TAIL,
        },
        {"role": "user", "content": user_content},
    ]


def validate_decision_args(args: Any, *, approved_count: int) -> str | None:
    """Return an error message for an unusable ``submit_decision`` payload, or ``None`` when
    the decision is acceptable. The model can only pick a valid index into the approved list
    — anything else is corrected once, then the cycle falls back deterministically."""
    if not isinstance(args, dict):
        return f"decision arguments must be a JSON object, got {type(args).__name__}"
    action = args.get("action")
    if action not in ("trade", "no_trade"):
        return f"action must be 'trade' or 'no_trade', got {action!r}"
    reasoning = args.get("reasoning")
    if not isinstance(reasoning, str) or not reasoning.strip():
        return "reasoning must be a non-empty string"
    if action == "trade":
        index = args.get("candidate_index")
        if isinstance(index, bool) or not isinstance(index, int):
            return (
                "candidate_index is required when action is 'trade' and must be an integer "
                f"index into the approved list, got {index!r}"
            )
        if not 0 <= index < approved_count:
            return (
                f"candidate_index {index} is out of range: the approved list has "
                f"{approved_count} candidate(s), valid indices are 0..{approved_count - 1}"
            )
    return None


def _accumulate_usage(total: dict[str, int], response: Any) -> dict[str, int]:
    usage = getattr(response, "usage", None)
    if usage is None:
        return total
    for key in ("prompt_tokens", "completion_tokens", "total_tokens"):
        total[key] += getattr(usage, key, 0) or 0
    return total


def _reasoning_trail(
    texts: list[str], args: dict[str, Any] | None, failure: str | None = None
) -> str:
    """The demo-admin backoffice's view of the cycle: the model's own words, the structured
    decision it recorded, and — when the layer fell back — why."""
    parts = [t.strip() for t in texts if t and t.strip()]
    if args is not None:
        parts.append("submit_decision args: " + json.dumps(args, sort_keys=True))
    if failure is not None:
        parts.append(f"LLM decision failed, deterministic fallback applied: {failure}")
    return "\n\n".join(parts)


def _trade_summary(verdict: RiskVerdict, reasoning: str) -> str:
    c = verdict.candidate
    return (
        f"Trade: sell a {_direction(c)} vertical on {c['symbol']} — {c['strikes'][0]}/"
        f"{c['strikes'][1]} strikes expiring {c['expiry']} ({c['dte']} DTE), "
        f"{_credit_text(c)}, defined max loss {_usd(verdict.max_loss)} per spread. "
        f"Why: {reasoning.strip()}"
    )


def _decline_summary(reasoning: str, approved_count: int) -> str:
    return (
        f"No trade: {reasoning.strip()} "
        f"(Declined among {approved_count} risk-approved candidate(s).)"
    )


def decide_from_llm(
    *,
    as_of: datetime,
    symbol: str,
    market_open: bool,
    equity: float,
    day_pnl: float,
    evidence: dict[str, Any],
    strategy_config: dict[str, Any],
    verdicts: Sequence[RiskVerdict],
    settings: Any,
    complete_fn: Callable[..., Any] | None = None,
    sleep_fn: Callable[[float], Any] | None = None,
    strategy: str | None = None,
) -> DecisionDraft:
    """One LLM decision: the model weighs the evidence and records a structured choice.

    Guardrails, in order: the model only ever sees risk-approved candidates; an unusable
    answer is corrected and retried within a bounded turn budget; a rate-limited primary
    provider gets one paced retry (``_RATE_LIMIT_RETRY_SECONDS``) and then the cycle tries the
    configured fallback provider (``LLM_FALLBACK_*``); if every provider fails outright
    (transport error, malformed output, budget exhausted) the cycle falls back to
    ``decide_from_risk_engine`` — which never trades on its own — with the failure recorded in
    ``llm_reasoning``. An absent or misbehaving LLM can therefore never cause a trade.

    ``complete_fn`` injects the transport (tests pass a fake; production uses
    ``app.llm.client.complete``); ``sleep_fn`` injects the rate-limit pause.
    """
    approved = [v for v in verdicts if v.approved]
    if not approved:
        # Nothing for the model to weigh — a deterministic verdict, no LLM call.
        return decide_from_risk_engine(
            as_of=as_of,
            symbol=symbol,
            market_open=market_open,
            equity=equity,
            day_pnl=day_pnl,
            evidence=evidence,
            strategy_config=strategy_config,
            verdicts=verdicts,
        )

    if complete_fn is None:
        complete_fn = _default_complete
    if sleep_fn is None:
        sleep_fn = time.sleep

    base_messages = build_decision_messages(evidence=evidence, approved=approved, strategy=strategy)
    total_usage: dict[str, int] = {
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "total_tokens": 0,
    }
    all_texts: list[str] = []
    failure: str | None = None

    for index, (model_label, provider_kwargs) in enumerate(_provider_attempts(settings)):
        # The primary gets one extra try, taken only after a rate-limit pause; the fallback
        # provider gets a single shot.
        max_tries = 2 if index == 0 else 1
        for attempt_no in range(max_tries):
            result = _run_llm_turns(
                complete_fn=complete_fn,
                settings=settings,
                base_messages=base_messages,
                approved=approved,
                provider_kwargs=provider_kwargs,
            )
            total_usage = _merge_usage(total_usage, result.usage)
            all_texts.extend(result.texts)

            if result.args is not None:
                args = result.args
                return DecisionDraft(
                    as_of=as_of,
                    symbol=symbol,
                    action=args["action"],
                    decision_source="llm",
                    summary=(
                        _trade_summary(approved[args["candidate_index"]], args["reasoning"])
                        if args["action"] == "trade"
                        else _decline_summary(args["reasoning"], len(approved))
                    ),
                    market_open=market_open,
                    equity=equity,
                    day_pnl=day_pnl,
                    evidence=evidence,
                    strategy_config=strategy_config,
                    llm_model=model_label,
                    llm_reasoning=_reasoning_trail(all_texts, args),
                    llm_usage={**total_usage, "model": model_label},
                    chosen_candidate=(
                        approved[args["candidate_index"]].candidate
                        if args["action"] == "trade"
                        else None
                    ),
                )

            failure = result.failure
            if result.rate_limited and attempt_no + 1 < max_tries:
                sleep_fn(_RATE_LIMIT_RETRY_SECONDS)
                continue
            break  # this provider is spent — move on to the next one

    return _llm_fallback(
        as_of=as_of,
        symbol=symbol,
        market_open=market_open,
        equity=equity,
        day_pnl=day_pnl,
        evidence=evidence,
        strategy_config=strategy_config,
        verdicts=verdicts,
        settings=settings,
        usage=total_usage,
        texts=all_texts,
        failure=failure or f"no valid submit_decision within {_MAX_LLM_TURNS} turns",
    )


@dataclass
class _LlmTurnResult:
    """Outcome of spending one provider's turn budget: either parsed ``submit_decision``
    ``args``, or a ``failure`` string — ``rate_limited`` is set when that failure was an
    HTTP 429 / ``RateLimitError`` so the caller can pace a retry."""

    args: dict[str, Any] | None
    texts: list[str]
    usage: dict[str, int]
    failure: str | None
    rate_limited: bool


def _provider_attempts(settings: Any) -> list[tuple[str, dict[str, Any]]]:
    """Providers to try, in order: the primary (OpenRouter) always, then the fallback
    (AI/ML API by default) when ``LLM_FALLBACK_KEY`` is set. Each entry is
    ``(model_label, complete_kwargs)`` — the label is stamped onto the persisted decision."""
    attempts: list[tuple[str, dict[str, Any]]] = [(settings.openrouter_model, {})]
    fallback_key = getattr(settings, "llm_fallback_key", None)
    if fallback_key:
        model = getattr(settings, "llm_fallback_model", None) or "fallback"
        attempts.append(
            (
                model,
                {
                    "base_url": getattr(settings, "llm_fallback_base_url", None),
                    "api_key": fallback_key,
                    "model": model,
                },
            )
        )
    return attempts


def _is_rate_limit(exc: Exception) -> bool:
    """True for an HTTP 429 from any OpenAI-compatible provider, without importing `openai`
    (so the module and its tests stay SDK-free)."""
    if type(exc).__name__ == "RateLimitError":
        return True
    status = getattr(exc, "status_code", None) or getattr(exc, "code", None)
    if status in (429, "429"):
        return True
    text = str(exc).lower()
    return "429" in text or "rate limit" in text or "rate_limit" in text


def _merge_usage(a: dict[str, int], b: dict[str, int]) -> dict[str, int]:
    keys = ("prompt_tokens", "completion_tokens", "total_tokens")
    return {k: a.get(k, 0) + b.get(k, 0) for k in keys}


def _run_llm_turns(
    *,
    complete_fn: Callable[..., Any],
    settings: Any,
    base_messages: list[dict[str, Any]],
    approved: Sequence[Any],
    provider_kwargs: dict[str, Any],
) -> _LlmTurnResult:
    """Chase a valid ``submit_decision`` call within the turn budget against one provider.
    Free of the cycle's context — the caller turns ``args`` into a ``DecisionDraft``. Starts
    from a fresh copy of ``base_messages`` so a retry never inherits a half-built exchange."""
    messages = list(base_messages)
    usage: dict[str, int] = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
    texts: list[str] = []
    call_kwargs = {k: v for k, v in provider_kwargs.items() if v is not None}

    for _turn in range(_MAX_LLM_TURNS):
        try:
            response = complete_fn(
                settings,
                messages,
                tools=[SUBMIT_DECISION_TOOL],
                tool_choice="auto",
                timeout=_LLM_TIMEOUT_SECONDS,
                **call_kwargs,
            )
            if not getattr(response, "choices", None):
                raise ValueError("response carries no choices")
            message = response.choices[0].message
        except Exception as exc:  # noqa: BLE001 — any transport failure degrades, never trades
            return _LlmTurnResult(
                args=None,
                texts=texts,
                usage=usage,
                failure=f"{type(exc).__name__}: {exc}"[:300],
                rate_limited=_is_rate_limit(exc),
            )
        usage = _accumulate_usage(usage, response)
        if message.content:
            texts.append(message.content)

        tool_calls = getattr(message, "tool_calls", None) or []
        if not tool_calls:
            messages.append({"role": "assistant", "content": message.content})
            messages.append(
                {
                    "role": "user",
                    "content": (
                        "Record your decision now by calling the submit_decision tool exactly once."
                    ),
                }
            )
            continue

        tool_call = tool_calls[0]
        raw_args = tool_call.function.arguments
        error: str | None
        try:
            args = json.loads(raw_args)
        except (json.JSONDecodeError, TypeError):
            error, args = f"arguments are not valid JSON: {raw_args!r}", None
        else:
            error = validate_decision_args(args, approved_count=len(approved))
        if error is not None:
            messages.append(
                {
                    "role": "assistant",
                    "content": message.content,
                    "tool_calls": [
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {
                                "name": tc.function.name,
                                "arguments": tc.function.arguments,
                            },
                        }
                        for tc in tool_calls
                    ],
                }
            )
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "name": tool_call.function.name,
                    "content": json.dumps({"error": error}),
                }
            )
            continue

        return _LlmTurnResult(args=args, texts=texts, usage=usage, failure=None, rate_limited=False)

    return _LlmTurnResult(
        args=None,
        texts=texts,
        usage=usage,
        failure=f"no valid submit_decision within {_MAX_LLM_TURNS} turns",
        rate_limited=False,
    )


def _default_complete(settings: Any, messages: list[dict[str, Any]], **kwargs: Any) -> Any:
    """Production transport, imported lazily so the module (and its tests) never need the
    `openai` package or a configured client."""
    from app.llm.client import complete

    return complete(settings, messages, **kwargs)


def _llm_fallback(
    *,
    as_of: datetime,
    symbol: str,
    market_open: bool,
    equity: float,
    day_pnl: float,
    evidence: dict[str, Any],
    strategy_config: dict[str, Any],
    verdicts: Sequence[RiskVerdict],
    settings: Any,
    usage: dict[str, int],
    texts: list[str],
    failure: str,
) -> DecisionDraft:
    draft = decide_from_risk_engine(
        as_of=as_of,
        symbol=symbol,
        market_open=market_open,
        equity=equity,
        day_pnl=day_pnl,
        evidence=evidence,
        strategy_config=strategy_config,
        verdicts=verdicts,
        llm_note=(
            "The LLM decision layer was consulted but failed "
            f"({failure}); the deterministic fallback never trades on its own."
        ),
    )
    return replace(
        draft,
        llm_model=settings.openrouter_model,
        llm_reasoning=_reasoning_trail(texts, None, failure),
        llm_usage=dict(usage),
    )
