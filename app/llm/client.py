"""LLM access via OpenRouter's OpenAI-compatible API, using the OpenAI SDK.

OpenRouter is the provider (see the resolved product decisions #2): its
`https://openrouter.ai/api/v1` endpoint implements the OpenAI API, and the official way to
reach it is the standard `openai` SDK with a custom `base_url` — no provider-specific SDK,
no routing layer. Swapping model (or moving to another OpenAI-compatible provider) is a
`.env` change (`OPENROUTER_MODEL`, `OPENROUTER_BASE_URL`); this module never hardcodes one.
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
    **kwargs: Any,
) -> Any:
    """One chat completion against the configured OpenRouter model.

    Returns the SDK's `ChatCompletion` — `choices[0].message` (with `.tool_calls` when the
    model calls a tool) and `.usage.total_tokens` are what the decision layer consumes.
    """
    client = OpenAI(
        base_url=settings.openrouter_base_url,
        api_key=settings.openrouter_key,
    )
    return client.chat.completions.create(
        model=settings.openrouter_model,
        messages=messages,
        tools=tools,
        tool_choice=tool_choice if tools else None,
        timeout=kwargs.pop("timeout", 300.0),
        **kwargs,
    )