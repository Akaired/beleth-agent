import { fetchPublishedDocBySlug } from "@/lib/docs/queries";

/**
 * Raw Markdown for one published page — the "View as Markdown" link and the
 * "Copy for LLM" button both hit this. Plain text so a browser shows it
 * inline and an LLM gets clean source.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const page = await fetchPublishedDocBySlug(slug);
  if (!page) {
    return new Response("Not found\n", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const body = [
    `# ${page.title}`,
    "",
    page.summary ? `> ${page.summary}\n` : null,
    page.content_md.trim(),
    "",
  ]
    .filter((line) => line !== null)
    .join("\n");

  return new Response(body, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
