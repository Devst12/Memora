// Shared logic for the notes feature (extension composer + public share pages).
// Storage design in one place so both API routes stay dumb:
// - Images -> imgbb.com (free host, IMGBB_API_KEY server-side); DB stores the URLs.
// - Files (PDF/docs) -> raw bytes base64-encoded inside the note document, capped
//   per file. A web host's filesystem (e.g. Vercel) is ephemeral, so files can't
//   be written to disk; MongoDB's 16MB document cap sets the size budget.
// Transport: the note (text) is posted as a small JSON body, then each file is
// uploaded in its own request. Serverless platforms (Vercel) reject bodies over
// ~4.5MB, so one big multipart POST could never carry several images or a large
// document in production — per-file requests keep every body far below the cap.

import type { Collection, Db } from "mongodb";

export const MAX_TEXT_LENGTH = 50_000;
export const MAX_TITLE_LENGTH = 300;
export const MAX_NOTE_FILES = 10;
// Mongo documents cap at 16MB. Base64 inflates bytes ~1.37x, so: 8MB per file,
// and the combined base64 of all files in one note must stay under ~11MB to
// leave headroom for text/metadata inside the document.
// Per-file ceiling. The real production limit is the ~4.5MB request-body cap on
// Vercel — a file bigger than this can never arrive, so the cap is honest here
// (base64 inflates ~1.37x, so 4MB becomes ~5.5MB inside the document).
export const MAX_FILE_BYTES = 4 * 1024 * 1024; // 4MB per file (checked before base64)
export const MAX_FILES_B64_TOTAL = 11 * 1024 * 1024; // combined base64 budget per note

export type StoredFile = {
  id: string;
  name: string;
  type: string;
  size: number;
  kind: "image" | "file";
  url?: string; // images hosted on imgbb
  thumbUrl?: string;
  data?: string; // base64 bytes for non-image files kept in the document
  status?: "uploading" | "ready" | "error"; // uploads finish after the note is created
  at?: string; // ISO time the placeholder was created — detects abandoned uploads
};

export type NoteDoc = {
  _id: import("mongodb").ObjectId;
  userId: import("mongodb").ObjectId;
  slug: string;
  title: string;
  text: string;
  visibility: "public" | "private";
  files: StoredFile[];
  sourceUrl: string;
  sourceTitle: string;
  createdAt: Date;
  updatedAt: Date;
};

export function looksLikeImage(file: { type: string; name: string }) {
  if (/^image\//i.test(file.type || "")) return true;
  return /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(file.name || "");
}

export function looksLikePdf(file: { type: string; name: string }) {
  if (file.type === "application/pdf") return true;
  return /\.pdf$/i.test(file.name || "");
}

// Allowed types for document-kind attachments (pdf/docs/text). Anything else is
// refused — never store arbitrary binary types from anonymous posters.
const DOC_NAME_OK = /\.(txt|md|markdown|rtf|pdf|docx?|xlsx?|pptx?|csv|json)$/i;
const DOC_MIME_OK = /^(text\/(plain|markdown|csv)|application\/(json|rtf|msword|vnd\.openxmlformats-officedocument\.(wordprocessingml|spreadsheetml|presentationml)\.))/i;
export function isAllowedDoc(file: { type: string; name: string }) {
  return looksLikePdf(file) || DOC_NAME_OK.test(file.name || "") || DOC_MIME_OK.test(file.type || "");
}

export function makeFileId() {
  // Short unique per-note file id, safe for URLs.
  return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

export function notesCollection(db: Db): Collection<NoteDoc> {
  return db.collection<NoteDoc>("notes");
}

export function newShareSlug() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Public-safe projection of a note — never leaks file bytes or owner ids.
// Images stored in-document (imgbb fallback) get served through the file route.
// A file stuck in "uploading" for over 10 minutes is dead — its upload was
// abandoned (page closed, serverless job killed). Report it as an error so the
// dashboard stops polling forever and the UI says failed instead of lying.
export const UPLOAD_STALE_MS = 10 * 60 * 1000;

export function serializeNote(note: NoteDoc) {
  const noteId = note._id.toHexString();
  const fileStatus = (f: StoredFile) =>
    f.status === "uploading" && Date.now() - new Date(f.at || note.createdAt).getTime() > UPLOAD_STALE_MS ? "error" : f.status || "ready";
  return {
    id: noteId,
    slug: note.slug || "",
    title: note.title,
    text: note.text,
    visibility: note.visibility,
    files: (note.files || []).map((f) => ({
      id: f.id,
      name: f.name,
      type: f.type,
      size: f.size,
      kind: f.kind,
      status: fileStatus(f),
      url: f.url || (f.data && f.kind === "image" ? `/api/notes/${noteId}/files/${f.id}` : ""),
      thumbUrl: f.thumbUrl || "",
    })),
    sourceUrl: note.sourceUrl || "",
    sourceTitle: note.sourceTitle || "",
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}
