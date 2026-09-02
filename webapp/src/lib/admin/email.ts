import "server-only";
import { getSessionContext } from "@/lib/auth";

/**
 * Resend client for the admin Email section. The webapp sends no mail itself —
 * Supabase Auth delivers transactional mail over Custom SMTP — so everything
 * here is either read-only reporting or marketing "broadcasts" that a
 * master-admin drives deliberately from the UI (each mutating call is a
 * server action with its own role check and an armed confirm in the client).
 *
 * `RESEND_API_KEY` is the one secret in this project with no second gate behind it:
 * it is account-wide, on an account shared with other projects, and `isBelethMail` /
 * `isBelethSegmentName` scope the *results* by heuristic — a domain suffix and a name
 * match — not the access. So the gate is here, at the single door, rather than left to
 * each caller: `resendRequest` refuses without a master_admin session. That is what
 * caught the admin Overview page reading Resend counts for the public demo login.
 *
 * Every shape below is taken from the live Resend API reference, not guessed.
 */

const RESEND_API = "https://api.resend.com";

export function getResendKey(): string | null {
  return process.env.RESEND_API_KEY?.trim() || null;
}

export class ResendNotConfigured extends Error {
  constructor() {
    super("RESEND_API_KEY is not set");
    this.name = "ResendNotConfigured";
  }
}

export class ResendApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ResendApiError";
    this.status = status;
  }
}

type ReqInit = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | undefined>;
};

export class ResendForbidden extends Error {
  constructor() {
    super("Resend is master-admin only");
    this.name = "ResendForbidden";
  }
}

export async function resendRequest<T>(path: string, init: ReqInit = {}): Promise<T> {
  const ctx = await getSessionContext();
  if (!ctx || ctx.role !== "master_admin") throw new ResendForbidden();

  const key = getResendKey();
  if (!key) throw new ResendNotConfigured();

  const url = new URL(`${RESEND_API}${path}`);
  for (const [k, v] of Object.entries(init.query ?? {})) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }

  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const json = text ? (JSON.parse(text) as unknown) : null;

  if (!res.ok) {
    const msg =
      (json as { message?: string } | null)?.message ??
      `Email API responded ${res.status} ${res.statusText}`;
    throw new ResendApiError(res.status, msg);
  }
  return json as T;
}

/** Run a Resend read and fold any failure into a value the page can render. */
export async function tolerant<T>(
  fn: () => Promise<T>,
): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof ResendNotConfigured) return { ok: false, message: "not-configured" };
    if (err instanceof ResendForbidden) return { ok: false, message: "forbidden" };
    // Resend's own message can carry account detail; the operator gets the status and
    // the server log gets the rest.
    console.error("resend request failed", err);
    if (err instanceof ResendApiError) {
      return { ok: false, message: `HTTP ${err.status} from the email API` };
    }
    return { ok: false, message: "Could not reach the email API" };
  }
}

// --- Beleth scoping --------------------------------------------------------

// The Resend account is shared with other projects. Everything the admin
// section shows is filtered to this mail domain so another project's
// customer mail never leaks in. Configurable, with the obvious default.
export const BELETH_MAIL_DOMAIN =
  process.env.BELETH_MAIL_DOMAIN?.trim().toLowerCase() || "beleth.davidemaiorana.dev";

/** Domain part of a `from` value — handles "Name <a@b.com>" and "a@b.com". */
export function fromDomain(from: string | null | undefined): string | null {
  if (!from) return null;
  const angle = from.match(/<([^>]+)>/);
  const addr = (angle ? angle[1] : from).trim();
  const at = addr.lastIndexOf("@");
  return (at === -1 ? addr : addr.slice(at + 1)).toLowerCase() || null;
}

/** True when a `from` value (or a bare domain) belongs to the Beleth domain. */
export function isBelethMail(from: string | null | undefined): boolean {
  const d = fromDomain(from);
  if (!d) return false;
  return d === BELETH_MAIL_DOMAIN || d.endsWith(`.${BELETH_MAIL_DOMAIN}`);
}

// Segments carry no sender domain in Resend, so the only signal that one
// belongs to Beleth is its name. Heuristic, but it keeps another project's
// contact lists out of the campaign flow.
export function isBelethSegmentName(name: string | null | undefined): boolean {
  return !!name && /beleth/i.test(name);
}

/** Resolve a batch of promises in fixed-size waves (Resend rate limits). */
async function inWaves<T, R>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return out;
}

