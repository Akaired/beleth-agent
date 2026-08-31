import { redirect } from "next/navigation";

// The admin landing is the cross-section Overview — every admin role
// (demo-admin read-only and master-admin) may read it.
export default async function AdminIndexPage() {
  redirect("/dashboard/admin/overview");
}
