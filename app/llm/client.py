"""LLM access through LiteLLM only — never a provider's proprietary SDK.

Regolo.ai is the default provider (see the resolved product decisions #2), reached as
a generic OpenAI-compatible endpoint. Swapping provider/model is a `.env` change
(REGOLO_MODEL, or eventually a different provider's settings) — this module never hardcodes
a specific model.
"""

from __future__ import annotations

from typing import Any

import litellm

from app.config import Settings


def complete(
    settings: Settings,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None = None,
    tool_choice: str | dict[str, Any] | None = None,
    **kwargs: Any,
) -> litellm.types.utils.ModelResponse:
    """Call the configured LLM via LiteLLM's OpenAI-compatible passthrough.

    `model="openai/<name>"` + `api_base` is LiteLLM's mechanism for talking to any
    OpenAI-compatible endpoint (Regolo included) without a provider-specific SDK.
    """
    return litellm.completion(
        model=f"openai/{settings.regolo_model}",
        api_base=settings.regolo_base_url,
        api_key=settings.regolo_key,
        messages=messages,
        tools=tools,
        tool_choice=tool_choice if tools else None,
        **kwargs,
    )