// --- Domains -----------------------------------------------------------------

export type ResendDomainStatus =
  | "not_started"
  | "pending"
  | "verified"
  | "failed"
  | "temporary_failure"
  | (string & {});

export type ResendDomain = {
  id: string;
  name: string;
  status: ResendDomainStatus;
  region: string | null;
  createdAt: string | null;
};

export async function fetchDomains(): Promise<ResendDomain[]> {
  const body = await resendRequest<{
    data?: Array<{
      id: string;
      name: string;
      status: string;
      region?: string | null;
      created_at?: string | null;
    }>;
  }>("/domains");
  return (body.data ?? []).map((d) => ({
    id: d.id,
    name: d.name,
    status: d.status,
    region: d.region ?? null,
    createdAt: d.created_at ?? null,
  }));
}

/** Only the Beleth sending domain(s). */
export async function fetchBelethDomains(): Promise<ResendDomain[]> {
  return (await fetchDomains()).filter((d) => isBelethMail(d.name));
}

// --- Sent emails -----------------------------------------------------------

// Resend's list endpoint has no total; it returns a page + has_more. So the
// dashboard reports "the most recent N", never an all-time count.
export type SentEmail = {
  id: string;
  to: string[];
  from: string;
  subject: string;
  createdAt: string | null;
  lastEvent: string;
};

export type RecentEmails = {
  emails: SentEmail[];
  hasMore: boolean;
};

export async function fetchRecentEmails(limit = 100): Promise<RecentEmails> {
  const body = await resendRequest<{
    has_more?: boolean;
    data?: Array<{
      id: string;
      to?: string[] | string | null;
      from: string;
      subject?: string | null;
      created_at?: string | null;
      last_event?: string | null;
    }>;
  }>("/emails", { query: { limit: Math.min(100, Math.max(1, limit)) } });

  const emails = (body.data ?? []).map((e) => ({
    id: e.id,
    to: Array.isArray(e.to) ? e.to : e.to ? [e.to] : [],
    from: e.from,
    subject: e.subject ?? "(no subject)",
    createdAt: e.created_at ?? null,
    lastEvent: e.last_event ?? "unknown",
  }));
  return { emails, hasMore: Boolean(body.has_more) };
}

/**
 * Recent sends narrowed to Beleth's own mail. `scanned` is how many account
 * sends were looked at (the API paginates without a total), `emails` is the
 * Beleth subset of those.
 */
export async function fetchBelethRecentEmails(
  limit = 100,
): Promise<RecentEmails & { scanned: number }> {
  const { emails, hasMore } = await fetchRecentEmails(limit);
  return {
    scanned: emails.length,
    emails: emails.filter((e) => isBelethMail(e.from)),
    hasMore,
  };
}

export type EventTally = Record<string, number>;

export function tallyEvents(emails: SentEmail[]): EventTally {
  const out: EventTally = {};
  for (const e of emails) out[e.lastEvent] = (out[e.lastEvent] ?? 0) + 1;
  return out;
}

// --- Templates -------------------------------------------------------------

export type TemplateSummary = {
  id: string;
  name: string;
  alias: string | null;
  status: "draft" | "published" | (string & {});
  updatedAt: string | null;
  publishedAt: string | null;
};

export type TemplateVariable = {
  key: string;
  type: string | null;
  fallback: string | null;
};

export type Template = TemplateSummary & {
  subject: string | null;
  from: string | null;
  replyTo: string | null;
  html: string;
  text: string;
  variables: TemplateVariable[];
  hasUnpublishedVersions: boolean;
};

export async function fetchTemplates(): Promise<TemplateSummary[]> {
  const body = await resendRequest<{
    data?: Array<{
      id: string;
      name: string;
      alias?: string | null;
      status: string;
      updated_at?: string | null;
      published_at?: string | null;
    }>;
  }>("/templates", { query: { limit: 100 } });
  return (body.data ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    alias: t.alias ?? null,
    status: t.status,
    updatedAt: t.updated_at ?? null,
    publishedAt: t.published_at ?? null,
  }));
}

