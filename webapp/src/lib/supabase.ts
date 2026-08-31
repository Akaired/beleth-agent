/**
 * Minimal typed PostgREST reader for the Supabase project the agent writes to.
 *
 * Mirrors the Python agent's approach (app/persistence.py): plain REST over
 * `{NEXT_PUBLIC_SUPABASE_URL}/rest/v1/<table>` with the public anon key. No
 * supabase-js dependency — reads only, the agent owns every write. The anon
 * key is public by design; row visibility is enforced by RLS policies
 * (db/migrations/0003_anon_read_policies.sql).
 */

const REST_PATH = "/rest/v1";

/**
 * Hard ceiling on any single PostgREST call. Without it a hung upstream
 * (notably at build time, where Next prerenders the homepage) blocks the
 * render until Vercel kills the worker at 60 s and the whole build fails.
 * Every caller already treats a throw as "data unavailable" and fails soft.
 */
const REST_TIMEOUT_MS = 8_000;

export class DataUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataUnavailableError";
  }
}

function restBase(): { base: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new DataUnavailableError(
      "Supabase public env not configured (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY)",
    );
  }
  return { base: url.replace(/\/+$/, ""), key };
}

function restUrl(table: string, params: Record<string, string>): URL {
  const { base } = restBase();
  const url = new URL(`${base}${REST_PATH}/${table}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url;
}

/**
 * GET rows from a table. Empty result set returns [] — PostgREST answers
 * RLS-filtered reads with 200 + [], not 404.
 */
export async function restGet<T>(
  table: string,
  params: Record<string, string>,
): Promise<T[]> {
  const { key } = restBase();
  let res: Response;
  try {
    res = await fetch(restUrl(table, params), {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(REST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new DataUnavailableError(
      `${table}: unreachable (${(err as Error).message})`,
    );
  }
  if (!res.ok) {
    throw new DataUnavailableError(`${table}: HTTP ${res.status}`);
  }
  return (await res.json()) as T[];
}

/**
 * Exact row count via `Prefer: count=exact` on a HEAD request; the total
 * arrives in the Content-Range header after the slash (0-0/N).
 */
export async function restCount(
  table: string,
  params: Record<string, string> = {},
): Promise<number> {
  const { key } = restBase();
  let res: Response;
  try {
    res = await fetch(restUrl(table, params), {
      method: "HEAD",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: "count=exact",
        // Range: 0-0 keeps the response tiny; Content-Range still carries the total.
        Range: "0-0",
      },
      signal: AbortSignal.timeout(REST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new DataUnavailableError(
      `${table}: unreachable (${(err as Error).message})`,
    );
  }
  if (!res.ok) {
    throw new DataUnavailableError(`${table}: HTTP ${res.status}`);
  }
  const contentRange = res.headers.get("content-range");
  const total = contentRange?.split("/")[1];
  if (total === undefined || total === "*") return 0;
  return Number.parseInt(total, 10);
}