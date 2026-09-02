#!/usr/bin/env python3
"""Order-path verification against the real Alpaca paper account.

Two modes:

* ``--dry-run`` (default) — the full pre-trade pipeline on live data: real chain, real
  account state, the R4/R6/R7 gate, then sizing, pricing and ``build_mleg_order`` for the
  best gate-approved candidate. Prints the exact payload the SDK would POST and exits.
  Nothing is submitted, nothing is persisted.
* ``--probe`` — a controlled LIVE submission that answers the one thing offline tests
  cannot: does Alpaca read a negative mleg ``limit_price`` as a net credit, as the
  alpaca-py SDK documents? It submits ONE spread (qty=1, smallest approved strike width)
  at a deliberately UNFILLABLE credit demand (measured credit + $1.00 — no counterparty
  pays more than market, so under the documented convention the order must rest, never
  fill), then reads the order back, cancels it, and confirms the cancellation. If the
  convention were inverted, the order would be an immediately-marketable debit — the
  script reports that loudly, and the position it opens is a defined-risk vertical.

The probe is an operator diagnostic, not an agent cycle: it runs through the per-candidate
risk gate (R4/R6/R7 — no order without it) but deliberately skips the
strategy-entry filters (VRP threshold, macro calendar), which belong to the cycle, and it
persists nothing — the decision and trades logs stay the agent's own record.

Usage:
    python3 scripts/check_order_path.py [--probe] [--symbol SPY]
"""

from __future__ import annotations

import json
import math
import sys
import time
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from alpaca.trading.requests import GetOrderByIdRequest

from app.alpaca_client import (
    assert_paper_trading,
    fetch_account,
    fetch_order,
    fetch_positions,
    get_option_data_client,
    get_trading_client,
    money,
)
from app.config import ConfigError, get_settings, load_strategy_config
from app.options.chain import fetch_chain_for_ladder
from app.options.spreads import SpreadCandidate, build_candidates
from app.orders import (
    OrderSubmissionError,
    build_mleg_order,
    compute_quantity,
    credit_limit_price,
    describe_legs,
    submit_mleg_order,
)
from app.risk_check import AccountRiskState, evaluate_candidates

# The probe demands this much MORE credit than measured, so the order cannot fill under
# the documented convention (credit = negative limit): it must rest and be cancel-able.
PROBE_EXTRA_CREDIT_DEMAND = 1.0
TERMINAL_STATUSES = {"filled", "canceled", "expired", "rejected"}


def best_candidate(
    candidates: list[SpreadCandidate], risk_state: AccountRiskState, strategy: dict
) -> tuple[SpreadCandidate, object] | None:
    """The smallest-width gate-approved candidate — bounds the probe's worst case."""
    verdicts = evaluate_candidates(candidates, risk_state, strategy)
    approved = [v for v in verdicts if v.approved and v.candidate.get("max_loss")]
    if not approved:
        return None
    approved.sort(key=lambda v: (v.candidate["strike_width"], v.candidate["max_loss"]))
    best = approved[0]
    for candidate in candidates:
        if (
            candidate.right == best.candidate["right"]
            and candidate.expiry == best.candidate["expiry"]
            and candidate.short_symbol == best.candidate["short_symbol"]
            and candidate.long_symbol == best.candidate["long_symbol"]
        ):
            return candidate, best
    return None


