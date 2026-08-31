import { redirect } from "next/navigation";

// Settings has no landing of its own — go to the first (and, for now, only) tab.
export default function SettingsIndexPage() {
  redirect("/dashboard/settings/account");
}
