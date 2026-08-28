import { signOutAction } from "@/app/dashboard/actions";

export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <button
        type="submit"
        className="font-mono text-[10.5px] tracking-[0.08em] uppercase text-dim hover:text-down transition-colors"
      >
        Sign out
      </button>
    </form>
  );
}
