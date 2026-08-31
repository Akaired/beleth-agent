import type { Metadata } from "next";
import { getSessionContext, roleAtLeast } from "@/lib/auth";
import { ForbiddenPanel } from "@/components/dashboard/ui";
import { Stat } from "@/components/dashboard/admin/email-ui";
import { fetchAdminUsers, tallyRoles } from "@/lib/admin/users";
import { UsersList } from "@/components/dashboard/admin/users-list";

export const metadata: Metadata = { title: "Admin · Users — Beleth backoffice" };

export default async function AdminUsersPage() {
  const ctx = await getSessionContext();
  if (!ctx || !roleAtLeast(ctx.role, "demo_admin")) return <ForbiddenPanel />;
  // demo-admin (judges) reads the roster; role changes / delete / confirm are
  // master-admin only, re-checked in ./actions.ts and the RPCs.
  const canWrite = ctx.role === "master_admin";

  const users = await fetchAdminUsers();
  const roles = tallyRoles(users);
  const unconfirmed = users.filter((u) => !u.emailConfirmedAt).length;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Users" value={users.length} />
        <Stat label="Public" value={roles.public_user} />
        <Stat label="Demo admin" value={roles.demo_admin} />
        <Stat label="Master admin" value={roles.master_admin} />
        <Stat label="Unconfirmed" value={unconfirmed} />
      </div>

      <UsersList users={users} currentUserId={ctx.userId} canWrite={canWrite} />
    </div>
  );
}
