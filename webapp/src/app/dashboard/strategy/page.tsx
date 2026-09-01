import type { Metadata } from "next";
import { requireSession, roleAtLeast } from "@/lib/auth";
import { fetchLatestStrategyConfig } from "@/lib/dashboard-queries";
import { ForbiddenPanel, Panel } from "@/components/dashboard/ui";
import { VixTaperCurve } from "@/components/dashboard/vix-taper-curve";
import {
  buildStrategyView,
  describeStrategy,
  readVixTaper,
  taperMultiplier,
  type ParamRow,
  type StrategySection,
} from "@/lib/strategy-schema";
import {
  OPERATING_RULES,
  TIER_BLURB,
  TIER_LABEL,
  type Tier,
} from "@/lib/strategy-rules";
import {
  IconStrategy,
  IconTarget,
  IconBroadcast,
  IconScales,
  IconExit,
  IconTrades,
  IconData,
  IconStrategyNote,
  IconResearch,
} from "@/components/icons";

export const metadata: Metadata = {
  title: "Strategy — Beleth backoffice",
};

type IconCmp = typeof IconData;

const SECTION_ICON: Record<string, IconCmp> = {
  target: IconTarget,
  broadcast: IconBroadcast,
  scales: IconScales,
  exit: IconExit,
  trades: IconTrades,
  data: IconData,
};

const TIER_TONE: Record<Tier, string> = {
  A: "text-up border-up/40",
  B: "text-acc border-acc/40",
  C: "text-sec border-emphline",
};

function RuleTag({ id }: { id: string }) {
  return (
    <span className="font-mono text-[9.5px] tracking-[0.06em] text-acc border border-acc/30 rounded px-1 py-px">
      {id}
    </span>
  );
}

function TierBadge({ tier }: { tier: Tier }) {
  return (
    <span
      className={`inline-block shrink-0 whitespace-nowrap font-mono text-[9.5px] tracking-[0.08em] uppercase border rounded px-1.5 py-0.5 ${TIER_TONE[tier]}`}
    >
      {tier} · {TIER_LABEL[tier]}
    </span>
  );
}

