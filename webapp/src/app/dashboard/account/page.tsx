import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";

/**
 * "Account" in the sidebar now means the user's public profile. Sign-in and
 * account-lifecycle settings moved to /dashboard/settings/account.
 */
export default async function AccountRedirectPage() {
  const ctx = await requireSession();
  redirect(`/u/${ctx.userId}`);
}
