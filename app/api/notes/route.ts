// Create a note from the extension composer (long-press on the floating button).
// Auth: extension token (Bearer) or dashboard session — same rule as capture.
// Storage: images go to imgbb (key stays server-side); every other allowed file
// type (pdf/docs/text) is kept as base64 inside the note document, within the
// 16MB MongoDB document budget — see lib/notes.ts for the exact caps.

import { ObjectId } from "mongodb";
import { rateLimited } from "@/lib/rate-limit";
import { currentUser } from "@/lib/auth";
import { database } from "@/lib/db";
import { handleError, jsonError, safeText } from "@/lib/http";
import { uploadToImgbb } from "@/lib/imgbb";
import { MAX_FILES_B64_TOTAL, MAX_FILE_BYTES, MAX_NOTE_FILES, MAX_TEXT_LENGTH, MAX_TITLE_LENGTH, isAllowedDoc, looksLikeImage, makeFileId, newShareSlug, notesCollection, type NoteDoc } from "@/lib/notes";

export const runtime = "nodejs";
export const maxDuration = 60;

// Early answer to the service-worker preflight (perceived speed beat):
// the token is valid, the save is accepted, uploads finish in the background.
function preflight() {
  return new Response(JSON.stringify({ ok: true, async: true, message: "Uploading attachments…" }), {
    status: 202,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" } });
}

export async function POST(request: Request) {
  const controller = new AbortController();
  // The SW hangs up right after reading the 202 — that's by design, not an error.
  request.signal.addEventListener("abort", () => setTimeout(() => controller.abort(), 300));
  try {
    const user = await currentUser(request);
    if (!user) return jsonError("Extension token is invalid or revoked.", 401);
    if (await rateLimited(request, `notes:${user._id.toHexString()}`, 30, 60 * 60 * 1000)) return jsonError("Too many notes in one hour. Try again later.", 429);

    const form = await request.formData();
    const text = safeText(form.get("text"), MAX_TEXT_LENGTH);
    const title = safeText(form.get("title"), MAX_TITLE_LENGTH);
    const visibility = form.get("visibility") === "private" ? "private" : "public";
    const sourceUrl = safeText(form.get("sourceUrl"), 1000);
    const sourceTitle = safeText(form.get("sourceTitle"), 300);
    if (!text && !(form.get("files") instanceof File)) return jsonError("Add some text or a file to post.");

    const rawFiles = form.getAll("files").filter((f): f is File => f instanceof File);
    if (rawFiles.length > MAX_NOTE_FILES) return jsonError(`Up to ${MAX_NOTE_FILES} files per note.`);
    const files = [];
    let b64Total = 0;
    for (const file of rawFiles) {
      const kind = looksLikeImage(file) ? "image" : "file";
      if (kind === "image") {
        // Preferred path: imgbb hosting. If the host rejects the upload (quota,
        // blocked key, regional block, outage), keep working by storing the
        // bytes in the document like any other file — composer images are
        // compressed under ~1MB client-side, so this fits comfortably.
        try {
          const hosted = await uploadToImgbb(file);
          files.push({ id: makeFileId(), name: safeText(file.name, 200) || "image", type: file.type || "image/webp", size: file.size, kind: "image" as const, url: hosted.url, thumbUrl: hosted.thumbUrl });
        } catch {
          if (file.size > MAX_FILE_BYTES) return jsonError(`"${file.name}" is too large to store (host upload also failed).`);
          const buffer = Buffer.from(await file.arrayBuffer());
          const data = buffer.toString("base64");
          b64Total += data.length;
          if (b64Total > MAX_FILES_B64_TOTAL) return jsonError("These files together are too large for one note.");
          files.push({ id: makeFileId(), name: safeText(file.name, 200) || "image", type: file.type || "image/webp", size: buffer.length, kind: "image" as const, data });
        }
      } else {
        if (!isAllowedDoc(file)) return jsonError(`"${file.name}" isn't a supported file type (pdf, docs, sheets, text).`);
        if (file.size > MAX_FILE_BYTES) return jsonError(`"${file.name}" is too large. Files are capped at 8MB (images are compressed automatically).`);
        const buffer = Buffer.from(await file.arrayBuffer());
        const data = buffer.toString("base64");
        b64Total += data.length;
        if (b64Total > MAX_FILES_B64_TOTAL) return jsonError("These files together are too large for one note (about 8MB of documents max).");
        files.push({ id: makeFileId(), name: safeText(file.name, 200) || "file", type: file.type || "application/octet-stream", size: buffer.length, kind: "file" as const, data });
      }
    }

    const now = new Date();
    const _id = new ObjectId();
    const note: NoteDoc = {
      _id,
      userId: user._id, slug: newShareSlug(), title, text, visibility, files,
      sourceUrl, sourceTitle, createdAt: now, updatedAt: now,
    };
    await notesCollection(await database()).insertOne(note);
    if (controller.signal.aborted) return preflight(); // Client hung up — finish storing anyway.
    return Response.json({ ok: true, id: _id.toHexString(), slug: note.slug, title: note.title || (text ? `${text.slice(0, 60)}…` : "Note"), visibility, shareUrl: `/s/${note.slug}` }, { status: 201, headers: { "Access-Control-Allow-Origin": "*" } });
  } catch (error) {
    if (controller.signal.aborted) return preflight();
    return handleError(error);
  }
}
