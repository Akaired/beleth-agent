/**
 * Image upload for the forum WYSIWYG editor. Authenticated only; the file lands
 * in the public `forum-media` bucket under a folder named with the caller's uid
 * (enforced again by the Storage RLS policy in db/migrations/0010). Returns the
 * public URL for the editor to embed.
 */
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const MAX_BYTES = 5 * 1024 * 1024;
const EXT_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

export async function POST(req: Request) {
  const ctx = await getSessionContext();
  if (!ctx) {
    return NextResponse.json({ error: "Sign in to upload." }, { status: 401 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "Image must be 5 MB or smaller." },
      { status: 413 },
    );
  }
  const ext = EXT_BY_TYPE[file.type];
  if (!ext) {
    return NextResponse.json(
      { error: "PNG, JPEG, GIF or WebP only." },
      { status: 415 },
    );
  }

  const path = `${ctx.userId}/${randomUUID()}.${ext}`;
  const supabase = await createClient();
  const { error } = await supabase.storage
    .from("forum-media")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }

  const { data } = supabase.storage.from("forum-media").getPublicUrl(path);
  return NextResponse.json({ url: data.publicUrl });
}
