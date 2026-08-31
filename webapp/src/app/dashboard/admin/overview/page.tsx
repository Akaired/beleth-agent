import type { Metadata } from "next";
import Link from "next/link";
import { requireSession, roleAtLeast } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Panel } from "@/components/dashboard/ui";
import { Stat } from "@/components/dashboard/admin/email-ui";
import { fetchDashboardOverview } from "@/lib/dashboard-queries";
import { fetchForumCategories } from "@/lib/forum/queries";
import type { ForumCategoryWithCount } from "@/lib/forum/types";
import { fetchAdminDocList } from "@/lib/docs/queries";
import type { DocPage } from "@/lib/docs/types";
import { fetchAdminUsers, tallyRoles, type AdminUser } from "@/lib/admin/users";
import {
  getResendKey,
  tolerant,
  fetchBelethTemplates,
  fetchBelethBroadcasts,
  fetchBelethRecentEmails,
} from "@/lib/admin/email";
import {
  IconArrowUpRight,
  IconCheckCircle,
  IconProhibit,
  IconWarning,
} from "@/components/icons";

export const metadata: Metadata = { title: "Admin · Overview — Beleth backoffice" };

function relTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const diff = Date.now() - t;
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** A single "check" line in the environment / health panel. */
function Check({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <li className="flex items-center justify-between gap-3 py-1.5 first:pt-0 last:pb-0">
      <span className="flex items-center gap-2 text-[12.5px] text-txt">
        {ok ? (
          <IconCheckCircle size={13} weight="bold" className="text-up" />
        ) : (
          <IconWarning size={13} className="text-down" />
        )}
        {label}
      </span>
      <span className="font-mono text-[10.5px] text-faint">{detail}</span>
    </li>
  );
}

/**
 * Backoffice landing — one read-only summary of the whole webapp: the agent,
 * the community (users + forum), the content (docs), the email pipeline and
 * the environment health. Every section degrades on its own; a failing read
 * shows "—" rather than 500-ing the page. Visible to demo-admin and up.
 */
