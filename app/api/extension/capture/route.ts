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

// One-shot capture for the floating side button and the phone's share sheet:
// save immediately, enrich in the background. The response goes out the moment
// the item exists — title, thumbnail and tags are pulled from the URL
// afterwards, so sharing from a phone feels instant no matter how slow the
// platform's servers are.
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

    const platform = detectPlatform(normalized);
    const keywords = Array.isArray(body.keywords) ? body.keywords.map((x: unknown) => safeText(x, 60)).filter(Boolean).slice(0, 12) : [];
    const title = safeText(body.title, 300);
    const description = safeText(body.description, 2000);
    const authorName = safeText(body.author, 120);
    let thumbnailUrl = "";
    const clientThumb = safeText(body.thumbnailUrl, 1000);
    if (/^https:\/\/[^\s]+$/i.test(clientThumb) && !clientThumb.includes("tiktok.com/404")) thumbnailUrl = clientThumb;

    const explicitCategory = ObjectId.isValid(body.categoryId) ? await db.collection("categories").findOne({ _id: new ObjectId(body.categoryId), userId: user._id }) : null;
    if (body.categoryId && ObjectId.isValid(body.categoryId) && !explicitCategory) return jsonError("Choose one of your categories.");
    const explicitTags = Array.isArray(body.tags) && body.tags.length
      ? [...new Set(body.tags.map((x: unknown) => safeText(x, 40).replace(/^#/, "").toLowerCase()).filter(Boolean))].slice(0, 12)
      : null;

    const now = new Date();
    // Insert right away with whatever the caller already gave us — no network
    // fetch happens before the response. Whatever the URL can still tell us
    // (real title, thumbnail, description, author, tags) is filled in just
    // after the response below.
    const item = {
      userId: user._id, url: normalized, canonicalUrl: normalized, platform,
      contentType: safeText(body.contentType, 30) || "other",
      title: title || new URL(normalized).hostname, description, thumbnailUrl, authorName, authorUrl: "",
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

    // Background enrichment, running after the response has already gone out.
    // Fetches the page's own metadata (fills only what's missing), re-checks
    // duplicates against the canonical address, then lets the auto-tagger fill
    // category/reason/tags. Best-effort throughout: the save itself is done.
    const needsMetadata = Boolean(!title || !thumbnailUrl || !description);
    const needsSuggestions = !explicitCategory || !explicitTags;
    if (needsMetadata || needsSuggestions) {
      after(async () => {
        try {
          const update: Record<string, unknown> = { updatedAt: new Date() };
          if (needsMetadata) {
            try {
              const metadata = await fetchMetadata(normalized);
              let canonicalUrl = normalized;
              if (metadata.canonicalUrl) { try { canonicalUrl = normalizeUrl(metadata.canonicalUrl); } catch { /* Ignore invalid canonical metadata. */ } }
              if (canonicalUrl !== normalized) {
                const canonicalDuplicate = await coll.findOne({ userId: user._id, canonicalUrl });
                if (canonicalDuplicate) {
                  // The shared short link resolves to a video saved before: keep
                  // one memory. Fold any fresh notes in, drop the copy we just made.
                  const patch: Record<string, unknown> = { updatedAt: new Date() };
                  const freshNotes = safeText(body.notes, 5000);
                  if (freshNotes && !canonicalDuplicate.notes) patch.notes = freshNotes;
                  if (!canonicalDuplicate.thumbnailUrl && item.thumbnailUrl) patch.thumbnailUrl = item.thumbnailUrl;
                  await coll.updateOne({ _id: canonicalDuplicate._id }, { $set: patch });
                  await coll.deleteOne({ _id: result.insertedId });
                  await db.collection("activity").deleteMany({ userId: user._id, itemId: result.insertedId });
                  return;
                }
                await coll.updateOne({ _id: result.insertedId }, { $set: { canonicalUrl, updatedAt: new Date() } });
              }
              if (!title && metadata.title) update.title = metadata.title;
              if (!description && metadata.description) update.description = metadata.description;
              if (!thumbnailUrl && metadata.thumbnailUrl) update.thumbnailUrl = metadata.thumbnailUrl;
              if (!authorName && metadata.authorName) update.authorName = metadata.authorName;
            } catch { /* URL remains saved with the details it arrived with. */ }
          }
          if (needsSuggestions) {
            const categories = (await db.collection("categories").find({ userId: user._id }).project({ name: 1, _id: 0 }).toArray()).map(({ name }) => name);
            const rules = (await db.collection("category_rules").find({ userId: user._id }).sort({ createdAt: 1 }).toArray()).map(({ categoryName, keywords: ruleKeywords }) => ({ categoryName, keywords: Array.isArray(ruleKeywords) ? ruleKeywords : [] }));
            const enrichTitle = String(update.title || item.title);
            const enrichDescription = String(update.description || item.description);
            const suggestion = suggestMeta({ url: normalized, title: enrichTitle, description: enrichDescription, platform, categories, rules, keywords });
            if (!explicitCategory && suggestion.categoryName) {
              const category = await db.collection("categories").findOne({ userId: user._id, name: suggestion.categoryName });
              if (category) { update.categoryId = category._id; update.categoryName = category.name; }
            }
            if (!explicitCategory && suggestion.reason && !item.reason) update.reason = suggestion.reason;
            if (!explicitTags && suggestion.tags?.length) {
              update.tags = suggestion.tags;
              await Promise.all(suggestion.tags.map((name: string) => db.collection("tags").updateOne({ userId: user._id, name }, { $setOnInsert: { userId: user._id, name, createdAt: new Date() } }, { upsert: true })));
            }
          }
          if (Object.keys(update).length > 1) await coll.updateOne({ _id: result.insertedId }, { $set: update });
        } catch { /* Best-effort enrichment; the saved item is already safe either way. */ }
      });
    }

    return Response.json({ itemId: result.insertedId.toHexString(), title: item.title, platform, url: item.url, reason: item.reason, categoryName: item.categoryName, tags: item.tags, thumbnailUrl: item.thumbnailUrl, pending: needsMetadata, message: "Saved to your memory." }, { status: 201 });
  } catch (error) { if ((error as { code?: number }).code === 11000) return jsonError("This is already in your memory.", 409); return handleError(error); }
}
