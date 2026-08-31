import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { fetchPublicProfile } from "@/lib/profile";
import { fetchForumTopicsByAuthor } from "@/lib/forum/queries";
import { ProfileView } from "@/components/profile/profile-view";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({
  params,
}: PageProps<"/u/[id]">): Promise<Metadata> {
  const { id } = await params;
  if (!UUID_RE.test(id)) return { title: "Profile — Beleth" };
  const profile = await fetchPublicProfile(id);
  return {
    title: profile ? `${profile.displayName} — Beleth` : "Profile — Beleth",
  };
}

export default async function ProfilePage({ params }: PageProps<"/u/[id]">) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const [ctx, profile] = await Promise.all([
    getSessionContext(),
    fetchPublicProfile(id),
  ]);
  if (!profile) notFound();

  const topics = profile.isDeactivated
    ? []
    : await fetchForumTopicsByAuthor(id, 20);

  return (
    <ProfileView
      profile={profile}
      topics={topics}
      isSelf={ctx?.userId === profile.userId}
    />
  );
}
