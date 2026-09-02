"""Redaction for anything that ends up in the database.

Third-party exception text is quoted verbatim into rows the dashboard shows —
`decisions.llm_reasoning`, `trades.raw`, `agent_events.detail`. Those messages are
written by SDKs we do not control, and an HTTP client that echoes the request URL back
in its error is entirely ordinary. Since the decision log is a public artifact, a
credential that reaches one of those columns is published.

Two passes, deliberately in this order:

1. **Known secrets.** Every secret-shaped value in `Settings`, matched literally. This
   is the pass that actually protects us; it needs no guessing.
2. **Shapes.** Bearer tokens, `api_key=`-style query parameters, JWTs, and the Supabase
   project reference inside a `*.supabase.co` host. This catches a credential that never
   passed through `Settings` — a key pasted into a URL by hand, say.

Redaction never raises and never returns None: a failure here must not be able to stop
a cycle or lose the error that was being reported.
"""

from __future__ import annotations

import re
from typing import Any

PLACEHOLDER = "[redacted]"

# Values shorter than this are not treated as secrets even if a Settings field holds
# them: blanking every occurrence of a three-character string would shred the message.
_MIN_SECRET_LENGTH = 8

_SECRET_FIELDS = (
    "alpaca_api_key",
    "alpaca_secret_key",
    "openrouter_key",
    "llm_fallback_key",
    "supabase_service_role_key",
)

_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    # Query parameters first, so a `?apikey=` is handled as a URL rather than as a header.
    (
        re.compile(
            r"(?i)([?&](?:api[_-]?key|apikey|access[_-]?token|token|key|secret)=)[^&\s\"']+"
        ),
        r"\1" + PLACEHOLDER,
    ),
    # `Authorization: Bearer <token>` and the header spellings around it. The optional
    # scheme is consumed with the token so the token cannot be left behind.
    (
        re.compile(r"(?i)\b(authorization|apikey|api[_-]key|x-api-key)\s*:\s*(?:\w+\s+)?\S+"),
        r"\1: " + PLACEHOLDER,
    ),
    # A bare `Bearer <token>` with no header name in front of it.
    (re.compile(r"(?i)\bbearer\s+\S+"), "Bearer " + PLACEHOLDER),
    # A JWT — three dot-separated base64url segments, which is what Supabase issues.
    (re.compile(r"\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}"), PLACEHOLDER),
    # The Supabase project reference, which identifies the database to anyone who reads it.
    (re.compile(r"\bhttps://[a-z0-9]{16,}\.supabase\.co"), f"https://{PLACEHOLDER}.supabase.co"),
)


def _known_secrets() -> list[str]:
    """Secret-shaped values from `Settings`, longest first so a key that contains another
    key's prefix is replaced whole. Returns an empty list if settings cannot be loaded —
    unconfigured is a normal state for the read-only scripts."""
    try:
        from app.config import get_settings

        settings: Any = get_settings()
    except Exception:  # noqa: BLE001 — redaction must work even with no configuration
        return []
    values = [getattr(settings, name, None) for name in _SECRET_FIELDS]
    return sorted(
        {v for v in values if isinstance(v, str) and len(v) >= _MIN_SECRET_LENGTH},
        key=len,
        reverse=True,
    )


def redact(text: str) -> str:
    """Scrub credentials out of a string that is about to be stored or printed."""
    if not text:
        return text
    try:
        out = text
        for secret in _known_secrets():
            out = out.replace(secret, PLACEHOLDER)
        for pattern, replacement in _PATTERNS:
            out = pattern.sub(replacement, out)
        return out
    except Exception:  # noqa: BLE001 — never lose the message we were trying to report
        return text


def describe_exception(exc: BaseException, *, limit: int = 300) -> str:
    """The standard way this project turns a third-party exception into stored text:
    the type name, the redacted message, truncated."""
    return redact(f"{type(exc).__name__}: {exc}")[:limit]