def main() -> int:
    submit_probe = "--probe" in sys.argv
    symbol = "SPY"
    if "--symbol" in sys.argv:
        symbol = sys.argv[sys.argv.index("--symbol") + 1]

    try:
        settings = get_settings()
    except ConfigError as exc:
        print(exc, file=sys.stderr)
        return 1
    strategy = load_strategy_config()
    structure = strategy["structure"]

    trading = get_trading_client(settings)
    assert_paper_trading(trading)  # never a live endpoint
    account = fetch_account(trading)
    equity = money(account.equity, "equity")
    positions = fetch_positions(trading)
    risk_state = AccountRiskState(
        equity=equity,
        open_positions=len(positions),
        day_pnl=round(equity - money(account.last_equity, "last_equity"), 2),
        capital_at_risk=0.0,
    )

    option_client = get_option_data_client(settings)
    chain = fetch_chain_for_ladder(option_client, symbol, strategy["tenor_scan"]["dte_ladder"])
    candidates = build_candidates(
        chain,
        underlying=symbol,
        target_dtes=strategy["tenor_scan"]["dte_ladder"],
        today_ordinal=datetime.now().toordinal(),
        delta_min=structure["short_leg_delta_min"],
        delta_max=structure["short_leg_delta_max"],
        width_min=structure["strike_width_usd_min"],
        width_max=structure["strike_width_usd_max"],
    )
    print(
        f"account equity {equity:.2f}, {len(candidates)} candidate(s) built, "
        f"{risk_state.open_positions} position(s) open",
        file=sys.stderr,
    )

    found = best_candidate(candidates, risk_state, strategy)
    if found is None:
        print(
            "No candidate passed the risk gate — nothing to build an order from. "
            "This is a legitimate outcome, not a failure.",
            file=sys.stderr,
        )
        return 0
    candidate, _verdict = found
    print(
        f"gate-approved candidate: {candidate.right} {candidate.short_strike}/"
        f"{candidate.long_strike} exp {candidate.expiry} "
        f"(width {candidate.strike_width:.2f}, credit {candidate.credit})",
        file=sys.stderr,
    )

    if submit_probe:
        # Probe pricing: demand MORE credit than measured — unfillable if (and only if)
        # the documented convention holds. qty is pinned to 1: this is a contract check,
        # not a trade.
        limit: float | None
        credit = candidate.credit
        if credit is None or credit <= 0:
            print("candidate has no credit to probe with", file=sys.stderr)
            return 1
        qty = 1
        # Alpaca rejects limit prices beyond 2 decimal places (caught by this very probe:
        # 42210000 "limit price must be limited to 2 decimal places") — floor the demand.
        limit = -math.floor((credit + PROBE_EXTRA_CREDIT_DEMAND) * 100) / 100
        client_order_id = "beleth-probe-1"
    else:
        # Dry-run pricing: exactly what a real cycle would send.
        qty = compute_quantity(
            equity, strategy["risk"]["max_risk_per_trade_pct_of_equity"], candidate.max_loss
        )
        limit = credit_limit_price(candidate.credit, structure["credit_slippage_usd"])
        if qty < 1 or limit is None:
            print(
                f"no sendable plan (qty={qty}, limit={limit}) — fail-closed, which is correct",
                file=sys.stderr,
            )
            return 0
        client_order_id = "beleth-dryrun"

    request = build_mleg_order(candidate, qty, limit, client_order_id)
    print("\n--- order request (exactly what the SDK POSTs) ---", file=sys.stderr)
    print(json.dumps(request.to_request_fields(), indent=2), file=sys.stderr)
    print("\nlegs:", json.dumps(describe_legs(candidate), indent=2, default=str), file=sys.stderr)

    if not submit_probe:
        print(
            "\nDRY RUN — nothing submitted. Re-run with --probe to submit/cancel one "
            "real order on the paper account.",
            file=sys.stderr,
        )
        return 0

    # --- live probe: submit -> read back -> cancel -> confirm ---------------------------
    print("\n--- live probe: submitting one unfillable-credit order ---", file=sys.stderr)
    try:
        order = submit_mleg_order(trading, request)
    except OrderSubmissionError as exc:
        print(f"PROBE RESULT: submission REJECTED by Alpaca — {exc}", file=sys.stderr)
        print(
            "If the rejection complains about the negative limit price, the credit "
            "convention differs from the alpaca-py SDK docstring and app/orders.py must "
            "be fixed before any real cycle trades.",
            file=sys.stderr,
        )
        return 1

    order_id = str(order["id"])
    print(f"submitted: id={order_id} status={order.get('status')}", file=sys.stderr)

    time.sleep(2)
    try:
        current = fetch_order(trading, order_id, filter=GetOrderByIdRequest(nested=True))
        status = str(current.status)
        filled = float(current.filled_qty or 0)
    except Exception as exc:  # noqa: BLE001 — report and still try to cancel
        print(f"WARNING: read-back failed ({exc}) — cancelling anyway", file=sys.stderr)
        status, filled = str(order.get("status")), 0.0

    sign_confirmed = filled == 0 and status not in ("filled",)
    print(
        f"read-back: status={status} filled_qty={filled} -> "
        + (
            "negative limit treated as CREDIT (order rests unfillable) — convention CONFIRMED"
            if sign_confirmed
            else "order FILLED — the negative-limit convention is INVERTED; fix app/orders.py"
        ),
        file=sys.stderr,
    )

    try:
        trading.cancel_order_by_id(order_id)
        time.sleep(2)
        current = fetch_order(trading, order_id, filter=GetOrderByIdRequest(nested=True))
        print(f"after cancel: status={current.status} filled_qty={current.filled_qty}", file=sys.stderr)
    except Exception as exc:  # noqa: BLE001 — report loudly, the order may need manual cancel
        print(f"ERROR: cancellation failed ({exc}) — cancel order {order_id} by hand", file=sys.stderr)
        return 1

    if not sign_confirmed:
        return 1
    print(
        "\nPROBE PASS: mleg order accepted on the paper account, negative limit read as "
        "net credit, order canceled cleanly. The order path's API contract is verified.",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
