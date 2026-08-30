/**
 * Shared form-state shapes for the account actions. Kept out of `actions.ts`
 * because a "use server" module may only export async functions — not the
 * `EMPTY_STATE` constant the client forms need as their initial value.
 */
export type FormState = { error: string | null; notice: string | null };
export const EMPTY_STATE: FormState = { error: null, notice: null };

export type AvatarResult =
  | { ok: true; url: string | null }
  | { ok: false; error: string };
