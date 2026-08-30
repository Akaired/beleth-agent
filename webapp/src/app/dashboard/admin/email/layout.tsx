import { EmailSubnav } from "@/components/dashboard/admin/email-nav";

// Sits inside the admin shell (which already gates master-admin and renders
// the "Admin" title + top tab row). This just adds the Email sub-navigation.
export default function AdminEmailLayout({
  children,
}: LayoutProps<"/dashboard/admin/email">) {
  return (
    <div className="flex flex-col gap-5">
      <EmailSubnav />
      {children}
    </div>
  );
}
