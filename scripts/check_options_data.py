#!/usr/bin/env python3
"""Fetch SPY's option chain across the tenor ladder and apply the delta filter.

Verifies option chain + Greeks/IV retrieval works, and that the delta filter shrinks the
payload enough to respect the free-model token budget (see app/options/filter.py). For the full
market-context picture — VIX regime, realized vol, term structure, per-tenor VRP, spread
candidates — use scripts/check_market_data.py instead.

Usage:
    python3 scripts/check_options_data.py [SYMBOL]
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.alpaca_client import get_option_data_client  # noqa: E402
from app.config import ConfigError, get_settings, load_strategy_config  # noqa: E402
from app.options.chain import fetch_chain_for_ladder  # noqa: E402
from app.options.filter import filter_relevant_contracts  # noqa: E402


def main() -> int:
    symbol = sys.argv[1] if len(sys.argv) > 1 else "SPY"

    try:
        settings = get_settings()
    except ConfigError as exc:
        print(exc, file=sys.stderr)
        return 1

    strategy = load_strategy_config()
    structure = strategy["structure"]
    dte_ladder = strategy["tenor_scan"]["dte_ladder"]

    client = get_option_data_client(settings)

    print(f"Fetching {symbol} chain covering the DTE ladder {dte_ladder}...")
    snapshots = fetch_chain_for_ladder(client, symbol, dte_ladder)
    print(f"Chain size: {len(snapshots)} contracts")

    with_iv = [s for s in snapshots.values() if s.implied_volatility is not None]
    print(f"Contracts with implied_volatility present: {len(with_iv)}")

    if with_iv:
        atm_like = sorted(with_iv, key=lambda s: abs((s.greeks.delta if s.greeks else 1) - 0.5))
        sample_iv = atm_like[0].implied_volatility
        print(f"Sample IV (contract {atm_like[0].symbol}): {sample_iv:.4f}")
    else:
        print("No IV data returned — check the feed/subscription.")

    relevant = filter_relevant_contracts(
        snapshots,
        delta_min=structure["short_leg_delta_min"],
        delta_max=structure["short_leg_delta_max"],
    )
    print(f"\nRelevant contracts after delta filter "
          f"({structure['short_leg_delta_min']}-{structure['short_leg_delta_max']} delta): "
          f"{len(relevant)}")
    for c in relevant[:10]:
        print(f"  {c.symbol}: delta={c.delta:.3f} iv={c.implied_volatility}")
    if len(relevant) > 10:
        print(f"  ... and {len(relevant) - 10} more")

    # Rough token estimate: count of the filtered payload we'd actually send to the LLM.
    payload = [
        {
            "symbol": c.symbol,
            "delta": round(c.delta, 4),
            "iv": round(c.implied_volatility, 4) if c.implied_volatility else None,
        }
        for c in relevant
    ]
    payload_json = json.dumps(payload)
    approx_tokens = len(payload_json) // 4  # rough chars/4 heuristic, not exact
    print(f"\nFiltered payload size: {len(payload_json)} chars (~{approx_tokens} tokens, rough estimate)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
