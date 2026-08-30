import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

/**
 * Chrome for a logged-out documentation visitor: the public site header +
 * footer, no dashboard sidebar. Signed-in visitors get `DashboardChrome`
 * instead (see src/app/docs/layout.tsx). Same URLs either way; `src/proxy.ts`
 * does not gate `/docs`.
 */
export function PublicDocsShell({ children }: { children: React.ReactNode }) {
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
