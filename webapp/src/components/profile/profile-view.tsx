import Link from "next/link";
import type { PublicProfile } from "@/lib/profile";
import type { ForumTopicListItem } from "@/lib/forum/types";
import { levelForXp } from "@/lib/progress";
import { UserAvatar } from "@/components/user-avatar";
import { Panel } from "@/components/dashboard/ui";
import { TopicListTable } from "@/components/forum/topic-list-table";
import { IconHistory, IconPencil } from "@/components/icons";
import { formatDate } from "@/lib/format";

function XpSummary({ xp, streak }: { xp: number; streak: number }) {
  const info = levelForXp(xp);
  const maxed = info.next === null;
  const pct = Math.round(info.fraction * 100);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-dim">
            Lv {info.rank.level}
          </span>
          <span className="text-[15px] font-medium tracking-[-0.01em] text-txt">
            {info.rank.title}
          </span>
        </div>
        <span className="font-mono text-[11px] text-sec">
          {xp.toLocaleString("en-US")} XP
        </span>
      </div>

      <div
        className="h-2 overflow-hidden rounded-full bg-chipbg"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full bg-acc"
          style={{ width: `${maxed ? 100 : Math.max(pct, 2)}%` }}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 font-mono text-[10.5px] text-dim">
        {maxed ? (
          <span className="text-acc">Highest rank reached.</span>
        ) : (
          <span>
            {info.xpToNext.toLocaleString("en-US")} XP to{" "}
            <span className="text-sec">{info.next?.title}</span>
          </span>
        )}
        {streak > 0 && (
          <span className="flex items-center gap-1 text-sec">
            <IconHistory size={11} />
            {streak}-day streak
          </span>
        )}
      </div>
    </div>
  );
}

export function ProfileView({
  profile,
  topics,
  isSelf,
}: {
  profile: PublicProfile;
  topics: ForumTopicListItem[];
  isSelf: boolean;
}) {
  const rank = levelForXp(profile.xp).rank;

  if (profile.isDeactivated) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-4">
        <Panel>
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <UserAvatar name={profile.displayName} avatarUrl={null} size={64} />
            <p className="text-[14px] text-txt">This account is deactivated.</p>
            <p className="max-w-sm text-[12.5px] text-sec">
              The person behind it has suspended their profile. Their forum
              posts stay where they are.
            </p>
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <Panel>
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <UserAvatar
                name={profile.displayName}
                avatarUrl={profile.avatarUrl}
                size={72}
              />
              <div className="flex flex-col gap-1">
                <span className="text-[18px] font-medium tracking-[-0.01em] text-txt">
                  {profile.displayName}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-acc">
                  {rank.title}
                </span>
                <span className="font-mono text-[10.5px] text-dim">
                  Member since {formatDate(profile.createdAt)}
                </span>
              </div>
            </div>
            {isSelf && (
              <Link
                href="/dashboard/settings/account"
                className="flex items-center gap-1.5 rounded border border-inputline bg-inset px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.06em] text-txt transition-colors hover:border-hoverline"
              >
                <IconPencil size={12} />
                Edit profile
              </Link>
            )}
          </div>

          {profile.bio && (
            <p className="max-w-prose whitespace-pre-line text-[13px] leading-relaxed text-sec">
              {profile.bio}
            </p>
          )}

          <div className="border-t border-line pt-4">
            <XpSummary xp={profile.xp} streak={profile.streakDays} />
          </div>
        </div>
      </Panel>

      <div className="flex flex-col gap-2">
        <h2 className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-sec">
          Forum topics
        </h2>
        {topics.length === 0 ? (
          <div className="rounded-md border border-line bg-panel p-6 text-center text-[12.5px] text-dim">
            {isSelf
              ? "You haven't started a topic yet."
              : "No topics started yet."}
          </div>
        ) : (
          <TopicListTable topics={topics} showCategory />
        )}
      </div>
    </div>
  );
}
