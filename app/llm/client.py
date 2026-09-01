"""LLM access via an OpenAI-compatible API, using the OpenAI SDK.

The primary provider is OpenRouter: its `https://openrouter.ai/api/v1` endpoint
implements the OpenAI API, and the official way to
reach it is the standard `openai` SDK with a custom `base_url` — no provider-specific SDK,
no routing layer. Swapping model (or moving to another OpenAI-compatible provider) is a
`.env` change (`OPENROUTER_MODEL`, `OPENROUTER_BASE_URL`); this module never hardcodes one.

A second OpenAI-compatible provider (AI/ML API by default, `LLM_FALLBACK_*` in `.env`) is
used only when the primary fails outright — see `app.decision.decide_from_llm`. Pass
`base_url` / `api_key` / `model` to target it; omit them for the primary.
"""

from __future__ import annotations

from typing import Any

from openai import OpenAI

from app.config import Settings


def complete(
    settings: Settings,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None = None,
    tool_choice: str | dict[str, Any] | None = None,
    *,
    base_url: str | None = None,
    api_key: str | None = None,
    model: str | None = None,
    **kwargs: Any,
) -> Any:
    """One chat completion. Targets the configured OpenRouter model unless ``base_url`` /
    ``api_key`` / ``model`` override it (the fallback provider).

    Returns the SDK's `ChatCompletion` — `choices[0].message` (with `.tool_calls` when the
    model calls a tool) and `.usage.total_tokens` are what the decision layer consumes.
    """
    client = OpenAI(
        base_url=base_url or settings.openrouter_base_url,
        api_key=api_key or settings.openrouter_key,
    )
    return client.chat.completions.create(
        model=model or settings.openrouter_model,
        messages=messages,
        tools=tools,
        tool_choice=tool_choice if tools else None,
        timeout=kwargs.pop("timeout", 300.0),
        **kwargs,
    )
