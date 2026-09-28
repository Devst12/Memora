import { currentUser } from "@/lib/auth";
import { database } from "@/lib/db";
import { ObjectId } from "mongodb";
import { detectPlatform, fetchMetadata, normalizeUrl } from "@/lib/content";
import { suggestMeta } from "@/lib/auto-tags";
import { handleError, jsonError, safeText } from "@/lib/http";
import { rateLimited } from "@/lib/rate-limit";

// One-shot capture for the floating side button: fetch metadata, infer reason/category/tags, save.
// Explicit fields from the popup form still win when provided; everything else is automatic.
export async function POST(request: Request) {
  try {
    const user = await currentUser(request); if (!user) return jsonError("Extension token is invalid or revoked.", 401);
    // A stolen token can't hammer saves; scope the bucket to the user id, not IP, since extensions come from varied IPs.
    if (await rateLimited(request, `capture:${user._id.toHexString()}`, 60, 60 * 60 * 1000)) return jsonError("Too many saves in one hour. Try again later.", 429);
    const body = await request.json(); let normalized: string;
    try { normalized = normalizeUrl(body.url); } catch { return jsonError("Please enter a valid URL."); }
    const db = await database(), coll = db.collection("saved_items");
    const duplicate = await coll.findOne({ userId: user._id, canonicalUrl: normalized });
    if (duplicate) {
      return Response.json({ duplicate: true, itemId: duplicate._id.toHexString(), title: duplicate.title, platform: duplicate.platform, message: "Already in your memory." }, { status: 409 });
    }
    let metadata: Awaited<ReturnType<typeof fetchMetadata>> = {};
    try { metadata = await fetchMetadata(normalized); } catch { /* URL remains saveable without metadata. */ }
    let canonicalUrl = normalized;
    if (metadata.canonicalUrl) { try { canonicalUrl = normalizeUrl(metadata.canonicalUrl); } catch { /* Ignore invalid canonical metadata. */ } }
    if (canonicalUrl !== normalized) {
      const canonicalDuplicate = await coll.findOne({ userId: user._id, canonicalUrl });
      if (canonicalDuplicate) {
        return Response.json({ duplicate: true, itemId: canonicalDuplicate._id.toHexString(), title: canonicalDuplicate.title, platform: canonicalDuplicate.platform, message: "Already in your memory." }, { status: 409 });
      }
    }
    const platform = detectPlatform(normalized);
    const keywords = Array.isArray(body.keywords) ? body.keywords.map((x: unknown) => safeText(x, 60)).filter(Boolean).slice(0, 12) : [];
    const title = safeText(body.title, 300) || metadata.title || new URL(normalized).hostname;
    // Words the capturer saw in the live tab (title already on screen, visible headings, meta
    // keywords). TikTok-style SPAs hide their real content behind client rendering — these hints
    // recover the context the static fetch can't see. The tab's live title outranks fetched one.
    const pageTitle = safeText(body.pageTitle, 300) || title;
    const categories = (await db.collection("categories").find({ userId: user._id }).project({ name: 1, _id: 0 }).toArray()).map(({ name }) => name);
    const rules = (await db.collection("category_rules").find({ userId: user._id }).sort({ createdAt: 1 }).toArray()).map(({ categoryName, keywords: ruleKeywords }) => ({ categoryName, keywords: Array.isArray(ruleKeywords) ? ruleKeywords : [] }));
    const suggestion = suggestMeta({ url: normalized, title: pageTitle, description: metadata.description, platform, categories, rules, keywords });
    const explicitCategory = ObjectId.isValid(body.categoryId) ? await db.collection("categories").findOne({ _id: new ObjectId(body.categoryId), userId: user._id }) : null;
    if (body.categoryId && ObjectId.isValid(body.categoryId) && !explicitCategory) return jsonError("Choose one of your categories.");
    let category = explicitCategory;
    if (!category && suggestion.categoryName) category = await db.collection("categories").findOne({ userId: user._id, name: suggestion.categoryName });
    const tags = Array.isArray(body.tags) && body.tags.length
      ? [...new Set(body.tags.map((x: unknown) => safeText(x, 40).replace(/^#/, "").toLowerCase()).filter(Boolean))].slice(0, 12)
      : suggestion.tags;
    const now = new Date();
    const item = { userId: user._id, url: normalized, canonicalUrl, platform, contentType: safeText(body.contentType, 30) || "other", title, description: metadata.description || "", thumbnailUrl: metadata.thumbnailUrl || "", authorName: metadata.authorName || "", authorUrl: "", notes: safeText(body.notes, 5000), status: "unread", reason: safeText(body.reason, 50) || suggestion.reason, categoryId: category?._id || null, categoryName: category?.name || "", tags, savedAt: now, updatedAt: now, completedAt: null, archivedAt: null, reminderAt: null, lastOpenedAt: null };
    const result = await coll.insertOne(item);
    await db.collection("activity").insertOne({ userId: user._id, itemId: result.insertedId, type: "saved", createdAt: now });
    await Promise.all(tags.map((name) => db.collection("tags").updateOne({ userId: user._id, name }, { $setOnInsert: { userId: user._id, name, createdAt: now } }, { upsert: true })));
    return Response.json({ itemId: result.insertedId.toHexString(), title: item.title, platform, url: item.url, reason: item.reason, categoryName: item.categoryName, tags: item.tags, thumbnailUrl: item.thumbnailUrl, message: "Saved to your memory." }, { status: 201 });
  } catch (error) { if ((error as { code?: number }).code === 11000) return jsonError("This is already in your memory.", 409); return handleError(error); }
}
