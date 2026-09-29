import { after } from "next/server";
import { currentUser } from "@/lib/auth";
import { database } from "@/lib/db";
import { ObjectId } from "mongodb";
import { detectPlatform, fetchMetadata, normalizeUrl } from "@/lib/content";
import { suggestMeta } from "@/lib/auto-tags";
import { handleError, jsonError, safeText } from "@/lib/http";
import { rateLimited } from "@/lib/rate-limit";

// Platform roots (tiktok.com/, youtube.com/, instagram.com/…) aren't a specific video or post —
// they're the feed home. Saving one produces a card the user can never reopen meaningfully, so
// the capture endpoint refuses them; the extension now detects the real item instead.
const PLATFORM_ROOTS = new Set(["youtube.com", "tiktok.com", "douyin.com", "instagram.com", "facebook.com", "reddit.com", "x.com", "twitter.com", "pinterest.com", "linkedin.com"]);
function isPlatformRoot(normalizedUrl: string) {
  try {
    const url = new URL(normalizedUrl);
    return PLATFORM_ROOTS.has(url.hostname.replace(/^www\./, "")) && (url.pathname === "/" || url.pathname === "");
  } catch { return false; }
}

// These platforms are client-rendered enough that a server-side fetch is either blocked, slow,
// or returns a generic shell page. When the extension already sent a real title, skip the fetch
// entirely rather than pay its latency (or its timeout) for data we're about to discard anyway.
const CLIENT_AUTHORITATIVE = new Set(["tiktok.com", "douyin.com", "instagram.com", "facebook.com", "x.com", "twitter.com", "pinterest.com", "reddit.com"]);
function isClientAuthoritative(normalizedUrl: string) {
  try { return CLIENT_AUTHORITATIVE.has(new URL(normalizedUrl).hostname.replace(/^www\./, "")); } catch { return false; }
}

