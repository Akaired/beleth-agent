import { requireSession, roleAtLeast } from "@/lib/auth";
import { Panel } from "@/components/dashboard/ui";
import { AdminTabs } from "@/components/dashboard/admin-tabs";
import { IconAdmin, IconProhibit } from "@/components/icons";

/**
 * Admin shell. The chrome (title + tab row) opens to demo-admin so the judges
 * can read the Forum administration tab; every other tab (Email, Documentation,
 * Users) is master-admin only and gates itself at the page level. Each tab is
 * its own route under `/dashboard/admin/*`.
 */
export default async function AdminLayout({
  children,
}: LayoutProps<"/dashboard/admin">) {
  const ctx = await requireSession();

  if (!roleAtLeast(ctx.role, "demo_admin")) {
    return (
      <Panel title="Not available for your account">
        <p className="flex items-start gap-2 text-[13px] text-sec leading-relaxed">
          <IconProhibit size={16} className="mt-0.5 shrink-0 text-dim" />
          The admin area is for the demo-admin and master-admin accounts.
        </p>
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <h1 className="flex items-center gap-2 text-[18px] font-light">
        <IconAdmin size={17} weight="bold" className="text-acc" />
        Admin
      </h1>
      <AdminTabs role={ctx.role} />
      {children}
    </div>
  );
}
