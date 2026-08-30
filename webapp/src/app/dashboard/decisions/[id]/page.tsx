import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireSession, roleAtLeast } from "@/lib/auth";
import { fetchDecisionDetail } from "@/lib/dashboard-queries";
import {
  ActionBadge,
  ForbiddenPanel,
  Panel,
  PassFail,
  formatUsd,
} from "@/components/dashboard/ui";
import { TickerBadge } from "@/components/ticker-badge";

export const metadata: Metadata = { title: "Decision — Beleth backoffice" };

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="text-[11px] leading-relaxed font-mono text-pre-output bg-inset border border-line rounded p-3 overflow-x-auto max-h-[420px]">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export default async function DecisionDetailPage({
  params,
}: PageProps<"/dashboard/decisions/[id]">) {
  const ctx = await requireSession();
  if (!roleAtLeast(ctx.role, "demo_admin")) return <ForbiddenPanel />;

  const { id } = await params;
  const { decision, riskChecks, trades } = await fetchDecisionDetail(id);
  if (!decision) notFound();

  const byCandidate = new Map<number, typeof riskChecks>();
  for (const rc of riskChecks) {
    const list = byCandidate.get(rc.candidate_index) ?? [];
    list.push(rc);
    byCandidate.set(rc.candidate_index, list);
  }
  const pnl = Number(decision.day_pnl);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link
          href="/dashboard/decisions"
          className="text-[11px] text-dim hover:text-sec"
        >
          ← Decision history
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-[18px] font-sans font-light">
            {decision.symbol}
          </h1>
          <ActionBadge action={decision.action} />
          <span className="font-mono text-[10.5px] text-dim">
            {new Date(decision.created_at).toLocaleString()}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10.5px] text-dim">
          <span>as of {new Date(decision.as_of).toLocaleString()}</span>
          <span>source: {decision.decision_source}</span>
          {decision.llm_model && <span>{decision.llm_model}</span>}
          <span>agent {decision.agent_version}</span>
          <span>{decision.market_open ? "market open" : "market closed"}</span>
          <span>equity {formatUsd(Number(decision.equity), 0)}</span>
          <span className={pnl > 0 ? "text-up" : pnl < 0 ? "text-down" : ""}>
            day P&L {formatUsd(pnl, 0)}
          </span>
        </div>
      </div>

      <Panel title="Plain-language summary">
        <p className="text-[13px] text-txt leading-relaxed">
          {decision.summary}
        </p>
      </Panel>

      {decision.decision_source === "llm" && (
        <Panel
          title="LLM reasoning (raw)"
          right={
            decision.llm_usage ? (
              <span className="font-mono text-[10px] text-dim">
                {Object.entries(decision.llm_usage)
                  .map(([k, v]) => `${k}=${v}`)
                  .join("  ")}
              </span>
            ) : undefined
          }
        >
          {decision.llm_reasoning ? (
            <p className="text-[12.5px] text-pre-output leading-relaxed whitespace-pre-wrap">
              {decision.llm_reasoning}
            </p>
          ) : (
            <p className="text-[12px] text-dim">
              No reasoning text stored for this decision.
            </p>
          )}
        </Panel>
      )}

      <Panel
        title="Risk checks"
        right={
          <span className="font-mono text-[10px] text-dim">
            {riskChecks.length} rows · {byCandidate.size} candidates
          </span>
        }
      >
        {byCandidate.size === 0 ? (
          <p className="text-[12px] text-dim">
            No candidates reached the risk gate this cycle.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {[...byCandidate.entries()]
              .sort((a, b) => a[0] - b[0])
              .map(([idx, rules]) => {
                const approved = rules.every((r) => r.approved);
                return (
                  <div
                    key={idx}
                    className="border border-rowline rounded overflow-hidden"
                  >
                    <div className="flex items-center justify-between bg-inset px-3 py-1.5 font-mono text-[10.5px]">
                      <span className="text-sec">candidate {idx}</span>
                      <PassFail
                        ok={approved}
                        label={approved ? "APPROVED" : "REJECTED"}
                      />
                    </div>
                    <table className="w-full text-[11.5px]">
                      <tbody>
                        {rules.map((r) => (
                          <tr
                            key={r.id}
                            className="border-t border-rowline align-top"
                          >
                            <td className="px-3 py-1.5 font-mono text-sec w-[42px]">
                              {r.rule}
                            </td>
                            <td className="px-3 py-1.5 w-[52px]">
                              <PassFail ok={r.passed} />
                            </td>
                            <td className="px-3 py-1.5 text-sec">
                              {r.reason}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <details className="border-t border-rowline">
                      <summary className="px-3 py-1.5 font-mono text-[10px] text-dim cursor-pointer hover:text-sec">
                        candidate payload
                      </summary>
                      <div className="p-3 pt-0">
                        <JsonBlock value={rules[0]?.candidate} />
                      </div>
                    </details>
                  </div>
                );
              })}
          </div>
        )}
      </Panel>

      {trades.length > 0 && (
        <Panel title="Orders">
          <div className="flex flex-col gap-3">
            {trades.map((t) => (
              <div
                key={t.id}
                className="border border-rowline rounded p-3 text-[11.5px]"
              >
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10.5px] text-dim">
                  <span className="text-sec uppercase">{t.kind}</span>
                  {t.exit_reason && <span>reason: {t.exit_reason}</span>}
                  <span className="inline-flex items-center gap-1.5">
                    <TickerBadge symbol={t.underlying} size={14} />
                    {t.underlying}
                  </span>
                  <span>status: {t.status ?? "—"}</span>
                  <span>qty {t.qty ?? "—"}</span>
                  {t.credit && <span>credit {t.credit}</span>}
                  {t.alpaca_order_id ? (
                    <span className="text-up">submitted</span>
                  ) : (
                    <span className="text-down">not submitted</span>
                  )}
                </div>
                {t.legs != null && (
                  <details className="mt-2">
                    <summary className="font-mono text-[10px] text-dim cursor-pointer hover:text-sec">
                      legs
                    </summary>
                    <div className="mt-2">
                      <JsonBlock value={t.legs} />
                    </div>
                  </details>
                )}
              </div>
            ))}
          </div>
        </Panel>
      )}

      <Panel title="Evidence package">
        <JsonBlock value={decision.evidence} />
      </Panel>

      <Panel title="Strategy config snapshot">
        <JsonBlock value={decision.strategy_config} />
      </Panel>
    </div>
  );
}
