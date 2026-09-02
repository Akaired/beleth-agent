"""Starting a cycle: read the configuration, build the clients.

Two small functions, separated from everything else because they are the only part of
the cycle that touches process-level state — the environment, the strategy file on disk,
the clock — and because a test wants to replace them wholesale.
"""

from __future__ import annotations

import sys
from datetime import datetime

from app.alpaca_client import (
    get_option_data_client,
    get_stock_data_client,
    get_trading_client,
)
from app.config import (
    ConfigError,
    Settings,
    default_symbol,
    get_settings,
    load_strategy_config,
)
from app.cycle.context import Clients, CycleConfig
from app.market.calendar import EASTERN


def load_cycle_config(argv: list[str]) -> tuple[Settings, CycleConfig] | None:
    """Settings plus the cycle's own configuration, or ``None`` after printing why.

    The clock is read once here and carried in `CycleConfig`: every stage measures
    tenors and calendar windows against the same instant, so a cycle cannot block a
    tenor in one stage and build it in another.
    """
    symbol = argv[1].upper() if len(argv) > 1 else default_symbol()
    try:
        settings = get_settings()
    except ConfigError as exc:
        print(exc, file=sys.stderr)
        return None
    strategy = load_strategy_config()
    return settings, CycleConfig(
        symbol=symbol,
        strategy=strategy,
        today_ordinal=datetime.now().toordinal(),
        now_et=datetime.now(EASTERN),
    )


def build_clients(settings: Settings) -> Clients:
    """The three Alpaca clients. Paper-only is guaranteed inside
    `get_trading_client`, which asserts the endpoint before handing a client out."""
    return Clients(
        trading=get_trading_client(settings),
        options=get_option_data_client(settings),
        stocks=get_stock_data_client(settings),
    )
