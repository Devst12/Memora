import { ObjectId } from "mongodb";
import { currentUser } from "@/lib/auth";
import { database } from "@/lib/db";
import { jsonError, handleError } from "@/lib/http";

export const runtime = "nodejs";

// Bulk delete for the memory list's selection mode. Same safety rules as the
// single DELETE in /api/saved-items/[id]: owner-scoped, and each deletion also
// clears that item's activity trail. Accepts plain string ids — ids that are
// malformed or simply not yours are skipped silently rather than failing the
// whole batch.
export async function POST(request: Request) {
  try {
    const user = await currentUser();
    if (!user) return jsonError("Sign in required.", 401);
    const body = await request.json().catch(() => null);
    if (!Array.isArray(body?.ids) || !body.ids.length) return jsonError("Select at least one memory to delete.");
    if (body.ids.length > 500) return jsonError("Delete in batches of up to 500 at a time.");
    const seen = new Set<string>();
    const valid: ObjectId[] = [];
    for (const raw of body.ids) {
      if (typeof raw !== "string" || !ObjectId.isValid(raw) || seen.has(raw)) continue;
      seen.add(raw);
      valid.push(new ObjectId(raw));
    }
    if (!valid.length) return jsonError("No valid items in that selection.");
    const db = await database();
    const result = await db.collection("saved_items").deleteMany({ _id: { $in: valid }, userId: user._id });
    if (result.deletedCount) {
      await db.collection("activity").deleteMany({ userId: user._id, itemId: { $in: valid } });
    }
    return Response.json({ ok: true, deleted: result.deletedCount });
  } catch (error) { return handleError(error); }
}
