"""Unit tests for app/decision.py — the deterministic verdict, the LLM decision layer, and
their summaries. No network: the LLM transport is a scripted fake."""

import json
from datetime import datetime, timezone
from types import SimpleNamespace

from app.decision import (
    LLM_NOT_CONSULTED_SUFFIX,
    SUBMIT_DECISION_TOOL,
    build_decision_messages,
    decide_from_llm,
    decide_from_risk_engine,
    validate_decision_args,
)
from app.risk_check import RuleResult, RiskVerdict


def _evidence(*, blocks=None, per_tenor=None, term_structure=None):
    vix = {"term_structure": term_structure} if term_structure else {}
    return {
        "as_of": "2026-08-28T14:00:00+00:00",
        "calendar": {"blocks_detail": blocks or []},
        "vrp": {"per_tenor": per_tenor or []},
        "vix": vix,
    }


def _tenor(dte, vrp, passes):
    return {"dte": dte, "atm_iv": 0.18, "vrp_vs_rv20": vrp, "passes_threshold": passes}


_STRATEGY = {"tenor_scan": {"vrp_threshold_vol_points": 2.0}}

_CANDIDATE = {
    "symbol": "SPY",
    "right": "P",
    "expiry": "2026-09-25",
    "dte": 28,
    "strikes": [640.0, 635.0],
    "strike_width": 5.0,
    "delta_short": -0.2,
    "credit": 0.85,
    "max_loss": 400.0,
    "breakeven": 639.15,
    "bid_ask_spread": 0.06,
}


def _verdict(*, approved, rules, max_loss=None, candidate=None):
    """rules: list of (rule_id, passed) pairs."""
    return RiskVerdict(
        approved=approved,
        max_loss=(max_loss if max_loss is not None else (400.0 if approved else 900.0)),
        breakeven=450.25,
        results=[
            RuleResult(rule, passed, f"{rule} reason", {})
            for rule, passed in rules
        ],
        candidate=candidate if candidate is not None else dict(_CANDIDATE),
    )


def _decide(**overrides):
    kwargs = {
        "as_of": datetime(2026, 8, 28, 14, 0, tzinfo=timezone.utc),
        "symbol": "SPY",
        "market_open": True,
        "equity": 100000.0,
        "day_pnl": 0.0,
        "evidence": _evidence(),
        "strategy_config": _STRATEGY,
        "verdicts": [],
    }
    kwargs.update(overrides)
    return decide_from_risk_engine(**kwargs)


def test_market_closed_heads_the_summary_even_with_verdicts():
    draft = _decide(
        market_open=False,
        evidence=_evidence(per_tenor=[_tenor(30, 4.6, True)]),
        verdicts=[_verdict(approved=True, rules=[("R4", True), ("R6", True), ("R7", True)])],
    )
    assert draft.summary.startswith("No trade: the market is closed.")


def test_calendar_block_reason_names_the_events():
    blocks = [{"dte": 7, "expiry": "2026-09-04", "event": "Nonfarm Payrolls"}]
    draft = _decide(evidence=_evidence(blocks=blocks))
    assert "Nonfarm Payrolls" in draft.summary
    assert "7 DTE" in draft.summary


def test_backwardation_beats_every_other_no_candidate_reason():
    draft = _decide(
        evidence=_evidence(
            term_structure="backwardation",
            blocks=[{"dte": 7, "expiry": "2026-09-04", "event": "CPI"}],
            per_tenor=[_tenor(30, 4.6, True)],
        ),
        strategy_config={
            "tenor_scan": _STRATEGY["tenor_scan"],
            "regime": {"block_new_shorts_on_backwardation": True},
        },
    )
    assert "backwardation" in draft.summary
    assert "CPI" not in draft.summary


def test_backwardation_reason_respects_the_config_flag():
    draft = _decide(
        evidence=_evidence(term_structure="backwardation"),
        strategy_config={
            "tenor_scan": _STRATEGY["tenor_scan"],
            "regime": {"block_new_shorts_on_backwardation": False},
        },
    )
    assert "backwardation" not in draft.summary


def test_calendar_block_beats_vrp_reason():
    blocks = [{"dte": 7, "expiry": "2026-09-04", "event": "CPI"}]
    draft = _decide(
        evidence=_evidence(blocks=blocks, per_tenor=[_tenor(30, 4.6, True)]),
    )
    assert "macro calendar" in draft.summary
    assert "VRP" not in draft.summary


