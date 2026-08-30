import type { Metadata } from "next";
import { requireSession } from "@/lib/auth";
import { fetchAccountProfile } from "@/lib/profile";
import { Panel, RoleChip } from "@/components/dashboard/ui";
import { AvatarUploader } from "@/components/dashboard/account/avatar-uploader";
import { ProfileForm } from "@/components/dashboard/account/profile-form";
import { PasswordForm } from "@/components/dashboard/account/password-form";
import {
  ExperienceBar,
  RankLadder,
} from "@/components/dashboard/account/experience-bar";
import { levelForXp } from "@/lib/progress";
import { IconAccount } from "@/components/icons";

export const metadata: Metadata = { title: "Account — Beleth" };

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default async function AccountPage() {
  await requireSession();
  const profile = await fetchAccountProfile();
  const name = profile.displayName ?? (profile.email ?? "account").split("@")[0];
  const rank = levelForXp(profile.progress.xp).rank;

  return (
    <div className="flex flex-col gap-5">
      <h1 className="flex items-center gap-2 text-[18px] font-light">
        <IconAccount size={17} weight="bold" className="text-acc" />
        Account
      </h1>

      {/* Identity + experience */}
      <Panel>
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-[17px] font-medium tracking-[-0.01em] text-txt">
                {name}
              </span>
              <span className="flex items-center gap-2 text-[12px] text-sec">
                {profile.email}
                <RoleChip role={profile.role} />
              </span>
              <span className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-acc">
                {rank.title}
              </span>
            </div>
            <AvatarUploader name={name} avatarUrl={profile.avatarUrl} />
          </div>

          {profile.bio && (
            <p className="max-w-prose text-[13px] leading-relaxed text-sec">
              {profile.bio}
            </p>
          )}

          <div className="border-t border-line pt-4">
            <ExperienceBar progress={profile.progress} />
          </div>
        </div>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
        <Panel title="Profile">
          <ProfileForm
            displayName={profile.displayName}
            bio={profile.bio}
          />
        </Panel>

        <Panel title="Ranks">
          <RankLadder xp={profile.progress.xp} />
        </Panel>
      </div>

      <Panel title="Password">
        <PasswordForm />
      </Panel>

      <Panel title="Account details">
        <dl className="grid gap-x-6 gap-y-3 text-[12.5px] sm:grid-cols-2">
          <div className="flex flex-col gap-0.5">
            <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-dim">
              Email
            </dt>
            <dd className="text-sec">{profile.email ?? "—"}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-dim">
              Role
            </dt>
            <dd className="text-sec">
              <RoleChip role={profile.role} />
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-dim">
              Member since
            </dt>
            <dd className="text-sec">{formatDate(profile.createdAt)}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-dim">
              User ID
            </dt>
            <dd className="font-mono text-[11px] text-dim break-all">
              {profile.userId}
            </dd>
          </div>
        </dl>
        <p className="mt-4 border-t border-line pt-3 text-[11.5px] text-dim">
          Changing your email address isn&apos;t available yet — it needs
          transactional mail, which isn&apos;t wired up on this deployment.
        </p>
      </Panel>
    </div>
  );
}
