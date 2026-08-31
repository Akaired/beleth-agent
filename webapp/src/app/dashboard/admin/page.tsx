import { redirect } from "next/navigation";

// The admin panel has no landing of its own — every admin role (demo-admin
// read-only and master-admin) can open Email, so land there.
export default async function AdminIndexPage() {
  redirect("/dashboard/admin/email");
}
