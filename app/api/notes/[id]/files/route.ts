// One attachment per request. The extension posts the note text first (a tiny
// JSON body), then streams each file here separately. One file per request
// keeps every body far under the ~4.5MB serverless request cap — a single
// multipart POST carrying all files could never do that in production, which
// is why attachments (and, when one bad file aborted the whole request, even
// the note's text) silently failed before.
//
// Auth: owner only (extension Bearer token or dashboard session). The uploaded
// file replaces the placeholder the note was created with (matched by index),
// so polls and file serving keep a stable id. Images go to imgbb with an
// in-database fallback; documents store as base64 within the note's combined
// budget — the same storage rules as lib/notes.ts. Responses carry CORS so
// the extension can call this from any page.

import { ObjectId } from "mongodb";
import { currentUser } from "@/lib/auth";
import { database } from "@/lib/db";
import { rateLimited } from "@/lib/rate-limit";
import { uploadToImgbb } from "@/lib/imgbb";
import { MAX_FILES_B64_TOTAL, MAX_FILE_BYTES, MAX_NOTE_FILES, isAllowedDoc, looksLikeImage, notesCollection, serializeNote, type NoteDoc, type StoredFile } from "@/lib/notes";

export const runtime = "nodejs";
export const maxDuration = 60;

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" };

// CORS-aware JSON helpers: every answer — success or error — must reach the
// extension's page context, or the browser hides it as a network failure.
function answer(payload: Record<string, unknown>, status = 200) {
  return Response.json(payload, { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
function fail(error: string, status = 400) {
  return answer({ error }, status);
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function POST(request: Request, context: RouteContext<"/api/notes/[id]/files">) {
  try {
    const user = await currentUser(request);
    if (!user) return fail("Extension token is invalid or revoked.", 401);
    if (await rateLimited(request, `note-files:${user._id.toHexString()}`, 300, 60 * 60 * 1000)) return fail("Too many uploads in one hour. Try again later.", 429);

    const { id } = await context.params;
    if (!ObjectId.isValid(id)) return fail("Note not found.", 404);

    const form = await request.formData();
    const raw = form.get("file");
    if (!(raw instanceof File)) return fail("No file in the request.");
    const index = Number(form.get("index"));
    if (!Number.isInteger(index) || index < 0 || index >= MAX_NOTE_FILES) return fail("Bad file index.");

    const coll = notesCollection(await database());
    const note = await coll.findOne({ _id: new ObjectId(id), userId: user._id });
    if (!note) return fail("Note not found.", 404);
    if (!Array.isArray(note.files) || !note.files[index]) return fail("This note isn't expecting that file.");

    const kind = looksLikeImage(raw) ? "image" as const : "file" as const;
    const placeholder = note.files[index];
    // Keep the placeholder's id stable: polls and /files/[fileId] URLs keep matching.
    const file: StoredFile = {
      id: placeholder.id,
      name: (raw.name || "").slice(0, 200) || placeholder.name || (kind === "image" ? "image" : "file"),
      type: raw.type || placeholder.type || (kind === "image" ? "image/webp" : "application/octet-stream"),
      size: raw.size,
      kind,
      status: "uploading",
    };

    let final: StoredFile;
    if (kind === "image") {
      try {
        const hosted = await uploadToImgbb(raw);
        final = { ...file, url: hosted.url, thumbUrl: hosted.thumbUrl, status: "ready" };
      } catch { /* Host unavailable or refusing — keep the image by storing it here. */ final = await storeInDocument(note, file, raw); }
    } else {
      if (!isAllowedDoc(raw)) final = { ...file, status: "error" };
      else if (raw.size > MAX_FILE_BYTES) final = { ...file, status: "error" };
      else final = await storeInDocument(note, file, raw);
    }

    const result = await coll.updateOne({ _id: note._id, userId: user._id }, { $set: { [`files.${index}`]: final, updatedAt: new Date() } });
    if (!result.matchedCount) return fail("Note not found.", 404);

    const updated: NoteDoc = { ...note, files: note.files.map((existing, at) => (at === index ? final : existing)) };
    return answer({ ok: true, file: serializeNote(updated).files[index] });
  } catch {
    return fail("Upload failed — check your connection and retry.", 500);
  }
}

// Store the raw bytes base64-encoded inside the note document, guarded by the
// note's combined budget (the 16MB MongoDB document cap is the real ceiling).
async function storeInDocument(note: NoteDoc, file: StoredFile, raw: File): Promise<StoredFile> {
  const buffer = Buffer.from(await raw.arrayBuffer());
  const data = buffer.toString("base64");
  const used = (note.files || []).reduce((sum, f) => sum + (typeof f.data === "string" ? f.data.length : 0), 0);
  if (used + data.length > MAX_FILES_B64_TOTAL) return { ...file, status: "error" };
  return { ...file, data, size: buffer.length, status: "ready" };
}