def test_vrp_reason_quotes_best_tenor_and_threshold():
    draft = _decide(
        evidence=_evidence(
            per_tenor=[_tenor(7, 1.6, False), _tenor(30, 1.9, False)]
        ),
    )
    assert "best VRP was 1.90 vol points (30 DTE)" in draft.summary
    assert "2.0 vol-point threshold" in draft.summary


def test_no_rv20_baseline_reason():
    draft = _decide(evidence=_evidence(per_tenor=[_tenor(30, None, False)]))
    assert "RV20 unavailable" in draft.summary


def test_all_rejected_names_the_rejecting_rules():
    verdicts = [
        _verdict(approved=False, rules=[("R4", True), ("R6", False), ("R7", True)]),
        _verdict(approved=False, rules=[("R4", True), ("R6", False), ("R7", False)]),
    ]
    draft = _decide(verdicts=verdicts)
    assert "2 candidate(s) built, all rejected by the risk gate (R6, R7)." in draft.summary


def test_approved_candidates_reported_but_stood_down():
    verdicts = [
        _verdict(approved=False, rules=[("R4", True), ("R6", False), ("R7", True)]),
        _verdict(approved=True, rules=[("R4", True), ("R6", True), ("R7", True)]),
    ]
    draft = _decide(verdicts=verdicts)
    assert "1 of 2 candidate(s) passed the risk gate" in draft.summary
    assert "$400.00" in draft.summary
    assert "stood down without sending an order" in draft.summary


def test_deterministic_summary_discloses_the_llm_was_not_consulted():
    drafts = [
        _decide(market_open=False),
        _decide(evidence=_evidence(blocks=[{"dte": 7, "expiry": "x", "event": "CPI"}])),
        _decide(
            evidence=_evidence(per_tenor=[_tenor(30, 4.6, True)]),
            verdicts=[_verdict(approved=True, rules=[("R4", True), ("R6", True), ("R7", True)])],
        ),
    ]
    for draft in drafts:
        assert draft.summary.endswith(LLM_NOT_CONSULTED_SUFFIX.strip())
        assert draft.decision_source == "risk_engine"
        assert draft.action == "no_trade"


def test_custom_llm_note_overrides_the_default_suffix():
    draft = _decide(llm_note=" The LLM was unreachable (HTTP 429).")
    assert draft.summary.endswith("The LLM was unreachable (HTTP 429).")
    assert LLM_NOT_CONSULTED_SUFFIX not in draft.summary


def test_draft_carries_evidence_and_strategy_config():
    evidence = _evidence(per_tenor=[_tenor(30, 4.6, True)])
    draft = _decide(evidence=evidence)
    assert draft.evidence is evidence
    assert draft.strategy_config is _STRATEGY
    assert draft.symbol == "SPY"
    assert draft.llm_model is None and draft.llm_usage is None


# --- LLM decision layer ---------------------------------------------------------------------


class _ScriptedLLM:
    """Fake transport: replays canned responses and records every call's messages."""

    def __init__(self, *responses):
        self.responses = list(responses)
        self.calls: list[list[dict]] = []

    def __call__(self, settings, messages, **kwargs):
        self.calls.append(messages)
        return self.responses.pop(0)


def _response(*, content=None, tool_args=None, usage=(0, 0, 0)):
    tool_calls = None
    if tool_args is not None:
        tool_calls = [
            SimpleNamespace(
                id="call_1",
                function=SimpleNamespace(name="submit_decision", arguments=json.dumps(tool_args)),
            )
        ]
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content, tool_calls=tool_calls))],
        usage=SimpleNamespace(
            prompt_tokens=usage[0], completion_tokens=usage[1], total_tokens=usage[2]
        ),
    )


_SETTINGS = SimpleNamespace(openrouter_model="fake-model")

_APPROVED = [_verdict(approved=True, rules=[("R4", True), ("R6", True), ("R7", True)])]


def _llm_decide(scripted, *, verdicts=None, evidence=None, strategy="STRATEGY"):
    return decide_from_llm(
        as_of=datetime(2026, 8, 28, 14, 0, tzinfo=timezone.utc),
        symbol="SPY",
        market_open=True,
        equity=100000.0,
        day_pnl=0.0,
        evidence=evidence if evidence is not None else _evidence(),
        strategy_config=_STRATEGY,
        verdicts=verdicts if verdicts is not None else _APPROVED,
        settings=_SETTINGS,
        complete_fn=scripted,
        strategy=strategy,
    )


