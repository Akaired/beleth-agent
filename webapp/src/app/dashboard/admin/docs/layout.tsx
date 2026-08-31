import { getSessionContext } from "@/lib/auth";
import { Panel } from "@/components/dashboard/ui";
import { IconProhibit } from "@/components/icons";

// Sits inside the admin shell (which opens to demo-admin for the Forum tab).
// Documentation editing is master-admin only, so it gates itself here —
// covering the list and the editor route.
export default async function AdminDocsLayout({
  children,
}: LayoutProps<"/dashboard/admin/docs">) {
  const ctx = await getSessionContext();
  if (ctx?.role !== "master_admin") {
    return (
      <Panel title="Not available for your account">
        <p className="flex items-start gap-2 text-[13px] text-sec leading-relaxed">
          <IconProhibit size={16} className="mt-0.5 shrink-0 text-dim" />
          The Documentation tab is the master-admin account only.
        </p>
      </Panel>
    );
  }

  return children;
}
