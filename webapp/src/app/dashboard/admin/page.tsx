import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";

// The admin panel has no landing of its own — go to the first tab the role can
// open: master-admin starts on Email, demo-admin on the Forum administration.
export default async function AdminIndexPage() {
  const ctx = await getSessionContext();
  redirect(
    ctx?.role === "master_admin"
      ? "/dashboard/admin/email"
      : "/dashboard/admin/forum",
  );
}
