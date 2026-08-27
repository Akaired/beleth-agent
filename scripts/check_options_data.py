#!/usr/bin/env python3
"""Fetch SPY's option chain, compute IV rank, and apply the delta filter.

Milestone 1, step 4: verify option chain + Greeks/IV retrieval works, and that the delta
filter actually shrinks the payload enough to respect the Regolo token budget (see
app/options/filter.py). Also reports the current IV rank status — expect "insufficient
history" on day 1, since Alpaca has no historical-IV endpoint (see app/options/iv_rank.py).

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
from app.options.chain import fetch_chain  # noqa: E402
from app.options.filter import filter_relevant_contracts  # noqa: E402
from app.options.iv_rank import compute_iv_rank  # noqa: E402


def main() -> int:
    symbol = sys.argv[1] if len(sys.argv) > 1 else "SPY"

    try:
        settings = get_settings()
    except ConfigError as exc:
        print(exc, file=sys.stderr)
        return 1

    strategy = load_strategy_config()
    structure = strategy["structure"]
    entry = strategy["entry"]

    client = get_option_data_client(settings)

    print(f"Fetching {symbol} chain, expiry {structure['expiry_days_min']}"
          f"-{structure['expiry_days_max']} days...")
    snapshots = fetch_chain(
        client,
        symbol,
        expiry_days_min=structure["expiry_days_min"],
        expiry_days_max=structure["expiry_days_max"],
    )
    print(f"Chain size: {len(snapshots)} contracts")

    with_iv = [s for s in snapshots.values() if s.implied_volatility is not None]
    print(f"Contracts with implied_volatility present: {len(with_iv)}")

    if with_iv:
        atm_like = sorted(with_iv, key=lambda s: abs((s.greeks.delta if s.greeks else 1) - 0.5))
        sample_iv = atm_like[0].implied_volatility
        print(f"Sample IV (contract {atm_like[0].symbol}): {sample_iv:.4f}")

        # No persisted history yet on day 1 — see app/options/iv_rank.py docstring.
        iv_result = compute_iv_rank(
            history=[], current_iv=sample_iv, lookback_days=entry["iv_rank_lookback_days"]
        )
        if iv_result.has_sufficient_history:
            print(f"IV rank: {iv_result.rank:.1f}")
        else:
            print(
                f"IV rank: insufficient history "
                f"({iv_result.history_points}/{iv_result.lookback_days} days) — "
                "will populate as the agent persists daily IV readings."
            )
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