function ParamTable({ rows }: { rows: ParamRow[] }) {
  return (
    <div>
      {rows.map((r) => (
        <div
          key={r.path}
          className="grid grid-cols-1 gap-y-1 border-b border-line/70 py-2.5 last:border-b-0 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-x-4"
        >
          <div className="flex items-start gap-1.5">
            <span className="text-[12px] leading-tight text-sec">{r.label}</span>
            {r.rule && <RuleTag id={r.rule} />}
          </div>
          <div className="min-w-0">
            <span className="font-mono text-[12px] text-txt break-words">
              {r.value}
            </span>
            {r.gloss && (
              <p className="mt-0.5 text-[11px] leading-relaxed text-dim">
                {r.gloss}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function SectionTitle({ section }: { section: StrategySection }) {
  const Icon = SECTION_ICON[section.icon] ?? IconData;
  return (
    <span className="flex items-center gap-1.5">
      <Icon size={12} weight="bold" className="text-dim" />
      {section.title}
    </span>
  );
}

function RuleTags({ ids }: { ids: string[] }) {
  if (!ids.length) return null;
  return (
    <span className="flex gap-1">
      {ids.map((id) => (
        <RuleTag key={id} id={id} />
      ))}
    </span>
  );
}

export default async function StrategyPage() {
  const ctx = await requireSession();
  if (!roleAtLeast(ctx.role, "demo_admin")) return <ForbiddenPanel />;

  const { config, asOf, agentVersion, vixPercentile } =
    await fetchLatestStrategyConfig();

  if (!config) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="flex items-center gap-2 text-[18px] font-light">
          <IconStrategy size={17} weight="bold" className="text-acc" />
          Strategy
        </h1>
        <Panel title="No snapshot">
          <p className="text-[12px] text-dim">
            No decision with a config snapshot has been recorded yet.
          </p>
        </Panel>
      </div>
    );
  }

  const sections = buildStrategyView(config);
  const primary = sections.filter((s) => !s.secondary);
  const secondary = sections.filter((s) => s.secondary);

  const taper = readVixTaper(config);
  const curMult =
    taper && vixPercentile != null
      ? taperMultiplier(vixPercentile, taper)
      : null;
  const curBlocked =
    taper != null &&
    vixPercentile != null &&
    taper.blockBelowPct > 0 &&
    vixPercentile < taper.blockBelowPct;

  return (
    <div className="flex flex-col gap-5">
      {/* header */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="flex items-center gap-2 text-[18px] font-light">
          <IconStrategy size={17} weight="bold" className="text-acc" />
          Strategy
        </h1>
        <span className="font-mono text-[10.5px] text-dim">
          {asOf ? `snapshot ${new Date(asOf).toLocaleString()}` : "no snapshot"}
          {agentVersion ? ` · agent ${agentVersion}` : ""}
        </span>
      </div>

      {/* one-line summary */}
      <Panel title="Strategy in one line">
        <p className="text-[13px] leading-relaxed text-txt">
          {describeStrategy(config)}
        </p>
        <p className="mt-2 text-[11px] leading-relaxed text-dim">
          These are the exact parameters the agent stamped onto its most recent
          decision — the values that produced it, annotated here with the
          operating rule each one serves. The rules and their sources are at the
          foot of the page; this view is read-only.
        </p>
      </Panel>

      {/* primary sections */}
      {primary.map((section) => (
        <Panel
          key={section.id}
          title={<SectionTitle section={section} />}
          right={<RuleTags ids={section.rules} />}
        >
          <p className="mb-3 text-[11.5px] leading-relaxed text-sec">
            {section.blurb}
          </p>

          {section.id === "regime" && taper?.enabled && (
            <div className="mb-4 rounded border border-line bg-inset p-3">
              <div className="mb-1 flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-dim">
                  <RuleTag id="R9" />
                  size taper
                </span>
                <span className="font-mono text-[10px] text-faint">
                  {taper.upperPct} / {taper.lowerPct} / {taper.floorFrac} /{" "}
                  {taper.blockBelowPct}
                </span>
              </div>
              <VixTaperCurve taper={taper} currentPct={vixPercentile} />
              <p className="mt-1 text-[11px] leading-relaxed text-dim">
                Per-trade size against the VIX&rsquo;s own 1-year percentile:
                full size at/above the {taper.upperPct}th, a straight line down
                to {taper.floorFrac}× at/below the {taper.lowerPct}th, no new
                entry below the {taper.blockBelowPct}th.
                {vixPercentile != null && (
                  <>
                    {" "}
                    At this snapshot the percentile was{" "}
                    <span className="text-sec">
                      {vixPercentile.toFixed(2)}
                    </span>
                    , so new entries size to{" "}
                    <span className="text-sec">
                      {curBlocked
                        ? "— blocked (R9 rejection)"
                        : `${curMult?.toFixed(2)}×`}
                    </span>
                    .
                  </>
                )}
              </p>
            </div>
          )}

          <ParamTable rows={section.rows} />
        </Panel>
      ))}

      {/* de-emphasised: data sources + runner */}
      {secondary.length > 0 && (
        <details className="group overflow-hidden rounded-md border border-line bg-panel">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 border-b border-line bg-panel-head px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-sec [&::-webkit-details-marker]:hidden">
            <span className="flex items-center gap-1.5">
              <IconData size={12} weight="bold" />
              Infrastructure &amp; data sources
            </span>
            <span className="text-dim group-open:hidden">show</span>
            <span className="hidden text-dim group-open:inline">hide</span>
          </summary>
          <div className="flex flex-col gap-5 p-4">
            {secondary.map((section) => (
              <div key={section.id}>
                <h3 className="mb-1 flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-sec">
                  <SectionTitle section={section} />
                </h3>
                <p className="mb-2 text-[11px] leading-relaxed text-dim">
                  {section.blurb}
                </p>
                <ParamTable rows={section.rows} />
              </div>
            ))}
          </div>
        </details>
      )}

      {/* operating rules & the why */}
      <Panel
        title={
          <span className="flex items-center gap-1.5">
            <IconStrategyNote size={12} weight="bold" className="text-dim" />
            Operating rules &amp; the why
          </span>
        }
        right={
          <span className="font-mono text-[10px] text-dim">
            docs/strategy.md
          </span>
        }
      >
        <div className="mb-4 flex flex-col gap-2 rounded border border-line bg-inset p-3 sm:flex-row sm:gap-5">
          {(["A", "B", "C"] as Tier[]).map((t) => (
            <div
              key={t}
              className="flex items-center justify-center gap-2 sm:flex-1"
            >
              <TierBadge tier={t} />
              <span className="text-[10.5px] leading-snug text-dim">
                {TIER_BLURB[t]}
              </span>
            </div>
          ))}
        </div>

        <div>
          {OPERATING_RULES.map((rule) => (
            <div
              key={rule.id}
              className="border-b border-line/70 py-3 last:border-b-0"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px] text-acc">{rule.id}</span>
                <span className="text-[13px] text-txt">{rule.title}</span>
                <TierBadge tier={rule.tier} />
              </div>
              <p className="mt-1.5 text-[12px] leading-relaxed text-sec">
                {rule.body}
              </p>
              <ul className="mt-2 flex flex-col gap-1">
                {rule.sources.map((s, i) => (
                  <li
                    key={i}
                    className="flex gap-1.5 text-[10.5px] leading-relaxed text-faint"
                  >
                    <IconResearch
                      size={11}
                      className="mt-0.5 shrink-0"
                      weight="bold"
                    />
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Panel>

      {/* raw snapshot */}
      <details className="group overflow-hidden rounded-md border border-line bg-panel">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 border-b border-line bg-panel-head px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-sec [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-1.5">
            <IconTrades size={12} weight="bold" />
            Raw snapshot (JSON)
          </span>
          <span className="text-dim group-open:hidden">show</span>
          <span className="hidden text-dim group-open:inline">hide</span>
        </summary>
        <div className="p-4">
          <pre className="overflow-x-auto rounded border border-line bg-inset p-3 font-mono text-[11px] leading-relaxed text-pre-output">
            {JSON.stringify(config, null, 2)}
          </pre>
        </div>
      </details>
    </div>
  );
}
