import { getSessionContext, roleAtLeast } from "@/lib/auth";
import { Panel } from "@/components/dashboard/ui";
import { IconProhibit } from "@/components/icons";

// Sits inside the admin shell. The doc list (drafts included) is readable by
// the demo-admin judges' account; the editor route itself is gated to
// master_admin in `./[id]/page.tsx`, and every write re-checks in `./actions.ts`.
export default async function AdminDocsLayout({
  children,
}: LayoutProps<"/dashboard/admin/docs">) {
  const ctx = await getSessionContext();
  if (!ctx || !roleAtLeast(ctx.role, "demo_admin")) {
    return (
      <Panel title="Not available for your account">
        <p className="flex items-start gap-2 text-[13px] text-sec leading-relaxed">
          <IconProhibit size={16} className="mt-0.5 shrink-0 text-dim" />
          The Documentation tab is for the demo-admin and master-admin accounts.
        </p>
      </Panel>
    );
  }

  return children;
}
