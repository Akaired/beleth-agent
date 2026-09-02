"""Reading the account: what is open, what it is worth, what it may still risk.

The one thing worth stating plainly is why the underlying price is fetched per spread
rather than once per cycle. The short-leg ITM exit rule compares a spread's short strike
against its *own* symbol's price. A QQQ cycle measuring an SPY spread against QQQ's
price would misread in-the-money and could fire a spurious close — so the price is
looked up per distinct root, and a failed lookup disables only the ITM rule for that
symbol rather than the whole exit path.
"""

from __future__ import annotations

import sys
from typing import Any

from alpaca.trading.enums import QueryOrderStatus
from alpaca.trading.requests import GetOrdersRequest

from app.alpaca_client import fetch_account, fetch_clock, fetch_positions, money
from app.cycle.context import AccountState, Clients, CycleConfig
from app.cycle.open_orders import resting_entry_leg_sets
from app.evidence import AccountSnapshot
from app.exits import ExitEvaluation, evaluate_exit, pair_open_spreads
from app.market.underlying import fetch_last_price
from app.options.chain import fetch_latest_quotes
from app.redact import describe_exception
from app.risk_check import AccountRiskState


def _underlying_prices_for_spreads(
    stock_client: Any, spreads: list[Any]
) -> dict[str, float | None]:
    """Last price of each spread's OWN underlying, one fetch per distinct symbol.

    The short-leg ITM rule compares a spread's short strike against its own symbol's
    price — never the cycle's symbol: a QQQ cycle measuring an SPY spread against
    QQQ's price would misread ITM/OTM and could trigger a spurious close. A failed
    quote only disables the ITM rule for that symbol (fail-safe, not fail-spurious);
    the P/L rules keep working off the leg quotes.
    """
    prices: dict[str, float | None] = {}
    for spread in spreads:
        root = spread.root
        if root in prices:
            continue
        try:
            prices[root] = fetch_last_price(stock_client, root)
        except Exception as exc:  # noqa: BLE001 — see docstring: ITM rule off, nothing worse
            prices[root] = None
            print(
                f"WARNING: last price for {root} unavailable "
                f"({describe_exception(exc)}) — its short-leg ITM exit rule "
                "cannot fire this cycle.",
                file=sys.stderr,
            )
    return prices


