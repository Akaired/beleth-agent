/**
 * `GET /api/equity?range=1D|1W|1M|ALL` — the equity curve behind the homepage
 * and dashboard charts. The client range switcher calls this; the pages
 * themselves read `fetchEquityHistory` directly for their first render.
 *
 * Not cached at the route level (Next default), but the upstream Alpaca call is
 * `revalidate: 60`, and the response carries a short shared-cache TTL so the
 * CDN can absorb repeat range switches.
 */
import { fetchEquityHistory, isEquityRange } from "@/lib/alpaca";
import { DataUnavailableError } from "@/lib/supabase";

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("range");
  const range = isEquityRange(raw) ? raw : "1W";

  try {
    const history = await fetchEquityHistory(range);
    return Response.json(history, {
      headers: { "Cache-Control": "public, max-age=30, s-maxage=60" },
    });
  } catch (err) {
    const message =
      err instanceof DataUnavailableError
        ? err.message
        : "equity history unavailable";
    return Response.json({ error: message }, { status: 503 });
  }
}
