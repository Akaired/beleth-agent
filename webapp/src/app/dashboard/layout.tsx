import { requireSession, roleAtLeast } from "@/lib/auth";
import { fetchOpenSpreadCount } from "@/lib/dashboard-queries";
import { DashboardChrome } from "@/components/dashboard/chrome";

export default async function DashboardLayout({
  children,
}: LayoutProps<"/dashboard">) {
  const ctx = await requireSession();

  // The Positions view (and its sidebar badge) is demo_admin and up.
  const openSpreads = roleAtLeast(ctx.role, "demo_admin")
    ? await fetchOpenSpreadCount()
    : 0;

  return (
    <DashboardChrome
      role={ctx.role}
      email={ctx.email}
      badges={{ "/dashboard/positions": openSpreads }}
    >
      {children}
    </DashboardChrome>
  );
}
