// Create a note from the extension composer (long-press on the floating button).
// Auth: extension token (Bearer) or dashboard session — same rule as capture.
// Speed model: the note document (text, title, visibility, slug) is inserted
// immediately with attachment placeholders, and the 202 response carries the
// real id + slug. Attachments upload afterwards — one file per request to
// /api/notes/[id]/files from the current extension, or server-side via after()
// for the legacy multipart form — and file entries flip to ready as each
// finishes. The CORS headers let the extension poll until everything shows as
// uploaded.

import { ObjectId } from "mongodb";
import { after } from "next/server";
import { rateLimited } from "@/lib/rate-limit";
import { currentUser } from "@/lib/auth";
import { database } from "@/lib/db";
import { handleError, jsonError, safeText } from "@/lib/http";
import { uploadToImgbb } from "@/lib/imgbb";
import { MAX_FILES_B64_TOTAL, MAX_FILE_BYTES, MAX_NOTE_FILES, MAX_TEXT_LENGTH, MAX_TITLE_LENGTH, isAllowedDoc, looksLikeImage, makeFileId, newShareSlug, notesCollection, serializeNote, type NoteDoc, type StoredFile } from "@/lib/notes";

export const runtime = "nodejs";
export const maxDuration = 60;

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" };

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

// Owner's note list for the dashboard's Notes tab — newest first, never
// includes file bytes; each file carries its upload status.
export async function GET(request: Request) {
  try {
    const user = await currentUser(request);
    if (!user) return jsonError("Sign in required.", 401);
    const params = new URL(request.url).searchParams;
    const limit = Math.min(100, Math.max(1, Number(params.get("limit")) || 50));
    const notes = await notesCollection(await database()).find({ userId: user._id }).sort({ createdAt: -1 }).limit(limit).toArray();
    return Response.json({ notes: notes.map(serializeNote) });
  } catch (error) { return handleError(error); }
}

export async function POST(request: Request) {
  try {
    const user = await currentUser(request);
    if (!user) return jsonError("Extension token is invalid or revoked.", 401);
    if (await rateLimited(request, `notes:${user._id.toHexString()}`, 30, 60 * 60 * 1000)) return jsonError("Too many notes in one hour. Try again later.", 429);

    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) return createFromMultipart(request, user);
    return createFromJson(request, user);
  } catch (error) { return handleError(error); }
}

// Current flow: a small JSON body creates the note instantly — text, title,
// visibility and a manifest of the files that are about to arrive. The body
// stays tiny no matter how many attachments are queued, so the serverless
// request-size cap can never fail the text the way the old single-multipart
// POST did. Each file then arrives separately at /api/notes/[id]/files.
async function createFromJson(request: Request, user: NonNullable<Awaited<ReturnType<typeof currentUser>>>) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return jsonError("Invalid request body.");
  const text = safeText(body.text, MAX_TEXT_LENGTH);
  const title = safeText(body.title, MAX_TITLE_LENGTH);
  const visibility = body.visibility === "private" ? "private" : "public";
  const sourceUrl = safeText(body.sourceUrl, 1000);
  const sourceTitle = safeText(body.sourceTitle, 300);
  const manifest = (Array.isArray(body?.files) ? (body.files as unknown[]) : [])
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .slice(0, MAX_NOTE_FILES);
  if (!text && !manifest.length) return jsonError("Add some text or a file to post.");

  const now = new Date();
  const files: StoredFile[] = manifest.map((item) => {
    const name = safeText(item.name, 200) || "file";
    const kind = looksLikeImage({ type: String(item.type || ""), name }) ? "image" as const : "file" as const;
    return {
      id: makeFileId(),
      name,
      type: safeText(item.type, 100) || (kind === "image" ? "image/webp" : "application/octet-stream"),
      size: Math.max(0, Number(item.size) || 0),
      kind,
      status: "uploading" as const,
      at: now.toISOString(),
    };
  });

  const _id = new ObjectId();
  const note: NoteDoc = {
    _id,
    userId: user._id, slug: newShareSlug(), title, text, visibility, files,
    sourceUrl, sourceTitle, createdAt: now, updatedAt: now,
  };
  await notesCollection(await database()).insertOne(note);

  return Response.json({
    ok: true, async: true, id: _id.toHexString(), slug: note.slug,
    title: note.title || (text ? `${text.slice(0, 60)}…` : "Note"),
    visibility, shareUrl: `/s/${note.slug}`,
    files: files.map((f) => ({ id: f.id, name: f.name, status: f.status })),
  }, { status: 202, headers: { ...CORS, "Content-Type": "application/json" } });
}

