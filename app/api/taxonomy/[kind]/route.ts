import { ObjectId } from "mongodb";
import { currentUser } from "@/lib/auth";
import { database } from "@/lib/db";
import { jsonError, safeText, handleError } from "@/lib/http";

function kindCollection(kind: string) { return kind === "categories" || kind === "tags" || kind === "reasons" ? kind : null; }

export async function GET(request: Request, context: RouteContext<"/api/taxonomy/[kind]">) {
  try {
    const user = await currentUser(request); if (!user) return jsonError("Sign in required.", 401);
    const { kind } = await context.params, collection = kindCollection(kind); if (!collection) return jsonError("Not found.", 404);
    const rows = await (await database()).collection(collection).find({ userId: user._id }).sort({ name: 1 }).toArray();
    return Response.json({ items: rows.map(({ _id, name }) => ({ id: _id.toHexString(), name })) });
  } catch (error) { return handleError(error); }
}

export async function POST(request: Request, context: RouteContext<"/api/taxonomy/[kind]">) {
  try {
    const user = await currentUser(); if (!user) return jsonError("Sign in required.", 401);
    const { kind } = await context.params, collection = kindCollection(kind); if (!collection) return jsonError("Not found.", 404);
    const name = safeText((await request.json()).name, 80); if (!name) return jsonError("Enter a name.");
    const db = await database();
    const result = await db.collection(collection).updateOne({ userId: user._id, name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" } }, { $setOnInsert: { userId: user._id, name, createdAt: new Date() } }, { upsert: true });
    const item = await db.collection(collection).findOne({ userId: user._id, name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" } });
    return Response.json({ item: { id: item?._id.toHexString(), name: item?.name } }, { status: result.upsertedCount ? 201 : 200 });
  } catch (error) { if ((error as { code?: number }).code === 11000) return jsonError("That name already exists.", 409); return handleError(error); }
}

export async function PATCH(request: Request, context: RouteContext<"/api/taxonomy/[kind]">) {
  try {
    const user = await currentUser(); if (!user) return jsonError("Sign in required.", 401);
    const { kind } = await context.params, collection = kindCollection(kind); if (!collection) return jsonError("Not found.", 404);
    const body = await request.json(); if (!ObjectId.isValid(body.id)) return jsonError("Not found.", 404);
    const name = safeText(body.name, 80); if (!name) return jsonError("Enter a name.");
    const db = await database(), id = new ObjectId(body.id);
    const existing = await db.collection(collection).findOne({ _id: id, userId: user._id });
    if (!existing) return jsonError("Not found.", 404);
    const result = await db.collection(collection).updateOne({ _id: id, userId: user._id }, { $set: { name, updatedAt: new Date() } });
    if (!result.matchedCount) return jsonError("Not found.", 404);
    if (collection === "categories") await db.collection("saved_items").updateMany({ userId: user._id, categoryId: id }, { $set: { categoryName: name } });
    if (collection === "reasons") await db.collection("saved_items").updateMany({ userId: user._id, reason: existing.name }, { $set: { reason: name } });
    return Response.json({ ok: true });
  } catch (error) { if ((error as { code?: number }).code === 11000) return jsonError("That name already exists.", 409); return handleError(error); }
}

export async function DELETE(request: Request, context: RouteContext<"/api/taxonomy/[kind]">) {
  try {
    const user = await currentUser(); if (!user) return jsonError("Sign in required.", 401);
    const { kind } = await context.params, collection = kindCollection(kind); if (!collection) return jsonError("Not found.", 404);
    const idValue = new URL(request.url).searchParams.get("id"); if (!idValue || !ObjectId.isValid(idValue)) return jsonError("Not found.", 404);
    const db = await database(), id = new ObjectId(idValue);
    const tag = collection === "tags" ? await db.collection(collection).findOne({ _id: id, userId: user._id }) : null;
    const result = await db.collection(collection).deleteOne({ _id: id, userId: user._id });
    if (!result.deletedCount) return jsonError("Not found.", 404);
    if (collection === "categories") await db.collection("saved_items").updateMany({ userId: user._id, categoryId: id }, { $set: { categoryId: null, categoryName: "" } });
    if (collection === "tags") {
      if (tag) await db.collection("saved_items").updateMany({ userId: user._id }, { $pull: { tags: tag.name } });
    }
    return Response.json({ ok: true });
  } catch (error) { return handleError(error); }
}
