import { ObjectId } from "mongodb";
import { currentUser } from "@/lib/auth";
import { database } from "@/lib/db";
import { jsonError, handleError, safeText } from "@/lib/http";
import { MAX_TITLE_LENGTH, notesCollection, serializeNote } from "@/lib/notes";

export const runtime = "nodejs";

// The extension's share card flips visibility from any page, so these
// responses must carry CORS headers or the browser blocks the answer.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, PATCH, DELETE, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" };

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

// Public/private read. Anonymous users only see public notes; the owner (via
// dashboard session or their extension token) can read either — and private
// notes only exist at this URL for them.
export async function GET(request: Request, context: RouteContext<"/api/notes/[id]">) {
  try {
    const { id } = await context.params;
    if (!ObjectId.isValid(id)) return jsonError("Note not found.", 404);
    const note = await notesCollection(await database()).findOne({ _id: new ObjectId(id) });
    if (!note) return jsonError("Note not found.", 404);
    let isOwner = false;
    if (note.visibility !== "public") {
      const viewer = await currentUser(request);
      if (!viewer) return jsonError("This note is private.", 403);
      if (!viewer._id.equals(note.userId)) return jsonError("This note is private.", 403);
      isOwner = true;
    } else {
      const viewer = await currentUser(request).catch(() => null);
      isOwner = Boolean(viewer && viewer._id.equals(note.userId));
    }
    return Response.json({ note: serializeNote(note), isOwner, shareUrl: `/s/${note.slug}` }, { headers: CORS });
  } catch (error) { return handleError(error); }
}

export async function PATCH(request: Request, context: RouteContext<"/api/notes/[id]">) {
  try {
    const user = await currentUser(request);
    if (!user) return jsonError("Sign in required.", 401);
    const { id } = await context.params;
    if (!ObjectId.isValid(id)) return jsonError("Note not found.", 404);
    const body = await request.json().catch(() => ({}));
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if ("title" in body) set.title = safeText(body.title, MAX_TITLE_LENGTH);
    if ("visibility" in body) {
      if (body.visibility !== "public" && body.visibility !== "private") return jsonError("Visibility must be public or private.");
      set.visibility = body.visibility;
    }
    if (Object.keys(set).length === 1) return jsonError("Nothing to update.");
    const result = await notesCollection(await database()).updateOne({ _id: new ObjectId(id), userId: user._id }, { $set: set });
    if (!result.matchedCount) return jsonError("Note not found.", 404);
    return Response.json({ ok: true }, { headers: CORS });
  } catch (error) { return handleError(error); }
}

export async function DELETE(request: Request, context: RouteContext<"/api/notes/[id]">) {
  try {
    const user = await currentUser(request);
    if (!user) return jsonError("Sign in required.", 401);
    const { id } = await context.params;
    if (!ObjectId.isValid(id)) return jsonError("Note not found.", 404);
    const result = await notesCollection(await database()).deleteOne({ _id: new ObjectId(id), userId: user._id });
    if (!result.deletedCount) return jsonError("Note not found.", 404);
    return Response.json({ ok: true });
  } catch (error) { return handleError(error); }
}
