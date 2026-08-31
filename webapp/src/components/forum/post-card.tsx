"use client";

import { useState, useTransition } from "react";
import { timeAgo, wasEdited } from "@/lib/forum/format";
import type { ForumPost } from "@/lib/forum/types";
import { deletePostAction, editPostAction } from "@/lib/forum/actions";
import { deletePostAction as adminDeletePostAction } from "@/app/dashboard/admin/forum/actions";
import Link from "next/link";
import { AuthorLink } from "@/components/forum/author-link";
import { RichEditor } from "@/components/forum/rich-editor";
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";

/**
 * One post in a thread. Plain-text body (`whitespace-pre-wrap`, no markdown).
 * When `mine` is set the author gets inline Edit and (for replies only) Delete.
 */
export function PostCard({
  post,
  original = false,
  mine = false,
  canModerate = false,
  topicSlug,
}: {
  post: ForumPost;
  original?: boolean;
  mine?: boolean;
  /** Master-admin: may delete this reply even when it is not their own. */
  canModerate?: boolean;
  topicSlug: string;
}) {
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, startDelete] = useTransition();

  function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startSave(async () => {
      const res = await editPostAction({ error: null }, fd);
      if (res?.error) {
        setEditError(res.error);
        return;
      }
      setEditError(null);
      setEditing(false);
    });
  }

  const showAdminDelete = canModerate && !mine && !original;

  function doDelete() {
    startDelete(async () => {
      if (mine) {
        const fd = new FormData();
        fd.set("post_id", post.id);
        fd.set("slug", topicSlug);
        await deletePostAction(fd);
      } else {
        await adminDeletePostAction(post.id, topicSlug);
      }
      setConfirmOpen(false);
    });
  }

  const edited = wasEdited(post.created_at, post.updated_at);

  return (
    <article
      className={`flex gap-3 rounded-md border bg-panel p-4 ${
        original ? "border-emphline" : "border-line"
      }`}
    >
      <AuthorLink authorId={post.author_id} name={post.author_name} size={40} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <Link
            href={`/u/${post.author_id}`}
            className="text-[13px] font-medium text-txt transition-colors hover:text-acc"
          >
            {post.author_name}
          </Link>
          <span className="font-mono text-[10.5px] text-dim">
            {timeAgo(post.created_at)}
            {edited && " · edited"}
          </span>
          {original && (
            <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-acc">
              original post
            </span>
          )}
          {mine && !editing && (
            <span className="ml-auto flex items-center gap-3">
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="text-[11px] text-dim transition-colors hover:text-sec"
              >
                Edit
              </button>
              {!original && (
                <button
                  type="button"
                  onClick={() => setConfirmOpen(true)}
                  className="text-[11px] text-dim transition-colors hover:text-down"
                >
                  Delete
                </button>
              )}
            </span>
          )}
          {showAdminDelete && !editing && (
            <span className="ml-auto flex items-center gap-2">
              <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-faint">
                mod
              </span>
              <button
                type="button"
                onClick={() => setConfirmOpen(true)}
                className="text-[11px] text-dim transition-colors hover:text-down"
              >
                Delete
              </button>
            </span>
          )}
        </div>

        {editing ? (
          <form onSubmit={handleSave} className="mt-2 flex flex-col gap-2">
            <input type="hidden" name="post_id" value={post.id} />
            <input type="hidden" name="slug" value={topicSlug} />
            <RichEditor
              name="body"
              defaultValue={post.body}
              placeholder="Edit your message…"
              minHeight={120}
            />
            {editError && (
              <p className="text-[11.5px] text-down">{editError}</p>
            )}
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={saving}
                className="rounded bg-acc/15 px-3 py-1 text-[11.5px] text-acc transition-colors hover:bg-acc/25 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setEditError(null);
                }}
                className="text-[11.5px] text-sec transition-colors hover:text-txt"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div
            className="forum-prose mt-2 break-words"
            dangerouslySetInnerHTML={{ __html: post.body }}
          />
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Delete reply"
        body="This reply will be permanently removed. This can’t be undone."
        confirmLabel="Delete"
        danger
        busy={deleting}
        onConfirm={doDelete}
        onCancel={() => !deleting && setConfirmOpen(false)}
      />
    </article>
  );
}
