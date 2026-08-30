import "server-only";

/**
 * Read-only view of the Resend account backing auth email. The webapp itself
 * sends nothing — Supabase Auth delivers via Custom SMTP (smtp.resend.com) —
 * so this is a status surface, not a mailer. Davide wires the write side
 * (templates, test send) later.
 */

const RESEND_API = "https://api.resend.com";

export type ResendDomainStatus =
  | "not_started"
  | "pending"
  | "verified"
  | "failed"
  | "temporary_failure"
  | string;

export type ResendDomain = {
  id: string;
  name: string;
  status: ResendDomainStatus;
  region: string | null;
  createdAt: string | null;
};

export type ResendStatus =
  | { configured: false }
  | { configured: true; error: string }
  | { configured: true; domains: ResendDomain[] };

export async function fetchResendStatus(): Promise<ResendStatus> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { configured: false };

  try {
    const res = await fetch(`${RESEND_API}/domains`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        configured: true,
        error: `Resend API responded ${res.status} ${res.statusText}`,
      };
    }
    const body = (await res.json()) as {
      data?: Array<{
        id: string;
        name: string;
        status: string;
        region?: string | null;
        created_at?: string | null;
      }>;
    };
    const domains: ResendDomain[] = (body.data ?? []).map((d) => ({
      id: d.id,
      name: d.name,
      status: d.status,
      region: d.region ?? null,
      createdAt: d.created_at ?? null,
    }));
    return { configured: true, domains };
  } catch (err) {
    return {
      configured: true,
      error: err instanceof Error ? err.message : "Could not reach the Resend API",
    };
  }
}
