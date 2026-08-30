import "server-only";

/**
 * Resend client for the admin Email section. The webapp sends no mail itself —
 * Supabase Auth delivers transactional mail over Custom SMTP — so everything
 * here is either read-only reporting or marketing "broadcasts" that a
 * master-admin drives deliberately from the UI (each mutating call is a
 * server action with its own role check and an armed confirm in the client).
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

export async function resendRequest<T>(path: string, init: ReqInit = {}): Promise<T> {
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
      `Resend API responded ${res.status} ${res.statusText}`;
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
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Could not reach the Resend API",
    };
  }
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
