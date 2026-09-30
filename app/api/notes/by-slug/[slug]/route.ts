import { database } from "@/lib/db";
import { jsonError, handleError } from "@/lib/http";
import { notesCollection, serializeNote } from "@/lib/notes";

export const runtime = "nodejs";

// Resolve a share slug to the canonical note id so client components on the
// public share page can build file links without scraping them out of URLs.
export async function GET(_request: Request, context: RouteContext<"/api/notes/by-slug/[slug]">) {
  try {
    const { slug } = await context.params;
    if (!slug || !/^[0-9a-f]{24}$/.test(slug)) return jsonError("Note not found.", 404);
    const note = await notesCollection(await database()).findOne({ slug });
    if (!note || note.visibility !== "public") return jsonError("Note not found.", 404);
    return Response.json({ note: serializeNote(note) });
  } catch (error) { return handleError(error); }
}
