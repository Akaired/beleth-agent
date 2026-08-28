/**
 * Browser Supabase client — used only by the client-side login form to call
 * `signInWithPassword` / `signUp`. Everything else reads on the server.
 */
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
