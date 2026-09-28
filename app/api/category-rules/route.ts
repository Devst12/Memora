import { ObjectId } from "mongodb";
import { currentUser } from "@/lib/auth";
import { database } from "@/lib/db";
import { handleError, jsonError, safeText } from "@/lib/http";

type Rule = { id: string; categoryId: string; categoryName: string; keywords: string[] };

// Rules are evaluated in list order, so first match wins; new rules append to the end.
export async function GET(request: Request) {
  try {
    const user = await currentUser(request); if (!user) return jsonError("Sign in required.", 401);
    const rows = await (await database()).collection("category_rules").find({ userId: user._id }).sort({ createdAt: 1 }).toArray();
    const items: Rule[] = rows.map(({ _id, categoryId, categoryName, keywords }) => ({ id: _id.toHexString(), categoryId: categoryId?.toHexString?.() || "", categoryName, keywords: Array.isArray(keywords) ? keywords : [] }));
    return Response.json({ items });
  } catch (error) { return handleError(error); }
}

export async function POST(request: Request) {
  try {
    const user = await currentUser(); if (!user) return jsonError("Sign in required.", 401);
    const body = await request.json();
    const categoryId = typeof body.categoryId === "string" && ObjectId.isValid(body.categoryId) ? body.categoryId : "";
    const keywords = Array.isArray(body.keywords) ? [...new Set(body.keywords.map((x: unknown) => safeText(x, 40).toLowerCase().replace(/^#/, "")).filter(Boolean))].slice(0, 30) : [];
    if (!categoryId || !keywords.length) return jsonError("Pick a category and add at least one keyword.");
    const db = await database();
    const category = await db.collection("categories").findOne({ _id: new ObjectId(categoryId), userId: user._id });
    if (!category) return jsonError("Choose one of your categories.");
    const existing = await db.collection("category_rules").countDocuments({ userId: user._id });
    if (existing >= 50) return jsonError("That's a lot of rules — remove one before adding another.", 400);
    await db.collection("category_rules").insertOne({ userId: user._id, categoryId: category._id, categoryName: category.name, keywords, createdAt: new Date() });
    return Response.json({ ok: true }, { status: 201 });
  } catch (error) { return handleError(error); }
}

export async function DELETE(request: Request) {
  try {
    const user = await currentUser(); if (!user) return jsonError("Sign in required.", 401);
    const id = new URL(request.url).searchParams.get("id");
    if (!id || !ObjectId.isValid(id)) return jsonError("Not found.", 404);
    const result = await (await database()).collection("category_rules").deleteOne({ _id: new ObjectId(id), userId: user._id });
    if (!result.deletedCount) return jsonError("Not found.", 404);
    return Response.json({ ok: true });
  } catch (error) { return handleError(error); }
}
