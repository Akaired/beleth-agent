"""The paper-trading guarantee (hard constraint #1) and the raw-data narrowing.

`get_trading_client` is the single door to a trading client in this project, so the
paper-endpoint check belongs there rather than in each caller — the caller that
actually submits orders never called it. These tests cover both branches of the
check, including the failing one, which no integration test can reach on purpose.
"""

from __future__ import annotations

import pytest
from alpaca.common.enums import BaseURL

from app.alpaca_client import (
    NotPaperAccountError,
    assert_paper_trading,
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