// One-shot capture for the floating side button: save immediately, categorize in the background.
// Explicit fields from the popup form still win when provided; everything else is automatic.
export async function POST(request: Request) {
  try {
    const user = await currentUser(request); if (!user) return jsonError("Extension token is invalid or revoked.", 401);
    // A stolen token can't hammer saves; scope the bucket to the user id, not IP, since extensions come from varied IPs.
    if (await rateLimited(request, `capture:${user._id.toHexString()}`, 60, 60 * 60 * 1000)) return jsonError("Too many saves in one hour. Try again later.", 429);
    const body = await request.json(); let normalized: string;
    try { normalized = normalizeUrl(body.url); } catch { return jsonError("Please enter a valid URL."); }
    if (isPlatformRoot(normalized)) return jsonError("That's the platform's home page, not a specific video. Open a video and save that.");
    const db = await database(), coll = db.collection("saved_items");
    const duplicate = await coll.findOne({ userId: user._id, canonicalUrl: normalized });
    if (duplicate) {
      return Response.json({ duplicate: true, itemId: duplicate._id.toHexString(), title: duplicate.title, platform: duplicate.platform, message: "Already in your memory." }, { status: 409 });
    }

    const hasClientData = Boolean(safeText(body.title, 300) && safeText(body.description, 2000));
    // Skip the network round trip entirely when it would just be discarded — this is most of
    // the delay on TikTok/Douyin/Instagram, where the fetch is slow, blocked, or both.
    let metadata: Awaited<ReturnType<typeof fetchMetadata>> = {};
    if (!(isClientAuthoritative(normalized) && hasClientData)) {
      try { metadata = await fetchMetadata(normalized); } catch { /* URL remains saveable without metadata. */ }
    }
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
    const pageTitle = safeText(body.pageTitle, 300) || title;
    const description = safeText(body.description, 2000) || metadata.description || "";
    const authorName = safeText(body.author, 120) || metadata.authorName || "";
    let thumbnailUrl = metadata.thumbnailUrl || "";
    const clientThumb = safeText(body.thumbnailUrl, 1000);
    if (!thumbnailUrl && /^https:\/\/[^\s]+$/i.test(clientThumb) && !clientThumb.includes("tiktok.com/404")) thumbnailUrl = clientThumb;

    const explicitCategory = ObjectId.isValid(body.categoryId) ? await db.collection("categories").findOne({ _id: new ObjectId(body.categoryId), userId: user._id }) : null;
    if (body.categoryId && ObjectId.isValid(body.categoryId) && !explicitCategory) return jsonError("Choose one of your categories.");
    const explicitTags = Array.isArray(body.tags) && body.tags.length
      ? [...new Set(body.tags.map((x: unknown) => safeText(x, 40).replace(/^#/, "").toLowerCase()).filter(Boolean))].slice(0, 12)
      : null;

    const now = new Date();
    // Insert right away with whatever we already know for certain. When the caller didn't pin a
    // category or tags, those two fields start empty and are filled in after the response below —
    // that's the only part allowed to take its time.
    const item = {
      userId: user._id, url: normalized, canonicalUrl, platform,
      contentType: safeText(body.contentType, 30) || "other",
      title, description, thumbnailUrl, authorName, authorUrl: "",
      notes: safeText(body.notes, 5000), status: "unread",
      reason: safeText(body.reason, 50) || "",
      categoryId: explicitCategory?._id || null, categoryName: explicitCategory?.name || "",
      tags: explicitTags || [],
      savedAt: now, updatedAt: now, completedAt: null, archivedAt: null, reminderAt: null, lastOpenedAt: null,
    };
    const result = await coll.insertOne(item);
    await db.collection("activity").insertOne({ userId: user._id, itemId: result.insertedId, type: "saved", createdAt: now });
    if (explicitTags) {
      await Promise.all(explicitTags.map((name) => db.collection("tags").updateOne({ userId: user._id, name }, { $setOnInsert: { userId: user._id, name, createdAt: now } }, { upsert: true })));
    }

    // Everything below runs after the response has already gone out — the click returns the
    // moment the item exists, and the category/reason/auto-tags fill themselves in right after.
    if (!explicitCategory || !explicitTags) {
      after(async () => {
        try {
          const categories = (await db.collection("categories").find({ userId: user._id }).project({ name: 1, _id: 0 }).toArray()).map(({ name }) => name);
          const rules = (await db.collection("category_rules").find({ userId: user._id }).sort({ createdAt: 1 }).toArray()).map(({ categoryName, keywords: ruleKeywords }) => ({ categoryName, keywords: Array.isArray(ruleKeywords) ? ruleKeywords : [] }));
          const suggestion = suggestMeta({ url: normalized, title: pageTitle, description, platform, categories, rules, keywords });
          const update: Record<string, unknown> = { updatedAt: new Date() };
          if (!explicitCategory && suggestion.categoryName) {
            const category = await db.collection("categories").findOne({ userId: user._id, name: suggestion.categoryName });
            if (category) { update.categoryId = category._id; update.categoryName = category.name; }
          }
          if (!explicitCategory && suggestion.reason) update.reason = suggestion.reason;
          if (!explicitTags && suggestion.tags?.length) {
            update.tags = suggestion.tags;
            await Promise.all(suggestion.tags.map((name: string) => db.collection("tags").updateOne({ userId: user._id, name }, { $setOnInsert: { userId: user._id, name, createdAt: new Date() } }, { upsert: true })));
          }
          if (Object.keys(update).length > 1) await coll.updateOne({ _id: result.insertedId }, { $set: update });
        } catch { /* Best-effort enrichment; the saved item is already safe either way. */ }
      });
    }

    return Response.json({ itemId: result.insertedId.toHexString(), title: item.title, platform, url: item.url, reason: item.reason, categoryName: item.categoryName, tags: item.tags, thumbnailUrl: item.thumbnailUrl, message: "Saved to your memory." }, { status: 201 });
  } catch (error) { if ((error as { code?: number }).code === 11000) return jsonError("This is already in your memory.", 409); return handleError(error); }
}