def test_llm_trade_decision_is_persisted_with_full_provenance():
    scripted = _ScriptedLLM(
        _response(
            content="Premium is there and quotes are tight.",
            tool_args={
                "action": "trade",
                "candidate_index": 0,
                "reasoning": "VRP clears the threshold and quotes are tight.",
            },
            usage=(100, 20, 120),
        )
    )
    draft = _llm_decide(scripted)
    assert draft.action == "trade"
    assert draft.decision_source == "llm"
    assert draft.llm_model == "fake-model"
    assert draft.llm_usage == {
        "prompt_tokens": 100,
        "completion_tokens": 20,
        "total_tokens": 120,
        "model": "fake-model",
    }
    assert "max loss $400.00" in draft.summary
    assert "submit_decision args" in draft.llm_reasoning
    assert "Premium is there" in draft.llm_reasoning
    # The order path consumes this: the chosen candidate travels with the decision, so
    # sizing and submission act on exactly the structure the model picked.
    assert draft.chosen_candidate == _APPROVED[0].candidate


def test_llm_decline_carries_no_chosen_candidate():
    scripted = _ScriptedLLM(
        _response(
            tool_args={"action": "no_trade", "reasoning": "Credit too thin for the risk."},
            usage=(90, 15, 105),
        )
    )
    draft = _llm_decide(scripted)
    assert draft.action == "no_trade"
    assert draft.chosen_candidate is None


def test_llm_decline_is_a_first_class_llm_decision():
    scripted = _ScriptedLLM(
        _response(
            tool_args={
                "action": "no_trade",
                "reasoning": "Term structure is flat and the credit is too thin.",
            },
            usage=(90, 15, 105),
        )
    )
    draft = _llm_decide(scripted)
    assert draft.action == "no_trade"
    assert draft.decision_source == "llm"
    assert draft.summary.startswith("No trade: Term structure is flat")
    assert "Declined among 1 risk-approved candidate(s)." in draft.summary


def test_no_approved_candidate_never_calls_the_llm():
    scripted = _ScriptedLLM(_response(tool_args={"action": "no_trade", "reasoning": "x"}))
    verdicts = [_verdict(approved=False, rules=[("R6", False)])]
    draft = _llm_decide(scripted, verdicts=verdicts)
    assert scripted.calls == []  # the model was never consulted
    assert draft.decision_source == "risk_engine"
    assert draft.llm_model is None
    assert draft.summary.endswith(LLM_NOT_CONSULTED_SUFFIX.strip())


def test_out_of_range_index_is_corrected_then_accepted():
    scripted = _ScriptedLLM(
        _response(tool_args={"action": "trade", "candidate_index": 5, "reasoning": "x"}),
        _response(
            tool_args={"action": "trade", "candidate_index": 0, "reasoning": "fine now"}
        ),
    )
    draft = _llm_decide(scripted)
    assert draft.action == "trade"
    assert len(scripted.calls) == 2
    # The corrective exchange reached the model: an assistant tool_call followed by a tool
    # message carrying the validation error.
    corrective = scripted.calls[1]
    assert corrective[-1]["role"] == "tool"
    assert "out of range" in corrective[-1]["content"]
    assert corrective[-2]["role"] == "assistant"
    assert corrective[-2]["tool_calls"][0]["function"]["name"] == "submit_decision"


def test_malformed_json_arguments_are_corrected_then_accepted():
    bad_call = SimpleNamespace(
        id="call_1",
        function=SimpleNamespace(name="submit_decision", arguments="not json {"),
    )
    bad_response = _response(usage=(1, 1, 2))
    bad_response.choices[0].message.tool_calls = [bad_call]
    scripted = _ScriptedLLM(
        bad_response,
        _response(tool_args={"action": "no_trade", "reasoning": "declined"}, usage=(3, 3, 6)),
    )
    draft = _llm_decide(scripted)
    assert draft.action == "no_trade"
    assert draft.decision_source == "llm"
    assert len(scripted.calls) == 2
    assert "not valid JSON" in scripted.calls[1][-1]["content"]


