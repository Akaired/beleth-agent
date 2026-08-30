import { redirect } from "next/navigation";

// The admin panel has no landing of its own yet — go straight to the first tab.
export default function AdminIndexPage() {
  redirect("/dashboard/admin/email");
}
