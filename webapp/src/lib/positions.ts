/**
 * Client-safe types for the backoffice "Positions" view.
 *
 * A "position" here is one vertical spread the agent opened — or tried to
 * open. The lifecycle is reconstructed from the Alpaca paper account
 * (`src/lib/alpaca.ts`, server-only), because our own tables do not keep the
 * history: `positions` is a live mirror that deletes closed rows, and
 * `trades.status` is written at submission time and never re-synced with the
 * fills. The one thing Alpaca cannot know is a rejection that happened before
 * an order was ever submitted — those come from `trades` rows with
 * `status='submission_failed'`.
 *
 * Kept dependency-free so a Client Component can import the shape without
 * dragging in `server-only`.
 */

export type PositionState = "open" | "closed" | "canceled" | "failed";

export type SpreadPosition = {
  /** Stable key: the Alpaca order id, or `trades:<uuid>` for a pre-submission failure. */
  id: string;
  state: PositionState;
  underlying: string;
  right: "C" | "P" | null;
  /** Contracts (absolute value). */
  qty: number | null;
  /** e.g. "bull put 741 / 740 P". */
  spread: string | null;
  /** The strike the agent SOLD to open (short leg). */
  shortStrike: number | null;
  /** The strike the agent BOUGHT as protection (long leg). */
  longStrike: number | null;
  /** Raw OCC expiry of the legs, `YYMMDD`. */
  expiry: string | null;
  /** Net credit received at entry, per share (positive = credit). */
  entryCredit: number | null;
  /** Net paid to close, per share (positive = debit, negative = closed for a credit). */
  exitDebit: number | null;
  /** Realized P&L in dollars for a round-trip: (entryCredit - exitDebit) * 100 * qty. */
  realizedPnl: number | null;
  /** Live unrealized P&L in dollars — open positions only. */
  unrealizedPnl: number | null;
  /** Live market value of the spread in dollars — open positions only. */
  marketValue: number | null;
  /** Defined max loss in dollars: (width - entryCredit) * 100 * qty. */
  maxLoss: number | null;
  /** Entry fill time, or submission time for a never-filled order. */
  openedAt: string | null;
  /** Exit fill time, or cancel/expire time. */
  closedAt: string | null;
  /** Fired R5 rule for a closed position (from the exit order's `trades` row). */
  exitReason: string | null;
  /** Why a failed order did not go through. */
  failureReason: string | null;
  /** Raw Alpaca terminal status, when the row came from an order. */
  alpacaStatus: string | null;
  /** The agent's `client_order_id` on the entry order (`beleth-…`). */
  clientOrderId: string | null;
  /** The agent's `client_order_id` on the matched exit order (`beleth-exit-…`). */
  exitClientOrderId: string | null;
  /** The decision that produced this position, once joined against `trades`. */
  decisionId: string | null;
};

export const POSITION_STATES: readonly PositionState[] = [
  "open",
  "closed",
  "canceled",
  "failed",
] as const;

export function isPositionState(v: string | null | undefined): v is PositionState {
  return v != null && (POSITION_STATES as readonly string[]).includes(v);
}
