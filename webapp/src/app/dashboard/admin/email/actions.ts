"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import {
  createBroadcast,
  createTemplate,
  deleteBroadcast,
  sendBroadcast,
  updateTemplate,
  fetchTemplates,
  fetchTemplate,
  fetchBroadcast,
  fetchSegments,
  isBelethMail,
  isBelethSegmentName,
  BELETH_MAIL_DOMAIN,
  ResendApiError,
  ResendNotConfigured,
  type CreateBroadcastInput,
} from "@/lib/admin/email";
import { STARTER_TEMPLATES, getStarterTemplate } from "@/lib/admin/email-templates";

type Result = { ok: true } | { ok: false; error: string };
type CreateResult = { ok: true; id: string } | { ok: false; error: string };

async function assertMasterAdmin(): Promise<{ ok: false; error: string } | null> {
  const ctx = await requireSession();
  if (ctx.role !== "master_admin") {
    return { ok: false, error: "Master-admin only." };
  }
  return null;
}

function toMessage(err: unknown): string {
  if (err instanceof ResendNotConfigured) {
    return "RESEND_API_KEY is not set in this environment.";
  }
  if (err instanceof ResendApiError) return err.message;
  return err instanceof Error ? err.message : "Unexpected error.";
}

const STARTER_FROM = `Beleth <no-reply@${BELETH_MAIL_DOMAIN}>`;

/**
 * Provision one starter template (create + publish) into Resend. Idempotent-ish:
 * refuses if a template with that alias already exists so a double click can't
 * make duplicates.
 */
export async function createStarterTemplateAction(alias: string): Promise<Result> {
  const denied = await assertMasterAdmin();
  if (denied) return denied;

  const preset = getStarterTemplate(alias);
  if (!preset) return { ok: false, error: `Unknown template "${alias}".` };

  try {
    const existing = await fetchTemplates();
    if (existing.some((t) => t.alias === preset.alias)) {
      return { ok: false, error: `"${preset.name}" already exists in Resend.` };
    }
    await createTemplate({
      name: preset.name,
      alias: preset.alias,
      subject: preset.subject,
      html: preset.html,
      from: STARTER_FROM,
      variables: preset.variables,
    });
    revalidatePath("/dashboard/admin/email/templates");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

/** Provision every starter template that isn't in Resend yet. */
export async function createAllStarterTemplatesAction(): Promise<
  { ok: true; created: number; skipped: number } | { ok: false; error: string }
> {
  const denied = await assertMasterAdmin();
  if (denied) return denied;

  try {
    const existing = await fetchTemplates();
    const have = new Set(existing.map((t) => t.alias).filter(Boolean));
    let created = 0;
    for (const preset of STARTER_TEMPLATES) {
      if (have.has(preset.alias)) continue;
      await createTemplate({
        name: preset.name,
        alias: preset.alias,
        subject: preset.subject,
        html: preset.html,
        from: STARTER_FROM,
        variables: preset.variables,
      });
      created += 1;
    }
    revalidatePath("/dashboard/admin/email/templates");
    return { ok: true, created, skipped: STARTER_TEMPLATES.length - created };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function updateTemplateAction(
  id: string,
  patch: { subject?: string; html?: string; text?: string },
): Promise<Result> {
  const denied = await assertMasterAdmin();
  if (denied) return denied;
  try {
    // Never edit another project's template on the shared account.
    const current = await fetchTemplate(id);
    if (current.from && !isBelethMail(current.from)) {
      return { ok: false, error: "That template is not on the Beleth domain." };
    }
    await updateTemplate(id, patch);
    revalidatePath("/dashboard/admin/email/templates");
    revalidatePath(`/dashboard/admin/email/templates/${id}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function createBroadcastAction(
  input: CreateBroadcastInput,
): Promise<CreateResult> {
  const denied = await assertMasterAdmin();
  if (denied) return denied;
  if (!input.segmentId || !input.from || !input.subject) {
    return { ok: false, error: "Segment, from and subject are required." };
  }
  if (!isBelethMail(input.from)) {
    return {
      ok: false,
      error: `From must be on ${BELETH_MAIL_DOMAIN}.`,
    };
  }
  try {
    // The chosen segment must be a Beleth segment (name heuristic) — don't let
    // a Beleth campaign target another project's contact list.
    const segments = await fetchSegments();
    const seg = segments.find((s) => s.id === input.segmentId);
    if (!seg || !isBelethSegmentName(seg.name)) {
      return { ok: false, error: "Pick a Beleth segment." };
    }
    const id = await createBroadcast(input);
    revalidatePath("/dashboard/admin/email/campaigns");
    return { ok: true, id };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function sendBroadcastAction(
  id: string,
  scheduledAt?: string,
): Promise<Result> {
  const denied = await assertMasterAdmin();
  if (denied) return denied;
  try {
    const b = await fetchBroadcast(id);
    if (!isBelethMail(b.from)) {
      return { ok: false, error: "That campaign is not on the Beleth domain." };
    }
    await sendBroadcast(id, scheduledAt?.trim() || undefined);
    revalidatePath("/dashboard/admin/email/campaigns");
    revalidatePath(`/dashboard/admin/email/campaigns/${id}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function deleteBroadcastAction(id: string): Promise<Result> {
  const denied = await assertMasterAdmin();
  if (denied) return denied;
  try {
    const b = await fetchBroadcast(id);
    if (!isBelethMail(b.from)) {
      return { ok: false, error: "That campaign is not on the Beleth domain." };
    }
    await deleteBroadcast(id);
    revalidatePath("/dashboard/admin/email/campaigns");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}
