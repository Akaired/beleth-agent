import type { Metadata } from "next";
import Link from "next/link";
import { isDemoAdmin, isMasterAdmin, requireSession } from "@/lib/auth";
import { fetchAccountProfile } from "@/lib/profile";
import { Panel, RoleChip } from "@/components/dashboard/ui";
import { AvatarUploader } from "@/components/dashboard/account/avatar-uploader";
import { ProfileForm } from "@/components/dashboard/account/profile-form";
import { PasswordForm } from "@/components/dashboard/account/password-form";
import { DangerZone } from "@/components/dashboard/settings/danger-zone";
import { IconArrowUpRight, IconProhibit } from "@/components/icons";

export const metadata: Metadata = { title: "Account settings — Beleth" };

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default async function AccountSettingsPage() {
  const ctx = await requireSession();
  const profile = await fetchAccountProfile();
  const name = profile.displayName ?? (profile.email ?? "account").split("@")[0];
  const readOnly = isDemoAdmin(ctx.role);

  return (
    <div className="flex flex-col gap-5">
      <p className="text-[12.5px] text-sec">
        Your identity, sign-in, and account lifecycle.{" "}
        <Link
          href={`/u/${profile.userId}`}
          className="inline-flex items-center gap-0.5 text-acc hover:underline"
        >
          View your public profile
          <IconArrowUpRight size={12} />
        </Link>
      </p>

      {readOnly ? (
        <Panel title="Read-only account">
          <p className="flex items-start gap-2 text-[13px] text-sec leading-relaxed">
            <IconProhibit size={16} className="mt-0.5 shrink-0 text-dim" />
            This is the shared demo account. It can browse the whole backoffice
            but never changes anything — nickname, avatar, password and account
            lifecycle are all disabled. It can still post on the forum, choosing
            a name each time.
          </p>
        </Panel>
      ) : (
        <>
          <Panel title="Profile">
            <div className="flex flex-col gap-5">
              <AvatarUploader name={name} avatarUrl={profile.avatarUrl} />
              <div className="border-t border-line pt-4">
                <ProfileForm
                  displayName={profile.displayName}
                  bio={profile.bio}
                />
              </div>
            </div>
          </Panel>

          <Panel title="Password">
            <PasswordForm />
          </Panel>
        </>
      )}

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

      {!readOnly && (
        <DangerZone
          email={profile.email}
          isMasterAdmin={isMasterAdmin(profile.role)}
        />
      )}
    </div>
  );
}
