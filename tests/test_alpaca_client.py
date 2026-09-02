"""The paper-trading guarantee (hard constraint #1) and the raw-data narrowing.

`get_trading_client` is the single door to a trading client in this project, so the
paper-endpoint check belongs there rather than in each caller — the caller that
actually submits orders never called it. These tests cover both branches of the
check, including the failing one, which no integration test can reach on purpose.
"""

from __future__ import annotations

import pytest
import requests
from alpaca.common.enums import BaseURL

from app.alpaca_client import (
    NotPaperAccountError,
    _TimeoutSession,
    assert_paper_trading,
    get_option_data_client,
    get_stock_data_client,
    get_trading_client,
    model_response,
    money,
)
from app.config import Settings


class _FakeClient:
    def __init__(self, base_url: object) -> None:
        self._base_url = base_url


def _settings() -> Settings:
    return Settings(
        alpaca_api_key="k",
        alpaca_secret_key="s",
        openrouter_key="o",
    )


def test_get_trading_client_returns_a_paper_client():
    client = get_trading_client(_settings())
    assert client._base_url == BaseURL.TRADING_PAPER


def test_get_trading_client_refuses_a_live_endpoint(monkeypatch):
    """If a future change ever pointed the client at live, the factory must fail loudly
    rather than hand the client out."""
    import app.alpaca_client as mod

    def live_client(**_kwargs):
        return _FakeClient(BaseURL.TRADING_LIVE)

    monkeypatch.setattr(mod, "TradingClient", live_client)
    with pytest.raises(NotPaperAccountError) as exc:
        get_trading_client(_settings())
    assert "paper-trading only" in str(exc.value)


def test_assert_paper_trading_accepts_the_paper_endpoint():
    assert_paper_trading(_FakeClient(BaseURL.TRADING_PAPER))  # type: ignore[arg-type]


def test_assert_paper_trading_rejects_anything_else():
    with pytest.raises(NotPaperAccountError):
        assert_paper_trading(_FakeClient("https://api.alpaca.markets"))  # type: ignore[arg-type]


def test_model_response_passes_models_through_and_refuses_raw_data():
    sentinel = object()
    assert model_response(sentinel) is sentinel
    with pytest.raises(TypeError):
        model_response({"id": "raw"})


def test_money_names_the_field_it_could_not_read():
    assert money("12.5", "equity") == 12.5
    assert money(3, "cash") == 3.0
    with pytest.raises(ValueError, match="last_equity"):
        money(None, "last_equity")


def test_every_client_gets_a_session_with_a_timeout():
    """alpaca-py calls `requests` with no timeout, so a hung socket would stall a whole
    cycle — with an order possibly already live at the broker."""
    settings = _settings()
    for factory in (get_trading_client, get_option_data_client, get_stock_data_client):
        session = factory(settings)._session
        assert isinstance(session, _TimeoutSession), factory.__name__
        assert session._timeout == settings.alpaca_http_timeout_seconds


def test_the_timeout_is_configurable_and_not_a_literal():
    settings = Settings(
        alpaca_api_key="k",
        alpaca_secret_key="s",
        openrouter_key="o",
        alpaca_http_timeout_seconds=1.5,
    )
    assert get_trading_client(settings)._session._timeout == 1.5


def test_timeout_session_defaults_the_timeout_but_lets_a_caller_override_it():
    calls: list[object] = []

    class _Recording(_TimeoutSession):
        def request(self, *args, **kwargs):  # type: ignore[override]
            kwargs.setdefault("timeout", self._timeout)
            calls.append(kwargs.get("timeout"))
            return requests.Response()

    session = _Recording(7.0)
    session.request("GET", "https://example.invalid")
    session.request("GET", "https://example.invalid", timeout=0.5)
    assert calls == [7.0, 0.5]


def test_the_sdk_still_exposes_the_session_we_patch():
    """`_with_timeout` reaches into alpaca-py's private `_session`. If a future version
    renames it, the patch would silently do nothing and every call would go back to
    waiting forever — so assert the attribute is there, and is a plain session before
    we swap it."""
    from alpaca.trading.client import TradingClient

    raw = TradingClient(api_key="k", secret_key="s", paper=True)
    assert isinstance(raw._session, requests.Session)
    assert not isinstance(raw._session, _TimeoutSession)
