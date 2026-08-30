import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { IconDocs } from "@/components/icons";
import { fetchFirstPublishedDocSlug } from "@/lib/docs/queries";

export const metadata: Metadata = {
  title: "Documentation — Beleth",
  description:
    "How Beleth trades a measured volatility risk premium on a paper account, under strict rules.",
};

export default async function DocsIndexPage() {
  const slug = await fetchFirstPublishedDocSlug();
  if (slug) redirect(`/docs/${slug}`);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
      <IconDocs size={28} className="text-dim" />
      <h1 className="text-[18px] font-light text-txt">Nothing published yet</h1>
      <p className="text-[13px] text-sec">Check back soon.</p>
    </div>
  );
}
