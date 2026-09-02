import pytest
from pydantic import ValidationError

from app.config import (
    PAPER_BASE_URL,
    ConfigError,
    Settings,
    default_symbol,
    load_strategy_config,
    universe_symbols,
)


def test_requires_alpaca_and_openrouter_credentials(monkeypatch):
    monkeypatch.delenv("ALPACA_API_KEY", raising=False)
    monkeypatch.delenv("ALPACA_SECRET_KEY", raising=False)
    monkeypatch.delenv("OPENROUTER_KEY", raising=False)
    with pytest.raises(ValidationError):
        Settings(_env_file=None)


def test_defaults_to_paper_endpoint(monkeypatch):
    settings = Settings(
        _env_file=None,
        alpaca_api_key="k",
        alpaca_secret_key="s",
        openrouter_key="r",
    )
    assert settings.alpaca_base_url == PAPER_BASE_URL


def test_rejects_non_paper_endpoint():
    with pytest.raises(ValidationError):
        Settings(
            _env_file=None,
            alpaca_api_key="k",
            alpaca_secret_key="s",
            openrouter_key="r",
            alpaca_base_url="https://api.alpaca.markets",
        )


def test_supabase_fields_are_optional():
    settings = Settings(
        _env_file=None,
        alpaca_api_key="k",
        alpaca_secret_key="s",
        openrouter_key="r",
    )
    assert settings.supabase_url is None
    assert settings.supabase_service_role_key is None
    assert settings.agent_version == "dev"


def test_supabase_url_must_be_https():
    with pytest.raises(ValidationError):
        Settings(
            _env_file=None,
            alpaca_api_key="k",
            alpaca_secret_key="s",
            openrouter_key="r",
            supabase_url="http://abc.supabase.co",
        )


def test_strategy_config_loads_expected_shape():
    config = load_strategy_config()
    assert "SPY" in config["universe"]["symbols"]
    assert config["structure"]["short_leg_delta_min"] < config["structure"]["short_leg_delta_max"]
    assert config["risk"]["max_concurrent_positions"] > 0


def test_an_empty_environment_variable_means_unset():
    """Deployment systems that forward a fixed list of variables pass empty strings for
    the ones nobody configured — compose.yaml does. Without this, an unset optional value
    is a startup crash instead of a default."""
    settings = Settings(
        alpaca_api_key="k",
        alpaca_secret_key="s",
        openrouter_key="o",
        alpaca_http_timeout_seconds="",  # type: ignore[arg-type]
        openrouter_model="",
        llm_fallback_key="",
    )
    assert settings.alpaca_http_timeout_seconds == 30.0
    assert settings.openrouter_model  # the module default, not ""
    assert settings.llm_fallback_key is None


def test_an_empty_required_value_is_reported_as_missing_not_as_a_parse_error():
    with pytest.raises(ValidationError) as exc:
        Settings(alpaca_api_key="", alpaca_secret_key="s", openrouter_key="o")
    assert exc.value.errors()[0]["type"] == "missing"


def test_universe_symbols_reads_and_uppercases_the_configured_list():
    assert universe_symbols({"universe": {"symbols": ["spy", " qqq "]}}) == ["SPY", "QQQ"]


def test_universe_symbols_refuses_an_empty_universe_instead_of_defaulting():
    """Five places used to fall back to a bare "SPY". An agent with nothing to trade is
    a configuration mistake, and substituting a symbol hides it."""
    for empty in ({}, {"universe": {}}, {"universe": {"symbols": []}}):
        with pytest.raises(ConfigError, match="nothing to trade"):
            universe_symbols(empty)


def test_default_symbol_is_the_first_of_the_universe():
    assert default_symbol({"universe": {"symbols": ["qqq", "spy"]}}) == "QQQ"


def test_the_shipped_config_has_a_usable_universe():
    assert universe_symbols()[0] == default_symbol()
