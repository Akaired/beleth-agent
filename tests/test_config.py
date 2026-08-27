import pytest
from pydantic import ValidationError

from app.config import PAPER_BASE_URL, Settings, load_strategy_config


def test_requires_alpaca_and_regolo_credentials(monkeypatch):
    monkeypatch.delenv("ALPACA_API_KEY", raising=False)
    monkeypatch.delenv("ALPACA_SECRET_KEY", raising=False)
    monkeypatch.delenv("REGOLO_KEY", raising=False)
    with pytest.raises(ValidationError):
        Settings(_env_file=None)


def test_defaults_to_paper_endpoint(monkeypatch):
    settings = Settings(
        _env_file=None,
        alpaca_api_key="k",
        alpaca_secret_key="s",
        regolo_key="r",
    )
    assert settings.alpaca_base_url == PAPER_BASE_URL


def test_rejects_non_paper_endpoint():
    with pytest.raises(ValidationError):
        Settings(
            _env_file=None,
            alpaca_api_key="k",
            alpaca_secret_key="s",
            regolo_key="r",
            alpaca_base_url="https://api.alpaca.markets",
        )


def test_strategy_config_loads_expected_shape():
    config = load_strategy_config()
    assert "SPY" in config["universe"]["symbols"]
    assert config["structure"]["short_leg_delta_min"] < config["structure"]["short_leg_delta_max"]
    assert config["risk"]["max_concurrent_positions"] > 0