export default async function AdminOverviewPage() {
  const ctx = await requireSession();
  const isMaster = roleAtLeast(ctx.role, "master_admin");

  const supabase = await createClient();
  const resendKey = getResendKey();

  const forumPostCount = async (): Promise<number | null> => {
    try {
      const { count } = await supabase
        .from("forum_posts")
        .select("id", { count: "exact", head: true });
      return count ?? null;
    } catch {
      return null;
    }
  };

  const [agent, categories, docs, users, postCount] = await Promise.all([
    fetchDashboardOverview().catch(() => null),
    fetchForumCategories().catch((): ForumCategoryWithCount[] => []),
    fetchAdminDocList().catch((): DocPage[] => []),
    fetchAdminUsers().catch((): AdminUser[] => []),
    forumPostCount(),
  ]);

  const roles = tallyRoles(users);
  const topicCount = categories.reduce((n, c) => n + c.topic_count, 0);
  const publishedDocs = docs.filter((d) => d.status === "published").length;
  const draftDocs = docs.length - publishedDocs;

  const paused = agent?.agentStatus?.paused ?? null;
  const agentState = agent?.agentStatus?.state ?? "unknown";

  // Email is only reachable with a key; keep the reads off the critical path.
  const email = resendKey
    ? await Promise.all([
        tolerant(fetchBelethTemplates),
        tolerant(fetchBelethBroadcasts),
        tolerant(() => fetchBelethRecentEmails(100)),
      ])
    : null;
  const templateCount = email?.[0].ok ? email[0].data.templates.length : null;
  const campaignCount = email?.[1].ok ? email[1].data.length : null;
  const recentSends = email?.[2].ok ? email[2].data.emails.length : null;

  return (
    <div className="flex flex-col gap-5">
      {/* ── agent ─────────────────────────────────────────────────────── */}
      <Panel
        title="Agent"
        right={
          <Link
            href="/dashboard/controls"
            className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.07em] text-acc hover:underline"
          >
            Controls <IconArrowUpRight size={11} weight="bold" />
          </Link>
        }
      >
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          <Stat
            label="State"
            value={
              paused === true ? "Paused" : paused === false ? "Running" : agentState
            }
          />
          <Stat label="Last cycle" value={relTime(agent?.agentStatus?.last_cycle_at)} />
          <Stat label="Cycles run" value={agent?.cyclesRun ?? "—"} />
          <Stat label="Trades filled" value={agent?.tradesSubmitted ?? "—"} />
          <Stat label="Risk rejections" value={agent?.refused ?? "—"} />
          <Stat label="Open positions" value={agent?.openPositions ?? "—"} />
        </div>
      </Panel>

      {/* ── community ─────────────────────────────────────────────────── */}
      <Panel
        title="Community"
        right={
          <Link
            href="/dashboard/admin/users"
            className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.07em] text-acc hover:underline"
          >
            Users <IconArrowUpRight size={11} weight="bold" />
          </Link>
        }
      >
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          <Stat
            label="Users"
            value={isMaster ? users.length : "—"}
          />
          <Stat label="Public" value={isMaster ? roles.public_user : "—"} />
          <Stat label="Admins" value={isMaster ? roles.demo_admin + roles.master_admin : "—"} />
          <Stat label="Forum categories" value={categories.length} />
          <Stat label="Topics" value={topicCount} />
          <Stat label="Posts" value={postCount ?? "—"} />
        </div>
        {!isMaster && (
          <p className="mt-3 flex items-center gap-1.5 font-mono text-[10.5px] text-faint">
            <IconProhibit size={12} /> user counts are master-admin only
          </p>
        )}
      </Panel>

      {/* ── content ───────────────────────────────────────────────────── */}
      <Panel
        title="Documentation"
        right={
          <Link
            href="/dashboard/admin/docs"
            className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.07em] text-acc hover:underline"
          >
            Docs <IconArrowUpRight size={11} weight="bold" />
          </Link>
        }
      >
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Stat label="Articles" value={docs.length || "—"} />
          <Stat label="Published" value={publishedDocs} />
          <Stat label="Drafts" value={draftDocs} />
          <Stat
            label="Templates"
            value={templateCount ?? "—"}
          />
        </div>
        {docs.length === 0 && (
          <p className="mt-3 flex items-center gap-1.5 font-mono text-[10.5px] text-faint">
            <IconProhibit size={12} /> the full article list is master-admin only
          </p>
        )}
      </Panel>

      {/* ── email ─────────────────────────────────────────────────────── */}
      <Panel
        title="Email"
        right={
          <Link
            href="/dashboard/admin/email"
            className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.07em] text-acc hover:underline"
          >
            Email <IconArrowUpRight size={11} weight="bold" />
          </Link>
        }
      >
        {!resendKey ? (
          <p className="flex items-center gap-2 text-[13px] text-sec">
            <IconProhibit size={14} className="text-dim" />
            Not configured — set <span className="font-mono text-txt">RESEND_API_KEY</span>.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            <Stat label="Templates" value={templateCount ?? "—"} />
            <Stat label="Campaigns" value={campaignCount ?? "—"} />
            <Stat label="Recent sends" value={recentSends ?? "—"} />
          </div>
        )}
      </Panel>

      {/* ── environment ──────────────────────────────────────────────── */}
      <Panel title="Environment">
        <ul className="flex flex-col divide-y divide-line">
          <Check
            ok={Boolean(resendKey)}
            label="Email (RESEND_API_KEY)"
            detail={resendKey ? "set" : "missing — email tab disabled"}
          />
          <Check
            ok={Boolean(process.env.ALPACA_API_KEY && process.env.ALPACA_SECRET_KEY)}
            label="Alpaca keys (ALPACA_API_KEY / ALPACA_SECRET_KEY)"
            detail={
              process.env.ALPACA_API_KEY && process.env.ALPACA_SECRET_KEY
                ? "set"
                : "missing — equity chart / markers / positions drop"
            }
          />
          <Check
            ok={Boolean(process.env.AIML_API_KEY)}
            label="Chat (AIML_API_KEY)"
            detail={process.env.AIML_API_KEY ? "set" : "missing — Chat with Beleth disabled"}
          />
          <Check
            ok={Boolean(process.env.DEMO_EMAIL && process.env.DEMO_PASSWORD)}
            label="Demo login (DEMO_EMAIL / DEMO_PASSWORD)"
            detail={
              process.env.DEMO_EMAIL && process.env.DEMO_PASSWORD
                ? "set"
                : "missing — homepage Demo button disabled"
            }
          />
        </ul>
      </Panel>
    </div>
  );
}
