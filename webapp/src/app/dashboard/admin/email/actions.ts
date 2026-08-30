"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import {
  createBroadcast,
  deleteBroadcast,
  sendBroadcast,
  updateTemplate,
  ResendApiError,
  ResendNotConfigured,
  type CreateBroadcastInput,
} from "@/lib/admin/email";

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

export async function updateTemplateAction(
  id: string,
  patch: { subject?: string; html?: string; text?: string },
): Promise<Result> {
  const denied = await assertMasterAdmin();
  if (denied) return denied;
  try {
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
  try {
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
    await deleteBroadcast(id);
    revalidatePath("/dashboard/admin/email/campaigns");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}
