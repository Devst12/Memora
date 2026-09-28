import { ObjectId } from "mongodb";
import { currentUser } from "@/lib/auth";
import { database } from "@/lib/db";
import { detectPlatform, fetchMetadata, normalizeUrl } from "@/lib/content";
import { suggestMeta } from "@/lib/auto-tags";
import { handleError, jsonError, safeText } from "@/lib/http";

export async function GET(request: Request) {
  try {
    const user = await currentUser(); if (!user) return jsonError("Sign in to view your memory.", 401);
    const url = new URL(request.url), q = safeText(url.searchParams.get("q"), 120), platform = safeText(url.searchParams.get("platform"), 30), status = safeText(url.searchParams.get("status"), 30), categoryId = safeText(url.searchParams.get("category"), 30), reason = safeText(url.searchParams.get("reason"), 50), date = safeText(url.searchParams.get("date"), 20), forgotten = url.searchParams.get("forgotten") === "1";
    const page = Math.max(1, Math.min(10000, Number(url.searchParams.get("page")) || 1)), limit = Math.max(1, Math.min(50, Number(url.searchParams.get("limit")) || 20));
    const filter: Record<string, unknown> = { userId: user._id };
    if (platform && platform !== "all") filter.platform = platform;
    if (forgotten) {
      const inactive = new Date(Date.now() - 7 * 86400000);
      filter.status = { $in: ["unread", "in_progress"] };
      filter.savedAt = { $lte: inactive };
      filter.$or = [{ lastOpenedAt: null }, { lastOpenedAt: { $lte: inactive } }];
    } else if (status && status !== "all") filter.status = status;
    if (ObjectId.isValid(categoryId)) filter.categoryId = new ObjectId(categoryId);
    if (reason && reason !== "all") filter.reason = reason;
    const now = new Date(), start = new Date(now); start.setHours(0, 0, 0, 0);
    if (!forgotten) {
      if (date === "today") filter.savedAt = { $gte: start };
      if (date === "yesterday") { const end = new Date(start); end.setMilliseconds(-1); start.setDate(start.getDate() - 1); filter.savedAt = { $gte: start, $lte: end }; }
      if (date === "week") { start.setDate(start.getDate() - 7); filter.savedAt = { $gte: start }; }
      if (date === "month") { start.setDate(1); filter.savedAt = { $gte: start }; }
      if (date === "older") { start.setMonth(start.getMonth() - 1); filter.savedAt = { $lt: start }; }
    }
    if (q) {
      // Strip characters MongoDB $text treats as operators (quotes, backslashes, -exclusions) so odd input can't error the query.
      const terms = q.replace(/["\\]/g, " ").split(/\s+/).map((term) => term.replace(/^-+/, "")).filter(Boolean).slice(0, 8);
      if (terms.length) filter.$text = { $search: terms.join(" ") };
    }
    const db = await database(), coll = db.collection("saved_items");
    const [items, total] = await Promise.all([coll.find(filter).sort({ savedAt: -1 }).skip((page - 1) * limit).limit(limit).toArray(), coll.countDocuments(filter)]);
    return Response.json({ items: items.map(serialize), total, page, pages: Math.ceil(total / limit) });
  } catch (error) { return handleError(error); }
}

export async function POST(request: Request) {
  try {
    const user = await currentUser(); if (!user) return jsonError("Sign in to save to your memory.", 401);
    const body = await request.json();
    let normalized: string;
    try { normalized = normalizeUrl(body.url); } catch { return jsonError("Please enter a valid URL."); }
    const db = await database(), collection = db.collection("saved_items");
    const duplicate = await collection.findOne({ userId: user._id, canonicalUrl: normalized });
    if (duplicate) return Response.json({ duplicate: true, item: serialize(duplicate), message: "This is already in your memory." }, { status: 409 });
    let metadata: Awaited<ReturnType<typeof fetchMetadata>> = {};
    try { metadata = await fetchMetadata(normalized); } catch { /* Link remains saveable when a site has no public metadata. */ }
    let canonicalUrl = normalized;
    if (metadata.canonicalUrl) { try { canonicalUrl = normalizeUrl(metadata.canonicalUrl); } catch { /* Ignore invalid canonical metadata. */ } }
    const canonicalDuplicate = canonicalUrl !== normalized && await collection.findOne({ userId: user._id, canonicalUrl });
    if (canonicalDuplicate) return Response.json({ duplicate: true, item: serialize(canonicalDuplicate), message: "This is already in your memory." }, { status: 409 });
    const categoryId = ObjectId.isValid(body.categoryId) ? new ObjectId(body.categoryId) : null;
    let category = categoryId ? await db.collection("categories").findOne({ _id: categoryId, userId: user._id }) : null;
    if (categoryId && !category) return jsonError("Choose one of your categories.");
    const tags = Array.isArray(body.tags) ? [...new Set(body.tags.map((x: unknown) => safeText(x, 40).replace(/^#/, "").toLowerCase()).filter(Boolean))].slice(0, 12) : [];
    // No explicit category? Fall back to the same rule engine the extension uses, so a link gets
    // the same category however it was saved.
    if (!category) {
      const rules = await db.collection("category_rules").find({ userId: user._id }).sort({ createdAt: 1 }).toArray();
      if (rules.length) {
        const suggestion = suggestMeta({ url: normalized, title: safeText(body.title, 300) || metadata.title || "", description: metadata.description, rules: rules.map(({ categoryName, keywords }) => ({ categoryName, keywords: Array.isArray(keywords) ? keywords : [] })) });
        if (suggestion.categoryName) category = await db.collection("categories").findOne({ userId: user._id, name: suggestion.categoryName });
      }
    }
    const now = new Date();
    const reminderAt = body.reminderAt ? new Date(body.reminderAt) : null;
    if (reminderAt && (!Number.isFinite(reminderAt.getTime()) || reminderAt <= now)) return jsonError("Choose a reminder in the future.");
    const item = { userId: user._id, url: normalized, canonicalUrl, platform: detectPlatform(normalized), contentType: safeText(body.contentType, 30) || "other", title: safeText(body.title, 300) || metadata.title || new URL(normalized).hostname, description: metadata.description || "", thumbnailUrl: metadata.thumbnailUrl || "", authorName: metadata.authorName || "", authorUrl: "", notes: safeText(body.notes, 5000), status: "unread", reason: safeText(body.reason, 50) || "", categoryId: category?._id || null, categoryName: category?.name || "", tags, savedAt: now, updatedAt: now, completedAt: null, archivedAt: null, reminderAt, lastOpenedAt: null };
    const result = await collection.insertOne(item);
    await db.collection("activity").insertOne({ userId: user._id, itemId: result.insertedId, type: "saved", createdAt: now });
    await Promise.all(tags.map((name) => db.collection("tags").updateOne({ userId: user._id, name }, { $setOnInsert: { userId: user._id, name, createdAt: now } }, { upsert: true })));
    return Response.json({ item: serialize({ ...item, _id: result.insertedId }) }, { status: 201 });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return jsonError("This is already in your memory.", 409);
    return handleError(error);
  }
}

function serialize(item: { _id: ObjectId; categoryId?: ObjectId | null; [key: string]: unknown }) {
  return { ...item, id: item._id?.toHexString?.(), _id: undefined, userId: undefined, categoryId: item.categoryId?.toHexString?.() ?? null };
}