// Legacy flow (extensions before the per-file upload): one multipart POST with
// every attachment inside. Kept working so already-deployed extensions keep
// posting; each file uploads afterwards on the server via after().
async function createFromMultipart(request: Request, user: NonNullable<Awaited<ReturnType<typeof currentUser>>>) {
  const form = await request.formData();
  const text = safeText(form.get("text"), MAX_TEXT_LENGTH);
  const title = safeText(form.get("title"), MAX_TITLE_LENGTH);
  const visibility = form.get("visibility") === "private" ? "private" : "public";
  const sourceUrl = safeText(form.get("sourceUrl"), 1000);
  const sourceTitle = safeText(form.get("sourceTitle"), 300);
  if (!text && !form.getAll("files").some((f) => f instanceof File)) return jsonError("Add some text or a file to post.");

  // Up to 10 attachments; every non-image type must be on the allowlist.
  const rawFiles = form.getAll("files").filter((f): f is File => f instanceof File);
  if (rawFiles.length > MAX_NOTE_FILES) return jsonError(`Up to ${MAX_NOTE_FILES} files per note.`);
  const now = new Date();
  const files: StoredFile[] = rawFiles.map((file) => ({
    id: makeFileId(),
    name: safeText(file.name, 200) || (looksLikeImage(file) ? "image" : "file"),
    type: file.type || (looksLikeImage(file) ? "image/webp" : "application/octet-stream"),
    size: file.size,
    kind: looksLikeImage(file) ? "image" as const : "file" as const,
    status: "uploading" as const,
    at: now.toISOString(),
  }));

  // The note exists NOW with its permanent id + slug; attachments stream in after.
  const _id = new ObjectId();
  const note: NoteDoc = {
    _id,
    userId: user._id, slug: newShareSlug(), title, text, visibility, files,
    sourceUrl, sourceTitle, createdAt: now, updatedAt: now,
  };
  await notesCollection(await database()).insertOne(note);

  // Uploads happen after the response has already gone out. Each file updates
  // itself in place: images land on imgbb (falling back to in-database bytes
  // if the host refuses), documents store as base64 inside the document
  // within the 16MB MongoDB budget — see lib/notes.ts for the exact caps.
  if (files.length) {
    after(async () => {
      const coll = notesCollection(await database());
      let b64Total = 0;
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const raw = rawFiles[index];
        try {
          if (file.kind === "image") {
            try {
              const hosted = await uploadToImgbb(raw);
              const ready: StoredFile = { ...file, url: hosted.url, thumbUrl: hosted.thumbUrl, status: "ready" };
              await coll.updateOne({ _id }, { $set: { [`files.${index}`]: ready, updatedAt: new Date() } });
              continue;
            } catch { /* Host unavailable — keep the image by storing it here. */ }
            if (raw.size > MAX_FILE_BYTES) { await markFileError(coll, _id, index); continue; }
          } else {
            if (!isAllowedDoc(raw) || raw.size > MAX_FILE_BYTES) { await markFileError(coll, _id, index); continue; }
          }
          const buffer = Buffer.from(await raw.arrayBuffer());
          const data = buffer.toString("base64");
          if (b64Total + data.length > MAX_FILES_B64_TOTAL) { await markFileError(coll, _id, index); continue; }
          b64Total += data.length;
          await coll.updateOne({ _id }, { $set: { [`files.${index}`]: { ...file, data, size: buffer.length, status: "ready" }, updatedAt: new Date() } });
        } catch {
          await markFileError(coll, _id, index).catch(() => {});
        }
      }
    });
  }

  return Response.json({ ok: true, async: true, id: _id.toHexString(), slug: note.slug, title: note.title || (text ? `${text.slice(0, 60)}…` : "Note"), visibility, shareUrl: `/s/${note.slug}` }, { status: 202, headers: { ...CORS, "Content-Type": "application/json" } });
}

async function markFileError(coll: ReturnType<typeof notesCollection>, _id: ObjectId, index: number) {
  await coll.updateOne({ _id }, { $set: { [`files.${index}.status`]: "error", updatedAt: new Date() } });
}
