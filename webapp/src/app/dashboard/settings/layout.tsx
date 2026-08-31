import { requireSession } from "@/lib/auth";
import { SettingsTabs } from "@/components/dashboard/settings-tabs";
import { IconSettings } from "@/components/icons";

/**
 * Settings shell — title + a horizontal tab row, one route per tab under
 * `/dashboard/settings/*`. Mirrors the admin shell. Open to every signed-in
 * user (settings are personal, not role-gated).
 */
export default async function SettingsLayout({
  children,
}: LayoutProps<"/dashboard/settings">) {
  await requireSession();

  return (
    <div className="flex flex-col gap-5">
      <h1 className="flex items-center gap-2 text-[18px] font-light">
        <IconSettings size={17} weight="bold" className="text-acc" />
        Settings
      </h1>
      <SettingsTabs />
      {children}
    </div>
  );
}
