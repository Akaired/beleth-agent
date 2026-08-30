import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

/**
 * Chrome for a logged-out forum visitor: the public site header + footer, no
 * dashboard sidebar. Signed-in visitors get `DashboardChrome` instead (see
 * src/app/forum/layout.tsx). The agent status line is left off here — the forum
 * shell has no reason to fetch it.
 */
export function PublicForumShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader agentStatus={null} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-[clamp(16px,3vw,40px)]">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
