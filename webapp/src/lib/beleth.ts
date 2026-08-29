/**
 * The reactive mascot's state machine. Given the same live reads the homepage
 * already has — agent status, the latest decision, the market clock — it picks
 * one `data-scene` for <BelethSprite>. Every scene is a short CSS-only skit
 * (choreography in globals.css, props in components/beleth-props.ts).
 *
 * Pure and dependency-light on purpose: the /beleth gallery imports this without
 * touching Supabase or Alpaca.
 */
import type { MarketClock } from "@/lib/equity";
import type { AgentStatusRow, DecisionRow } from "@/lib/queries";

export type BelethScene =
  | "guard"
  | "opening-bell"
  | "closing-bell"
  | "inspect"
  | "stamp"
  | "shield"
  | "scale"
  | "macro"
  | "vigilant"
  | "night"
  | "weekend"
  | "powered-down";

export type BelethPnl = "up" | "down" | null;

export type BelethSceneMeta = {
  id: BelethScene;
  /** Short chip label. */
  label: string;
  /** "What Beleth is doing" line shown under the sprite. */
  caption: string;
  /** Plain-language description of when this scene shows (gallery only). */
  trigger: string;
};

export const BELETH_SCENE_META: Record<BelethScene, BelethSceneMeta> = {
  guard: {
    id: "guard",
    label: "On watch",
    caption: "watching the tape",
    trigger: "Market open, agent monitoring, nothing pending — the default.",
  },
  "opening-bell": {
    id: "opening-bell",
    label: "Opening bell",
    caption: "ringing the opening bell",
    trigger: "First 15 minutes after the market opens.",
  },
  "closing-bell": {
    id: "closing-bell",
    label: "Closing bell",
    caption: "ringing the closing bell",
    trigger: "Last 10 minutes before the close.",
  },
  inspect: {
    id: "inspect",
    label: "Inspecting",
    caption: "inspecting a trade candidate",
    trigger: "agent_status.state = evaluating.",
  },
  stamp: {
    id: "stamp",
    label: "Filled",
    caption: "stamping a filled spread",
    trigger: "state = trade_executed and the decision is fresh (< 25 min).",
  },
  shield: {
    id: "shield",
    label: "Risk check: no",
    caption: "risk check said no",
    trigger: "state = risk_check_rejected and the decision is fresh (< 25 min).",
  },
  scale: {
    id: "scale",
    label: "Edge too thin",
    caption: "weighing a thin edge",
    trigger: "Latest decision is no_trade because the measured VRP missed the bar.",
  },
  macro: {
    id: "macro",
    label: "Event gate",
    caption: "blocked by a macro event",
    trigger: "Latest no_trade because a known macro event gates the tenor.",
  },
  vigilant: {
    id: "vigilant",
    label: "Drawdown",
    caption: "holding steady in a drawdown",
    trigger: "state = drawdown — braced, never panicked.",
  },
  night: {
    id: "night",
    label: "Market closed",
    caption: "resting — market closed",
    trigger: "Market closed on a weekday. One eye still cracks open.",
  },
  weekend: {
    id: "weekend",
    label: "Weekend",
    caption: "asleep for the weekend",
    trigger: "Market closed on a weekend.",
  },
  "powered-down": {
    id: "powered-down",
    label: "Paused",
    caption: "paused by the operator",
    trigger: "agent_status.paused = true — the master-admin kill switch.",
  },
};

/** Display order for the gallery and any scene picker. */
export const BELETH_SCENE_ORDER: BelethScene[] = [
  "guard",
  "opening-bell",
  "closing-bell",
  "inspect",
  "stamp",
  "shield",
  "scale",
  "macro",
  "vigilant",
  "night",
  "weekend",
  "powered-down",
];

const NY_OPEN_MIN = 9 * 60 + 30; // 09:30 ET
const NY_CLOSE_MIN = 16 * 60; // 16:00 ET
const FRESH_MS = 25 * 60 * 1000;

/** Minutes since ET-midnight and weekend flag for `now`, via Intl (no tz lib). */
function nyParts(now: Date): { minutes: number; isWeekend: boolean } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  const wd = get("weekday");
  return {
    minutes: hour * 60 + minute,
    isWeekend: wd === "Sat" || wd === "Sun",
  };
}

export type BelethSceneInput = {
  status: AgentStatusRow | null;
  decision: DecisionRow | null;
  clock: MarketClock | null;
  /** Injectable for tests / the gallery. */
  now?: Date;
};

/**
 * Priority: kill switch → a fresh trade/rejection event → market open/close
 * windows → live agent state → no-trade texture from the latest evidence →
 * the default watch loop.
 */
export function belethScene(input: BelethSceneInput): BelethScene {
  const { status, decision, clock } = input;
  const now = input.now ?? new Date();

  if (status?.paused) return "powered-down";

  const ageMs = decision?.created_at
    ? now.getTime() - Date.parse(decision.created_at)
    : Number.POSITIVE_INFINITY;
  const fresh = ageMs >= 0 && ageMs < FRESH_MS;
  if (fresh && status?.state === "trade_executed") return "stamp";
  if (fresh && status?.state === "risk_check_rejected") return "shield";

  const { minutes, isWeekend } = nyParts(now);
  const open = clock
    ? clock.isOpen
    : !isWeekend && minutes >= NY_OPEN_MIN && minutes < NY_CLOSE_MIN;

  if (!open) return isWeekend ? "weekend" : "night";

  if (minutes >= NY_OPEN_MIN && minutes < NY_OPEN_MIN + 15) return "opening-bell";
  if (minutes >= NY_CLOSE_MIN - 10 && minutes < NY_CLOSE_MIN) return "closing-bell";

  if (status?.state === "drawdown") return "vigilant";
  if (status?.state === "evaluating") return "inspect";

  if (decision?.action === "no_trade") {
    const blocked = decision.evidence?.calendar?.blocks_tenors ?? [];
    if (blocked.length > 0) return "macro";
    const perTenor = decision.evidence?.vrp?.per_tenor ?? [];
    if (perTenor.length > 0 && !perTenor.some((t) => t.passes_threshold)) {
      return "scale";
    }
  }

  return "guard";
}

/** Day-P&L tint, independent of the scene. Zero / unknown → no tint. */
export function belethPnl(decision: DecisionRow | null): BelethPnl {
  const v = decision ? Number(decision.day_pnl) : Number.NaN;
  if (!Number.isFinite(v) || v === 0) return null;
  return v > 0 ? "up" : "down";
}