def test_transport_failure_falls_back_to_a_deterministic_no_trade():
    def broken(settings, messages, **kwargs):
        raise RuntimeError("connection refused")

    draft = decide_from_llm(
        as_of=datetime(2026, 8, 28, 14, 0, tzinfo=timezone.utc),
        symbol="SPY",
        market_open=True,
        equity=100000.0,
        day_pnl=0.0,
        evidence=_evidence(),
        strategy_config=_STRATEGY,
        verdicts=_APPROVED,
        settings=_SETTINGS,
        complete_fn=broken,
    )
    assert draft.action == "no_trade"
    assert draft.decision_source == "risk_engine"
    assert draft.llm_model == "fake-model"  # the attempt is recorded even though it failed
    assert draft.llm_usage == {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
    assert "connection refused" in draft.llm_reasoning
    assert "deterministic fallback" in draft.llm_reasoning


def test_exhausted_turns_fall_back():
    scripted = _ScriptedLLM(*[_response(content="I am thinking...") for _ in range(6)])
    draft = _llm_decide(scripted)
    assert len(scripted.calls) == 4  # bounded turn budget
    assert draft.action == "no_trade"
    assert draft.decision_source == "risk_engine"
    assert "no valid submit_decision within 4 turns" in draft.llm_reasoning


def test_usage_accumulates_across_turns():
    scripted = _ScriptedLLM(
        _response(content=None, usage=(100, 10, 110)),
        _response(content=None, usage=(200, 20, 220)),
        _response(
            tool_args={"action": "no_trade", "reasoning": "still not worth it"},
            usage=(50, 5, 55),
        ),
    )
    draft = _llm_decide(scripted)
    assert draft.llm_usage["prompt_tokens"] == 350
    assert draft.llm_usage["completion_tokens"] == 35
    assert draft.llm_usage["total_tokens"] == 385


def test_prompt_strips_pregate_candidates_and_injects_the_strategy():
    evidence = _evidence(per_tenor=[_tenor(30, 4.6, True)])
    evidence["candidates"] = [{"symbol": "SPY", "note": "pre-gate structure"}]
    messages = build_decision_messages(
        evidence=evidence,
        approved=_APPROVED,
        strategy="THE STRATEGY TEXT",
    )
    system, user = messages[0]["content"], messages[1]["content"]
    assert messages[0]["role"] == "system" and messages[1]["role"] == "user"
    assert "THE STRATEGY TEXT" in system
    assert "END OF STRATEGY" in system
    assert SUBMIT_DECISION_TOOL["function"]["name"] in system
    assert "pre-gate structure" not in user  # the model never sees rejected structures
    assert "[0] SPY bull put 640.0/635.0" in user
    assert "2026-09-25" in user and "$400.00" in user


def test_tool_schema_requires_action_and_reasoning_only():
    params = SUBMIT_DECISION_TOOL["function"]["parameters"]
    assert params["required"] == ["action", "reasoning"]
    assert params["properties"]["action"]["enum"] == ["trade", "no_trade"]


# --- validate_decision_args -----------------------------------------------------------------


def test_validate_accepts_a_valid_trade():
    args = {"action": "trade", "candidate_index": 0, "reasoning": "good premium"}
    assert validate_decision_args(args, approved_count=2) is None


def test_validate_accepts_a_decline_without_an_index():
    args = {"action": "no_trade", "reasoning": "not today"}
    assert validate_decision_args(args, approved_count=2) is None


def test_validate_rejects_an_out_of_range_index():
    args = {"action": "trade", "candidate_index": 2, "reasoning": "x"}
    message = validate_decision_args(args, approved_count=2)
    assert message is not None and "out of range" in message


def test_validate_rejects_a_boolean_index():
    args = {"action": "trade", "candidate_index": True, "reasoning": "x"}
    assert validate_decision_args(args, approved_count=2) is not None


def test_validate_rejects_a_missing_index_on_trade():
    args = {"action": "trade", "reasoning": "x"}
    assert validate_decision_args(args, approved_count=2) is not None


def test_validate_rejects_an_unknown_action():
    args = {"action": "yolo", "reasoning": "x"}
    assert validate_decision_args(args, approved_count=2) is not None


def test_validate_rejects_empty_reasoning():
    args = {"action": "no_trade", "reasoning": "   "}
    assert validate_decision_args(args, approved_count=2) is not None


def test_validate_rejects_non_object_payloads():
    assert validate_decision_args(["trade"], approved_count=2) is not None
    assert validate_decision_args("trade", approved_count=2) is not None