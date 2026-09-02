"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSessionContext, isDemoAdmin } from "@/lib/auth";
import {
  deleteChatSession,
  fetchChatSession,
  setChatMessageRating,
} from "@/lib/chat/queries";
import type { ChatRating } from "@/lib/chat/types";

/**
 * Delete one of the caller's own chat sessions (cascades to its messages).
 * RLS already prevents touching another user's row; the ownership check here
 * just turns a silent no-op into a clear refusal. The demo account owns no
 * sessions it may delete — its login is public and it cannot write (0029).
 */
export async function deleteChatSessionAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (isDemoAdmin(ctx.role)) return;

  const session = await fetchChatSession(id);
  if (!session || session.user_id !== ctx.userId) return;

  await deleteChatSession(id);
  revalidatePath("/dashboard/chats");
  revalidatePath("/dashboard", "layout");
}

/**
 * Set or clear the thumbs on one of Beleth's answers. `rating` null clears it
 * (used when toggling the active thumb off). RLS scopes the write to the
 * caller's own messages.
 */
export async function rateChatMessageAction(
  messageId: string,
  rating: ChatRating | null,
): Promise<{ ok: boolean }> {
  if (!messageId) return { ok: false };
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (isDemoAdmin(ctx.role)) return { ok: false };

  try {
    await setChatMessageRating(messageId, rating);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