def gather_account_state(clients: Clients, cfg: CycleConfig) -> AccountState:
    """The account as this cycle finds it, and what that means for new risk.

    Four things happen here, in this order, and the order matters:

    1. **The account is read** — equity, positions, the market clock.
    2. **Open legs are paired back into spreads** (`app.exits.pair_open_spreads`) and
       each is measured against the R5 exit rules. Exits are mechanical risk management,
       never LLM-gated: the pairing runs every cycle whatever the decision turns out to
       be. A leg that will not pair, or a spread whose entry credit cannot be computed,
       becomes an `entry_block` — the gate must not add risk it cannot size.
    3. **Resting orders are listed** — but only while the market is open. A resting entry
       order is committed-but-invisible risk, and a listing failure is fail-closed for
       *both* paths: no closings and no new entries this cycle.
    4. **Capital at risk is totalled** from the paired spreads' known max loss, which is
       what R11's aggregate cap measures against.

    Everything that would refuse a new entry regardless of a candidate's own merits ends
    up in `entry_blocks`, each tagged with a `kind`, so the R10 rejection row can tell a
    resting order apart from a position anomaly apart from an unreadable order book.
    """
    # --- account ------------------------------------------------------------------
    account = fetch_account(clients.trading)
    positions = fetch_positions(clients.trading)
    clock = fetch_clock(clients.trading)

    # --- R5: open legs paired back into spreads, measured against the exit rules ---------
    # Exits are mechanical risk management, never LLM-gated: the pairing runs every cycle
    # and each spread's R5 verdict is persisted like any other check.
    # Anomalies — naked legs, unparseable positions — and spreads without a computable
    # entry credit block new entries: the gate must not add risk it cannot size.
    position_dumps = [p.model_dump(mode="json") for p in positions]
    open_spreads, position_anomalies = pair_open_spreads(position_dumps)

    leg_symbols = sorted(
        {sym for spread in open_spreads for sym in (spread.short_symbol, spread.long_symbol)}
    )
    leg_quotes: dict[str, tuple[float | None, float | None]] = {}
    if leg_symbols:
        try:
            leg_quotes = fetch_latest_quotes(clients.options, leg_symbols)
        except Exception as exc:  # noqa: BLE001 — unquotable legs must not kill the cycle
            print(
                f"WARNING: quotes for open legs unavailable ({describe_exception(exc)}) "
                "— the P/L exit rules cannot fire this cycle (the ITM rule still can).",
                file=sys.stderr,
            )

    exit_cfg = cfg.strategy["exit"]
    exit_evaluations: list[ExitEvaluation] = []
    underlying_prices = _underlying_prices_for_spreads(clients.stocks, open_spreads)
    for spread in open_spreads:
        short_bid, short_ask = leg_quotes.get(spread.short_symbol, (None, None))
        long_bid, long_ask = leg_quotes.get(spread.long_symbol, (None, None))
        exit_evaluations.append(
            evaluate_exit(
                spread,
                short_bid=short_bid,
                short_ask=short_ask,
                long_bid=long_bid,
                long_ask=long_ask,
                underlying_last=underlying_prices[spread.root],
                profit_target_pct=exit_cfg["profit_target_pct_of_max_credit"],
                loss_multiple=exit_cfg["loss_close_credit_multiple"],
                exit_on_short_itm=exit_cfg["loss_close_on_short_leg_itm"],
            )
        )
    triggered_exits = [e for e in exit_evaluations if e.triggered]

    # Open orders must be visible before anything trades: a resting entry order is
    # committed-but-invisible risk (not yet a position, so open_positions and
    # capital_at_risk do not see it) and the resident loop would otherwise stack a new
    # entry order on top of it every few minutes. A listing failure is fail-closed for
    # BOTH paths: no closings and no new entries this cycle.
    open_orders: list[Any] = []
    open_orders_error = ""
    if clock.is_open:
        try:
            open_orders = list(
                clients.trading.get_orders(
                    GetOrdersRequest(status=QueryOrderStatus.OPEN, nested=True)
                )
            )
        except Exception as exc:  # noqa: BLE001 — unknown order state must not cause more orders
            open_orders_error = describe_exception(exc)
            print(
                "WARNING: cannot list open orders "
                f"({open_orders_error}) — no closings and no new entries this cycle "
                "(fail-closed).",
                file=sys.stderr,
            )
        # Always visible in the logs: a resting order the cycle cannot see stays invisible
        # unless this count is printed every fetch.
        print(f"open orders listed: {len(open_orders)}", flush=True)

    # The risk gate counts positions in spreads (the strategy's unit), not raw legs.
    open_position_count = len(open_spreads) + len(position_anomalies)
    # Each block is tagged with a ``kind`` so the R10 rejection row can tell a resting
    # order apart from a position anomaly apart from an unreadable order book.
    entry_blocks: list[dict[str, str]] = [
        {"kind": "position_anomaly", "reason": str(a["reason"])} for a in position_anomalies
    ]
    entry_blocks += [
        {
            "kind": "position_anomaly",
            "reason": (
                f"open spread {spread.short_symbol}/{spread.long_symbol} has no computable "
                "entry credit, so its risk cannot be sized"
            ),
        }
        for spread in open_spreads
        if spread.entry_credit is None
    ]
    if open_orders_error:
        entry_blocks.append(
            {
                "kind": "open_orders_unreadable",
                "reason": (
                    "open orders could not be listed, so resting entry orders cannot be "
                    "ruled out — new entries fail closed until the account state is "
                    "visible again"
                ),
            }
        )
    elif resting_entry_leg_sets(open_orders):
        entry_blocks.append(
            {
                "kind": "resting_entry_order",
                "reason": (
                    "an entry order is already resting on the account — waiting for its "
                    "outcome before considering any new entry (no stacking of unfilled "
                    "orders)"
                ),
            }
        )
    capital_at_risk = round(
        sum(
            spread.qty * spread.max_loss_per_spread
            for spread in open_spreads
            if spread.max_loss_per_spread is not None
        ),
        2,
    )

    equity = money(account.equity, "equity")
    last_equity = money(account.last_equity, "last_equity")
    day_pnl = equity - last_equity
    daily_stop = equity * cfg.strategy["risk"]["daily_drawdown_stop_pct"] / 100
    # Loss still absorbable today before the daily-drawdown stop trips (never negative).
    risk_budget_remaining_today = max(0.0, daily_stop + min(0.0, day_pnl))

    account_snapshot = AccountSnapshot(
        cash=money(account.cash, "cash"),
        buying_power=money(account.buying_power, "buying_power"),
        open_positions=open_position_count,
        day_pnl=round(day_pnl, 2),
        risk_budget_remaining_today=round(risk_budget_remaining_today, 2),
    )

    return AccountState(
        equity=equity,
        day_pnl=round(day_pnl, 2),
        capital_at_risk=capital_at_risk,
        open_position_count=open_position_count,
        market_open=bool(clock.is_open),
        positions=list(positions),
        open_spreads=open_spreads,
        position_anomalies=position_anomalies,
        exit_evaluations=exit_evaluations,
        triggered_exits=triggered_exits,
        open_orders=open_orders,
        open_orders_error=open_orders_error,
        entry_blocks=entry_blocks,
        snapshot=account_snapshot,
        risk_state=AccountRiskState(
            equity=equity,
            open_positions=open_position_count,
            day_pnl=round(day_pnl, 2),
            capital_at_risk=capital_at_risk,
        ),
    )
