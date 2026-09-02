"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AdminUser } from "@/lib/admin/users";
import type { Role } from "@/lib/roles";
import { RoleChip, timeAgo } from "@/components/dashboard/ui";
import { UserAvatar } from "@/components/user-avatar";
import {
  confirmUserEmailAction,
  deleteUserAction,
  setUserRoleAction,
} from "@/app/dashboard/admin/users/actions";
import {
  IconCaretDown,
  IconCaretRight,
  IconCheck,
  IconChat,
  IconCheckCircle,
  IconEnvelope,
  IconForum,
  IconTrash,
  IconWarning,
} from "@/components/icons";

const ROLE_ORDER: Role[] = ["public_user", "demo_admin", "master_admin"];
const ROLE_LABEL: Record<Role, string> = {
  public_user: "Public",
  demo_admin: "Demo admin",
  master_admin: "Master admin",
};

function fullDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Metric({
  Icon,
  value,
  title,
}: {
  Icon: typeof IconForum;
  value: number;
  title: string;
}) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1 font-mono text-[11px] text-sec"
    >
      <Icon size={12} className="text-dim" />
      {value}
    </span>
  );
}

export function UsersList({
  users,
  currentUserId,
  canWrite = true,
}: {
  users: AdminUser[];
  currentUserId: string;
  /**
   * false for the read-only demo-admin account — hides role / delete controls, and
   * marks the email column as masked. The masking itself is done in the database
   * (0031), because the demo login is public.
   */
  canWrite?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Action failed.");
      else router.refresh();
    });
  }

  return (
    <section className="overflow-hidden rounded-md border border-line bg-panel">
      <div className="flex items-center justify-between gap-3 border-b border-line bg-panel-head px-4 py-2.5">
        <h2 className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-sec">
          Roster
        </h2>
        <span className="font-mono text-[10.5px] text-faint">
          {!canWrite && <span className="mr-2">emails masked</span>}
          {users.length} user{users.length === 1 ? "" : "s"}
        </span>
      </div>

      {error && (
        <p className="flex items-center gap-2 border-b border-line px-4 py-2 font-mono text-[11px] text-down">
          <IconWarning size={13} /> {error}
        </p>
      )}

      {users.length === 0 ? (
        <p className="px-4 py-3 text-[12px] text-dim">No users yet.</p>
      ) : (
        <ul className="divide-y divide-rowline">
          {users.map((u) => {
            const isSelf = u.userId === currentUserId;
            const isOpen = openId === u.userId;
            const name = u.displayName ?? u.email?.split("@")[0] ?? "unknown";
            return (
              <li key={u.userId} className="text-[13px]">
                <button
                  type="button"
                  onClick={() => {
                    setOpenId(isOpen ? null : u.userId);
                    setConfirmDeleteId(null);
                  }}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-hoverbg"
                >
                  {isOpen ? (
                    <IconCaretDown size={13} className="shrink-0 text-dim" />
                  ) : (
                    <IconCaretRight size={13} className="shrink-0 text-dim" />
                  )}
                  <UserAvatar name={name} avatarUrl={u.avatarUrl} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium text-txt">{name}</span>
                      {isSelf && (
                        <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-faint">
                          you
                        </span>
                      )}
                      {!u.emailConfirmedAt && (
                        <span className="rounded bg-acc/15 px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.1em] text-acc">
                          unconfirmed
                        </span>
                      )}
                    </span>
                    <span className="block truncate font-mono text-[11px] text-dim">
                      {u.email ?? "—"}
                    </span>
                  </span>
                  <span className="hidden shrink-0 items-center gap-3 sm:flex">
                    <Metric
                      Icon={IconForum}
                      value={u.forumTopicCount + u.forumPostCount}
                      title="Forum topics + posts"
                    />
                    <Metric
                      Icon={IconChat}
                      value={u.chatSessionCount}
                      title="Chat sessions"
                    />
                    <span
                      title={`${u.levelTitle} · ${u.xp} XP`}
                      className="rounded bg-chipbg px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.08em] text-sec"
                    >
                      lvl {u.level}
                    </span>
                  </span>
                  <span className="hidden w-[70px] shrink-0 text-right font-mono text-[10.5px] text-dim md:block">
                    {timeAgo(u.lastSignInAt)}
                  </span>
                  <RoleChip role={u.role} />
                </button>

                {isOpen && (
                  <div className="border-t border-rowline bg-inset px-4 py-3.5">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <dl className="flex flex-col gap-1.5 font-mono text-[11px]">
                        <Row k="User ID" v={u.userId} mono />
                        <Row k="Joined" v={fullDate(u.createdAt)} />
                        <Row k="Last sign-in" v={fullDate(u.lastSignInAt)} />
                        <Row
                          k="Email confirmed"
                          v={
                            u.emailConfirmedAt
                              ? fullDate(u.emailConfirmedAt)
                              : "no"
                          }
                        />
                        <Row
                          k="Activity"
                          v={`${u.forumTopicCount} topics · ${u.forumPostCount} posts · ${u.chatSessionCount} chats`}
                        />
                        <Row
                          k="Experience"
                          v={`${u.levelTitle} (lvl ${u.level}) · ${u.xp} XP · ${u.streakDays}d streak`}
                        />
                        {u.bio && <Row k="Bio" v={u.bio} />}
                      </dl>

                      {!canWrite ? (
                        <div className="flex flex-col gap-2">
                          <p className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-faint">
                            Role
                          </p>
                          <RoleChip role={u.role} />
                          <p className="mt-1 font-mono text-[10px] leading-relaxed text-faint">
                            Read-only — role changes, email confirmation and
                            account deletion are the master-admin account only.
                          </p>
                        </div>
                      ) : (
                      <div className="flex flex-col gap-3">
                        <div>
                          <p className="mb-1.5 font-mono text-[9.5px] uppercase tracking-[0.1em] text-faint">
                            Role
                          </p>
                          <div className="flex gap-1">
                            {ROLE_ORDER.map((r) => {
                              const active = u.role === r;
                              const lockSelf =
                                isSelf && r !== "master_admin";
                              return (
                                <button
                                  key={r}
                                  type="button"
                                  disabled={pending || active || lockSelf}
                                  title={
                                    lockSelf
                                      ? "You cannot demote your own account"
                                      : undefined
                                  }
                                  onClick={() =>
                                    run(() => setUserRoleAction(u.userId, r))
                                  }
                                  className={`rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.06em] transition-colors ${
                                    active
                                      ? "border-acc/40 bg-acc/15 text-acc"
                                      : "border-line text-sec hover:border-hoverline hover:text-txt disabled:opacity-30 disabled:hover:border-line disabled:hover:text-sec"
                                  }`}
                                >
                                  {ROLE_LABEL[r]}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {!u.emailConfirmedAt && (
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() =>
                                run(() => confirmUserEmailAction(u.userId))
                              }
                              className="inline-flex items-center gap-1.5 rounded border border-line px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-sec transition-colors hover:border-hoverline hover:text-txt disabled:opacity-40"
                            >
                              <IconEnvelope size={12} />
                              Confirm email
                            </button>
                          )}

                          {!isSelf && u.role !== "master_admin" && (
                            confirmDeleteId === u.userId ? (
                              <span className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  disabled={pending}
                                  onClick={() => {
                                    setConfirmDeleteId(null);
                                    run(() => deleteUserAction(u.userId));
                                  }}
                                  className="inline-flex items-center gap-1 rounded bg-down/15 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-down"
                                >
                                  <IconCheck size={12} />
                                  Delete — sure?
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="font-mono text-[10px] uppercase tracking-[0.06em] text-dim hover:text-txt"
                                >
                                  cancel
                                </button>
                              </span>
                            ) : (
                              <button
                                type="button"
                                disabled={pending}
                                onClick={() => setConfirmDeleteId(u.userId)}
                                className="inline-flex items-center gap-1.5 rounded border border-line px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-dim transition-colors hover:border-down/40 hover:text-down disabled:opacity-40"
                              >
                                <IconTrash size={12} />
                                Delete user
                              </button>
                            )
                          )}
                        </div>

                        <p className="flex items-start gap-1.5 font-mono text-[10px] leading-relaxed text-faint">
                          <IconCheckCircle size={12} className="mt-px shrink-0" />
                          Confirm email stamps the account locally; it does not
                          send a new confirmation mail.
                        </p>
                      </div>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Row({
  k,
  v,
  mono = false,
}: {
  k: string;
  v: string;
  mono?: boolean;
}) {
  return (
    <div className="flex gap-3">
      <dt className="w-[110px] shrink-0 uppercase tracking-[0.08em] text-faint">
        {k}
      </dt>
      <dd className={`min-w-0 flex-1 break-words text-sec ${mono ? "" : "font-sans"}`}>
        {v}
      </dd>
    </div>
  );
}
