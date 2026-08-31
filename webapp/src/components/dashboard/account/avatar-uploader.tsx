"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  removeAvatarAction,
  uploadAvatarAction,
} from "@/app/dashboard/settings/account/actions";
import { UserAvatar } from "@/components/user-avatar";
import { IconClose, IconPencil } from "@/components/icons";

const ACCEPT = "image/png,image/jpeg,image/gif,image/webp";
const MAX_BYTES = 2 * 1024 * 1024;

export function AvatarUploader({
  name,
  avatarUrl,
}: {
  name: string;
  avatarUrl: string | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Optimistic preview so the new face shows before the round-trip settles.
  const [preview, setPreview] = useState<string | null>(null);

  const shown = preview ?? avatarUrl;

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError("Image must be 2 MB or smaller.");
      return;
    }
    setError(null);
    const localUrl = URL.createObjectURL(file);
    setPreview(localUrl);

    const fd = new FormData();
    fd.set("file", file);
    startTransition(async () => {
      const res = await uploadAvatarAction(fd);
      URL.revokeObjectURL(localUrl);
      if (!res.ok) {
        setPreview(null);
        setError(res.error);
        return;
      }
      setPreview(null);
      router.refresh();
    });
  }

  function onRemove() {
    setError(null);
    startTransition(async () => {
      const res = await removeAvatarAction();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPreview(null);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-4">
      <div className={pending ? "opacity-60 transition-opacity" : ""}>
        <UserAvatar name={name} avatarUrl={shown} size={72} />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={pending}
            className="flex items-center gap-1.5 rounded border border-inputline bg-inset px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.06em] text-txt transition-colors hover:border-hoverline disabled:opacity-50"
          >
            <IconPencil size={12} />
            {pending ? "Working…" : shown ? "Change" : "Upload"}
          </button>
          {shown && (
            <button
              type="button"
              onClick={onRemove}
              disabled={pending}
              className="flex items-center gap-1.5 rounded border border-line px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.06em] text-sec transition-colors hover:text-down disabled:opacity-50"
            >
              <IconClose size={12} />
              Remove
            </button>
          )}
        </div>
        <p className="font-mono text-[10px] text-dim">
          PNG, JPEG, GIF or WebP · 2 MB max
        </p>
        {error && <p className="text-[11.5px] text-down">{error}</p>}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={onPick}
      />
    </div>
  );
}
