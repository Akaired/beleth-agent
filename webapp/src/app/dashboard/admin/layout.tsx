import { requireSession } from "@/lib/auth";
import { Panel } from "@/components/dashboard/ui";
import { AdminTabs } from "@/components/dashboard/admin-tabs";
import { IconAdmin, IconProhibit } from "@/components/icons";

/**
 * Admin shell — master-admin only, one level below the read-only backoffice.
 * The page title + a row of horizontal tabs live in the content body; each
 * tab is its own route under `/dashboard/admin/*`. Deliberately thin for now:
 * the individual panels are Davide's to flesh out.
 */
export default async function AdminLayout({
  children,
}: LayoutProps<"/dashboard/admin">) {
  const ctx = await requireSession();

  if (ctx.role !== "master_admin") {
    return (
      <Panel title="Not available for your account">
        <p className="flex items-start gap-2 text-[13px] text-sec leading-relaxed">
          <IconProhibit size={16} className="mt-0.5 shrink-0 text-dim" />
          The admin panel is the master-admin account only.
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
      <AdminTabs />
      {children}
    </div>
  );
}
