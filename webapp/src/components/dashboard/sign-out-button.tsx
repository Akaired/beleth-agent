import { signOutAction } from "@/app/dashboard/actions";
import { IconSignOut } from "@/components/icons";

export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <button
        type="submit"
        className="flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-dim transition-colors hover:text-down"
      >
        <IconSignOut size={13} />
        Sign out
      </button>
    </form>
  );
}
