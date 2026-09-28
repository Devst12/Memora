import { ObjectId } from "mongodb";
import { currentUser } from "@/lib/auth";
import { database } from "@/lib/db";
import { safeText, handleError, jsonError } from "@/lib/http";

export async function GET(_request: Request, context: RouteContext<"/api/saved-items/[id]">) {
  try {
    const user = await currentUser(); if (!user) return jsonError("Sign in required.", 401);
    const { id } = await context.params; if (!ObjectId.isValid(id)) return jsonError("Item not found.", 404);
    const item = await (await database()).collection("saved_items").findOne({ _id: new ObjectId(id), userId: user._id });
    if (!item) return jsonError("Item not found.", 404);
    await (await database()).collection("saved_items").updateOne({ _id: item._id, userId: user._id }, { $set: { lastOpenedAt: new Date(), updatedAt: new Date() } });
    return Response.json({ item: { ...item, id: item._id.toHexString(), _id: undefined, userId: undefined, categoryId: item.categoryId?.toHexString?.() ?? null } });
  } catch (error) { return handleError(error); }
}

export async function PATCH(request: Request, context: RouteContext<"/api/saved-items/[id]">) {
  try {
    const user = await currentUser(); if (!user) return jsonError("Sign in required.", 401);
    const { id } = await context.params; if (!ObjectId.isValid(id)) return jsonError("Item not found.", 404);
    const body = await request.json(), db = await database(), collection = db.collection("saved_items"), now = new Date();
    const existing = await collection.findOne({ _id: new ObjectId(id), userId: user._id }); if (!existing) return jsonError("Item not found.", 404);
    const set: Record<string, unknown> = { updatedAt: now };
    for (const field of ["title", "notes", "reason"] as const) if (field in body) set[field] = safeText(body[field], field === "notes" ? 5000 : 300);
    if ("tags" in body) {
      if (!Array.isArray(body.tags)) return jsonError("Tags must be a list.");
      set.tags = [...new Set(body.tags.map((x: unknown) => safeText(x, 40).replace(/^#/, "").toLowerCase()).filter(Boolean))].slice(0, 12);
    }
    if ("categoryId" in body) {
      const category = ObjectId.isValid(body.categoryId) ? await db.collection("categories").findOne({ _id: new ObjectId(body.categoryId), userId: user._id }) : null;
      if (body.categoryId && !category) return jsonError("Choose one of your categories.");
      set.categoryId = category?._id || null; set.categoryName = category?.name || "";
    }
    if ("status" in body) {
      if (!["unread", "in_progress", "completed", "archived"].includes(body.status)) return jsonError("Choose a valid status.");
      set.status = body.status; set.completedAt = body.status === "completed" ? now : null; set.archivedAt = body.status === "archived" ? now : null;
    }
    if ("reminderAt" in body) {
      const date = body.reminderAt ? new Date(body.reminderAt) : null;
      if (date && (!Number.isFinite(date.getTime()) || date <= now)) return jsonError("Choose a reminder in the future.");
      set.reminderAt = date;
    }
    if (body.opened === true) set.lastOpenedAt = now;
    await collection.updateOne({ _id: new ObjectId(id), userId: user._id }, { $set: set });
    await db.collection("activity").insertOne({ userId: user._id, itemId: new ObjectId(id), type: Object.keys(body).includes("status") ? String(body.status) : "updated", createdAt: now });
    const item = await collection.findOne({ _id: new ObjectId(id), userId: user._id });
    return Response.json({ item: { ...item, id: item?._id.toHexString(), _id: undefined, userId: undefined, categoryId: item?.categoryId?.toHexString?.() ?? null } });
  } catch (error) { return handleError(error); }
}

export async function DELETE(_request: Request, context: RouteContext<"/api/saved-items/[id]">) {
  try {
    const user = await currentUser(); if (!user) return jsonError("Sign in required.", 401);
    const { id } = await context.params; if (!ObjectId.isValid(id)) return jsonError("Item not found.", 404);
    const db = await database(), result = await db.collection("saved_items").deleteOne({ _id: new ObjectId(id), userId: user._id });
    if (!result.deletedCount) return jsonError("Item not found.", 404);
    await db.collection("activity").deleteMany({ userId: user._id, itemId: new ObjectId(id) });
    return Response.json({ ok: true });
  } catch (error) { return handleError(error); }
}
