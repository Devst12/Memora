import { ObjectId } from "mongodb";
import { currentUser } from "@/lib/auth";
import { database } from "@/lib/db";
import { jsonError, handleError } from "@/lib/http";
import { notesCollection } from "@/lib/notes";

export const runtime = "nodejs";

// Serve a file attached to a note. Public notes: anyone with the link may view
// or download the attachment. Private notes: only the owner (session or their
// extension token) can fetch the bytes at all.
export async function GET(request: Request, context: RouteContext<"/api/notes/[id]/files/[fileId]">) {
  try {
    const { id, fileId } = await context.params;
    if (!ObjectId.isValid(id)) return jsonError("Note not found.", 404);
    const note = await notesCollection(await database()).findOne({ _id: new ObjectId(id) });
    if (!note) return jsonError("Note not found.", 404);
    if (note.visibility !== "public") {
      const viewer = await currentUser(request);
      if (!viewer || !viewer._id.equals(note.userId)) return jsonError("This note is private.", 403);
    }
    const file = (note.files || []).find((f) => f.id === fileId);
    if (!file) return jsonError("File not found.", 404);
    if (!file.data) return jsonError("This file has no stored content.", 404);
    const bytes = Buffer.from(file.data, "base64");
    const download = new URL(request.url).searchParams.get("download") === "1";
    const asciiName = (file.name || "file").replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
    const headers = new Headers({
      "Content-Type": file.type || "application/octet-stream",
      "Content-Length": String(bytes.length),
      // Never let a user-uploaded document render on our origin (no HTML/SVG XSS).
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.name || "file")}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=31536000, immutable",
      "Access-Control-Allow-Origin": "*",
    });
    return new Response(new Uint8Array(bytes), { headers });
  } catch (error) { return handleError(error); }
}