export async function fetchTemplate(id: string): Promise<Template> {
  const t = await resendRequest<{
    id: string;
    name: string;
    alias?: string | null;
    status: string;
    updated_at?: string | null;
    published_at?: string | null;
    subject?: string | null;
    from?: string | null;
    reply_to?: string | null;
    html?: string | null;
    text?: string | null;
    variables?: Array<{ key: string; type?: string | null; fallback_value?: string | null }>;
    has_unpublished_versions?: boolean;
  }>(`/templates/${encodeURIComponent(id)}`);
  return {
    id: t.id,
    name: t.name,
    alias: t.alias ?? null,
    status: t.status,
    updatedAt: t.updated_at ?? null,
    publishedAt: t.published_at ?? null,
    subject: t.subject ?? null,
    from: t.from ?? null,
    replyTo: t.reply_to ?? null,
    html: t.html ?? "",
    text: t.text ?? "",
    variables: (t.variables ?? []).map((v) => ({
      key: v.key,
      type: v.type ?? null,
      fallback: v.fallback_value ?? null,
    })),
    hasUnpublishedVersions: Boolean(t.has_unpublished_versions),
  };
}

export async function updateTemplate(
  id: string,
  patch: { subject?: string; html?: string; text?: string },
): Promise<void> {
  await resendRequest(`/templates/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: patch,
  });
}

/**
 * Templates whose sender is explicitly on the Beleth domain. The list endpoint
 * carries no `from`, so each template is fetched once. Strict: a template with
 * no `from` set is NOT shown (in a shared account that is ambiguous) — it is
 * counted in `hiddenNoSender` so the UI can explain the gap.
 */
export async function fetchBelethTemplates(): Promise<{
  templates: TemplateSummary[];
  hiddenNoSender: number;
  hiddenForeign: number;
}> {
  const all = await fetchTemplates();
  const checked = await inWaves(all, 4, async (t) => {
    try {
      const full = await fetchTemplate(t.id);
      return { t, from: full.from };
    } catch {
      return { t, from: null as string | null };
    }
  });
  const templates: TemplateSummary[] = [];
  let hiddenNoSender = 0;
  let hiddenForeign = 0;
  for (const { t, from } of checked) {
    if (isBelethMail(from)) templates.push(t);
    else if (!from) hiddenNoSender += 1;
    else hiddenForeign += 1;
  }
  return { templates, hiddenNoSender, hiddenForeign };
}

export type CreateTemplateInput = {
  name: string;
  alias?: string;
  subject?: string;
  html: string;
  from?: string;
  variables?: Array<{ key: string; type: "string" | "number"; fallback_value?: string | number }>;
};

/** Create a template, then publish it so it can be used straight away. */
export async function createTemplate(input: CreateTemplateInput): Promise<string> {
  const res = await resendRequest<{ id: string }>("/templates", {
    method: "POST",
    body: {
      name: input.name,
      alias: input.alias || undefined,
      subject: input.subject || undefined,
      html: input.html,
      from: input.from || undefined,
      variables: input.variables?.length ? input.variables : undefined,
    },
  });
  await resendRequest(`/templates/${encodeURIComponent(res.id)}/publish`, {
    method: "POST",
  });
  return res.id;
}

// --- Broadcasts (marketing campaigns) -----------------------------------------

export type BroadcastStatus =
  | "draft"
  | "scheduled"
  | "sent"
  | "sending"
  | "queued"
  | "canceled"
  | (string & {});

export type BroadcastSummary = {
  id: string;
  name: string;
  status: BroadcastStatus;
  createdAt: string | null;
  scheduledAt: string | null;
  sentAt: string | null;
};

export type Broadcast = BroadcastSummary & {
  segmentId: string | null;
  audienceId: string | null;
  from: string | null;
  subject: string | null;
  replyTo: string | null;
  previewText: string | null;
  html: string;
  text: string;
};

export async function fetchBroadcasts(): Promise<BroadcastSummary[]> {
  const body = await resendRequest<{
    data?: Array<{
      id: string;
      name?: string | null;
      status: string;
      created_at?: string | null;
      scheduled_at?: string | null;
      sent_at?: string | null;
    }>;
  }>("/broadcasts", { query: { limit: 100 } });
  return (body.data ?? []).map((b) => ({
    id: b.id,
    name: b.name || "(untitled broadcast)",
    status: b.status,
    createdAt: b.created_at ?? null,
    scheduledAt: b.scheduled_at ?? null,
    sentAt: b.sent_at ?? null,
  }));
}

export async function fetchBroadcast(id: string): Promise<Broadcast> {
  const b = await resendRequest<{
    id: string;
    name?: string | null;
    status: string;
    created_at?: string | null;
    scheduled_at?: string | null;
    sent_at?: string | null;
    segment_id?: string | null;
    audience_id?: string | null;
    from?: string | null;
    subject?: string | null;
    reply_to?: string | null;
    preview_text?: string | null;
    html?: string | null;
    text?: string | null;
  }>(`/broadcasts/${encodeURIComponent(id)}`);
  return {
    id: b.id,
    name: b.name || "(untitled broadcast)",
    status: b.status,
    createdAt: b.created_at ?? null,
    scheduledAt: b.scheduled_at ?? null,
    sentAt: b.sent_at ?? null,
    segmentId: b.segment_id ?? null,
    audienceId: b.audience_id ?? null,
    from: b.from ?? null,
    subject: b.subject ?? null,
    replyTo: b.reply_to ?? null,
    previewText: b.preview_text ?? null,
    html: b.html ?? "",
    text: b.text ?? "",
  };
}

// Same story as templates: the list has no `from`, so each broadcast is
// fetched once and kept only if it sends explicitly from the Beleth domain.
export async function fetchBelethBroadcasts(): Promise<BroadcastSummary[]> {
  const all = await fetchBroadcasts();
  const checked = await inWaves(all, 4, async (b) => {
    try {
      const full = await fetchBroadcast(b.id);
      return { b, from: full.from };
    } catch {
      return { b, from: null as string | null };
    }
  });
  return checked.filter(({ from }) => isBelethMail(from)).map(({ b }) => b);
}

export type CreateBroadcastInput = {
  segmentId: string;
  from: string;
  subject: string;
  name?: string;
  replyTo?: string;
  previewText?: string;
  html?: string;
};

export async function createBroadcast(input: CreateBroadcastInput): Promise<string> {
  const res = await resendRequest<{ id: string }>("/broadcasts", {
    method: "POST",
    body: {
      segment_id: input.segmentId,
      from: input.from,
      subject: input.subject,
      name: input.name || undefined,
      reply_to: input.replyTo || undefined,
      preview_text: input.previewText || undefined,
      html: input.html || undefined,
    },
  });
  return res.id;
}

export async function sendBroadcast(id: string, scheduledAt?: string): Promise<void> {
  await resendRequest(`/broadcasts/${encodeURIComponent(id)}/send`, {
    method: "POST",
    body: scheduledAt ? { scheduled_at: scheduledAt } : undefined,
  });
}

export async function deleteBroadcast(id: string): Promise<void> {
  await resendRequest(`/broadcasts/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// Recipient counts for a sent broadcast. The endpoint paginates without a
// total, so a full page (100) is reported as "100+".
const ENGAGEMENT_TYPES = ["delivered", "opened", "clicked", "bounced", "complained"] as const;
export type EngagementType = (typeof ENGAGEMENT_TYPES)[number];
export type Engagement = Partial<Record<EngagementType, { count: number; capped: boolean }>>;

export async function fetchBroadcastEngagement(id: string): Promise<Engagement> {
  const out: Engagement = {};
  const results = await Promise.allSettled(
    ENGAGEMENT_TYPES.map((type) =>
      resendRequest<{ has_more?: boolean; data?: unknown[] }>(
        `/broadcasts/${encodeURIComponent(id)}/recipients`,
        { query: { type, limit: 100 } },
      ).then((r) => ({ type, len: r.data?.length ?? 0, more: Boolean(r.has_more) })),
    ),
  );
  for (const r of results) {
    if (r.status === "fulfilled") {
      out[r.value.type] = { count: r.value.len, capped: r.value.more };
    }
  }
  return out;
}

// --- Segments (formerly Audiences) -----------------------------------------

export type Segment = {
  id: string;
  name: string;
  createdAt: string | null;
};

export async function fetchSegments(): Promise<Segment[]> {
  const body = await resendRequest<{
    data?: Array<{ id: string; name: string; created_at?: string | null }>;
  }>("/segments", { query: { limit: 100 } });
  return (body.data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    createdAt: s.created_at ?? null,
  }));
}

/**
 * Segments whose name mentions Beleth (the only available signal). `scanned`
 * is the account total, so the UI can say "3 of 11 segments".
 */
export async function fetchBelethSegments(): Promise<{
  segments: Segment[];
  scanned: number;
}> {
  const all = await fetchSegments();
  return {
    segments: all.filter((s) => isBelethSegmentName(s.name)),
    scanned: all.length,
  };
}
