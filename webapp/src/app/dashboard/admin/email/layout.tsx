import { getSessionContext, roleAtLeast } from "@/lib/auth";
import { Panel } from "@/components/dashboard/ui";
import { EmailSubnav } from "@/components/dashboard/admin/email-nav";
import { IconProhibit } from "@/components/icons";

// Sits inside the admin shell. Every admin role may read the Email tab
// (demo-admin is the read-only judges' account); the compose / send / edit
// actions all re-check master_admin in `./actions.ts`.
export default async function AdminEmailLayout({
  children,
}: LayoutProps<"/dashboard/admin/email">) {
  const ctx = await getSessionContext();
  if (!ctx || !roleAtLeast(ctx.role, "demo_admin")) {
    return (
      <Panel title="Not available for your account">
        <p className="flex items-start gap-2 text-[13px] text-sec leading-relaxed">
          <IconProhibit size={16} className="mt-0.5 shrink-0 text-dim" />
          The Email tab is for the demo-admin and master-admin accounts.
        </p>
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <EmailSubnav />
      {children}
    </div>
  );
}
