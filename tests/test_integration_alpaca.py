"""Integration tests: hit the real Alpaca paper trading API with .env credentials.

Marked `integration` — not part of the default fast unit-test run. Run explicitly with:
    pytest -m integration
"""

import pytest

from app.alpaca_client import assert_paper_trading, get_trading_client
from app.config import get_settings

pytestmark = pytest.mark.integration


@pytest.fixture(scope="module")
def client():
    settings = get_settings()
    return get_trading_client(settings)


def test_client_is_paper(client):
    assert_paper_trading(client)  # raises NotPaperAccountError if not — see app/alpaca_client.py


def test_get_account_returns_expected_shape(client):
    account = client.get_account()
    assert account.account_number
    assert account.status is not None
    assert account.currency == "USD"


def test_get_all_positions_returns_a_list(client):
    positions = client.get_all_positions()
    assert isinstance(positions, list)
