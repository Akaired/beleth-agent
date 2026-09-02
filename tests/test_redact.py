"""Redaction of anything bound for the database.

The decision log is a public artifact — `decisions.llm_reasoning`, `trades.raw` and
`agent_events` all quote exception text from SDKs we do not control. A credential that
reaches one of those columns is published, so the scrubbing is covered here rather
than trusted.
"""

from __future__ import annotations

import app.redact as redact_mod
from app.redact import PLACEHOLDER, describe_exception, redact


def test_a_message_with_nothing_to_hide_is_returned_unchanged():
    assert redact("submit_order rejected: limit price must have 2 decimal places") == (
        "submit_order rejected: limit price must have 2 decimal places"
    )
    assert redact("") == ""


def test_query_string_credentials_are_scrubbed_but_the_url_stays_readable():
    out = redact("GET https://data.alpaca.markets/v2/x?api_key=ABCDEFGH&symbol=SPY failed")
    assert "ABCDEFGH" not in out
    assert "symbol=SPY" in out
    assert "data.alpaca.markets" in out


def test_the_token_is_removed_with_its_scheme_not_left_behind():
    out = redact("Authorization: Bearer sk-or-v1-deadbeefdeadbeefdeadbeef")
    assert "sk-or-v1" not in out
    assert "Bearer sk" not in out
    assert PLACEHOLDER in out


def test_a_bare_bearer_token_is_scrubbed_too():
    assert "deadbeefdeadbeef" not in redact("retry with Bearer deadbeefdeadbeef")


def test_a_supabase_jwt_is_scrubbed():
    jwt = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJl"
    assert jwt not in redact(f"apikey header was {jwt}")


def test_the_supabase_project_reference_is_scrubbed():
    out = redact("Supabase POST https://abcdefghijklmnopq.supabase.co/rest/v1/decisions failed")
    assert "abcdefghijklmnopq" not in out
    assert "/rest/v1/decisions" in out  # the path still says what failed


def test_configured_secrets_are_matched_literally(monkeypatch):
    """The pass that actually protects us: a key that matches no pattern at all is still
    removed because Settings holds it."""
    secret = "not-shaped-like-anything-8f3a"
    monkeypatch.setattr(redact_mod, "_known_secrets", lambda: [secret])
    assert secret not in redact(f"provider said: {secret} is invalid")


def test_a_short_settings_value_is_not_treated_as_a_secret(monkeypatch):
    """Blanking every occurrence of a three-character string would shred the message."""

    class _S:
        alpaca_api_key = "abc"
        alpaca_secret_key = None
        openrouter_key = None
        llm_fallback_key = None
        supabase_service_role_key = None

    monkeypatch.setattr("app.config.get_settings", lambda: _S())
    assert redact_mod._known_secrets() == []


def test_redaction_never_raises_and_never_loses_the_message(monkeypatch):
    def boom():
        raise RuntimeError("no settings here")

    monkeypatch.setattr(redact_mod, "_known_secrets", boom)
    assert redact("the original message") == "the original message"


def test_missing_configuration_is_a_normal_state(monkeypatch):
    def boom():
        raise RuntimeError("unconfigured")

    monkeypatch.setattr("app.config.get_settings", boom)
    assert redact_mod._known_secrets() == []


def test_describe_exception_names_the_type_and_truncates():
    exc = ValueError("x" * 500)
    out = describe_exception(exc)
    assert out.startswith("ValueError: ")
    assert len(out) == 300
    assert len(describe_exception(exc, limit=50)) == 50


def test_describe_exception_redacts_the_message():
    exc = RuntimeError("https://api.example/v1?token=SUPERSECRETVALUE")
    assert "SUPERSECRETVALUE" not in describe_exception(exc)
