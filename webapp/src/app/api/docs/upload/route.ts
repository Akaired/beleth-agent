/**
 * Image upload for the documentation editor. Master-admin only (the sole role
 * that can write docs). The file lands in the public `docs-media` bucket
 * (db/migrations/0018) and the public URL is returned for the markdown to embed.
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
  if (!ctx || ctx.role !== "master_admin") {
    return NextResponse.json({ error: "Master-admin only." }, { status: 403 });
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

  const path = `${randomUUID()}.${ext}`;
  const supabase = await createClient();
  const { error } = await supabase.storage
    .from("docs-media")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }

  const { data } = supabase.storage.from("docs-media").getPublicUrl(path);
  return NextResponse.json({ url: data.publicUrl });
}
