import { requireSession } from "@/lib/auth";
import { DashboardChrome } from "@/components/dashboard/chrome";

export default async function DashboardLayout({
  children,
}: LayoutProps<"/dashboard">) {
  const ctx = await requireSession();

  return (
    <DashboardChrome role={ctx.role} email={ctx.email}>
      {children}
    </DashboardChrome>
  );
}
