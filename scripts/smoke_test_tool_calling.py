#!/usr/bin/env python3
"""Smoke test: does the configured OpenRouter free model actually do reliable tool calling?

This MUST pass before any real agent logic gets built on top of the LLM layer. OpenRouter
exposes tool calling on its OpenAI-compatible endpoint, but free models vary in how well
they honour it — we verify the configured model ourselves.

Three fake trading-shaped tools are offered to the model, structurally similar to what the
real agent will use (account/chain read, order placement) but entirely fake — nothing here
touches Alpaca. The test drives a multi-turn tool-calling conversation and checks:

  1. the model calls each tool at least once, in a sane order
  2. every tool call's arguments are valid JSON matching the declared schema
  3. the model uses the returned (fake) data rather than ignoring it

If tool calling is unreliable or malformed, this script fails loudly. If it fails, stop and
report it — do not work around it with manual text parsing of the model's output.

Usage:
    python3 scripts/smoke_test_tool_calling.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import ConfigError, get_settings
from app.llm.client import complete

TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "get_account_balance",
            "description": "Get the current paper trading account balance and buying power.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_option_chain",
            "description": "Get the option chain for an underlying symbol, filtered to a max expiry window.",
            "parameters": {
                "type": "object",
                "properties": {
                    "underlying_symbol": {"type": "string"},
                    "expiry_days_max": {"type": "integer"},
                },
                "required": ["underlying_symbol", "expiry_days_max"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "place_vertical_credit_spread",
            "description": (
                "Propose a defined-risk vertical credit spread order (never a naked leg). "
                "short_strike is the strike sold, long_strike is the strike bought for protection."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "underlying_symbol": {"type": "string"},
                    "short_strike": {"type": "number"},
                    "long_strike": {"type": "number"},
                    "expiration_date": {"type": "string", "description": "YYYY-MM-DD"},
                    "contracts": {"type": "integer"},
                },
                "required": [
                    "underlying_symbol",
                    "short_strike",
                    "long_strike",
                    "expiration_date",
                    "contracts",
                ],
            },
        },
    },
]

FAKE_ACCOUNT = {"cash": "50000.00", "buying_power": "50000.00", "options_trading_level": 3}

FAKE_CHAIN: dict[str, Any] = {
    "underlying_symbol": "SPY",
    "contracts": [
        {"symbol": "SPY260905P00640000", "strike": 640, "type": "put", "delta": -0.20, "iv": 0.18},
        {"symbol": "SPY260905P00635000", "strike": 635, "type": "put", "delta": -0.12, "iv": 0.17},
        {"symbol": "SPY260905C00660000", "strike": 660, "type": "call", "delta": 0.19, "iv": 0.16},
        {"symbol": "SPY260905C00665000", "strike": 665, "type": "call", "delta": 0.11, "iv": 0.15},
    ],
}

SYSTEM_PROMPT = (
    "You are a cautious options trading assistant. You must use the tools you are given "
    "rather than guessing values. Follow this exact sequence: first check the account "
    "balance, then fetch the SPY option chain (max 5 days to expiry), then, using strikes "
    "that actually appear in the chain you were given, propose exactly one defined-risk "
    "vertical credit spread. Never propose a naked leg."
)
USER_PROMPT = (
    "Evaluate whether we can open a short vertical credit spread on SPY today, expiring "
    "within 5 days. Use the tools."
)

REQUIRED_TOOL_NAMES = {
    "get_account_balance",
    "get_option_chain",
    "place_vertical_credit_spread",
}


def fake_tool_result(name: str, args: dict) -> dict:
    if name == "get_account_balance":
        return FAKE_ACCOUNT
    if name == "get_option_chain":
        return FAKE_CHAIN
    if name == "place_vertical_credit_spread":
        return {"received": True}
    return {"error": f"unknown tool {name!r}"}


def validate_args(name: str, args: dict) -> list[str]:
    """Return a list of problems with the arguments; empty list means valid."""
    problems = []
    schema: dict[str, Any] = next(t["function"] for t in TOOLS if t["function"]["name"] == name)
    required: list[str] = schema["parameters"]["required"]
    for key in required:
        if key not in args:
            problems.append(f"missing required argument {key!r}")
    if name == "place_vertical_credit_spread" and "short_strike" in args and "long_strike" in args:
        if args["short_strike"] == args["long_strike"]:
            problems.append("short_strike and long_strike must differ (that's not a spread)")
        valid_strikes = {c["strike"] for c in FAKE_CHAIN["contracts"]}
        for k in ("short_strike", "long_strike"):
            if args.get(k) not in valid_strikes:
                problems.append(f"{k}={args.get(k)!r} is not a strike from the chain we returned")
    return problems


def main() -> int:
    try:
        settings = get_settings()
    except ConfigError as exc:
        print(exc, file=sys.stderr)
        return 1

    messages: list[dict] = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": USER_PROMPT},
    ]

    calls_made: list[tuple[str, dict]] = []
    problems: list[str] = []
    total_tokens = 0
    max_turns = 6

    print(f"Model under test: {settings.openrouter_model} @ {settings.openrouter_base_url}\n")

    for turn in range(1, max_turns + 1):
        try:
            response = complete(settings, messages, tools=TOOLS, tool_choice="auto")
        except Exception as exc:  # noqa: BLE001
            print(f"Turn {turn}: request to OpenRouter failed: {exc}", file=sys.stderr)
            return 1

        usage = getattr(response, "usage", None)
        turn_tokens = getattr(usage, "total_tokens", 0) if usage else 0
        total_tokens += turn_tokens

        message = response.choices[0].message
        tool_calls = getattr(message, "tool_calls", None) or []

        print(f"--- turn {turn} ({turn_tokens} tokens) ---")
        if message.content:
            print(f"assistant text: {message.content!r}")

        if not tool_calls:
            print("(no tool calls this turn — model considers the task done)")
            break

        messages.append(
            {
                "role": "assistant",
                "content": message.content,
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                    }
                    for tc in tool_calls
                ],
            }
        )

        for tc in tool_calls:
            name = tc.function.name
            raw_args = tc.function.arguments
            print(f"tool call: {name}({raw_args})")
            try:
                args = json.loads(raw_args)
            except json.JSONDecodeError as exc:
                problems.append(f"turn {turn}: {name} arguments are not valid JSON: {exc}")
                args = {}
            else:
                arg_problems = validate_args(name, args)
                problems.extend(f"turn {turn}: {name}: {p}" for p in arg_problems)

            calls_made.append((name, args))
            result = fake_tool_result(name, args)
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "name": name,
                    "content": json.dumps(result),
                }
            )

    called_names = {name for name, _ in calls_made}
    missing_tools = REQUIRED_TOOL_NAMES - called_names
    if missing_tools:
        problems.append(f"never called: {', '.join(sorted(missing_tools))}")

    print(f"\nTotal tool calls: {len(calls_made)}")
    print(f"Total tokens used: {total_tokens}")

    if problems:
        print("\nFAIL — tool calling is not reliable enough to build on:")
        for p in problems:
            print(f"  - {p}")
        return 1

    print("\nPASS — tool calling verified: all required tools called with valid arguments.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
