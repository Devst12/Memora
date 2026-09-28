import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { MongoClient } from "mongodb";

if (process.env.NODE_ENV === "production") throw new Error("Demo seed data cannot be inserted in production.");
const uri = process.env.MONGODB_URI;
const databaseName = process.env.MONGODB_DATABASE || "memora";
const email = process.env.SEED_EMAIL?.trim().toLowerCase();
const password = process.env.SEED_PASSWORD;
if (!uri || !email || !password || password.length < 10) throw new Error("Set MONGODB_URI, SEED_EMAIL, and SEED_PASSWORD (at least 10 characters) in .env.local.");

const client = new MongoClient(uri);
const scrypt = promisify(scryptCallback);
try {
  await client.connect();
  const db = client.db(databaseName), users = db.collection("users");
  let user = await users.findOne({ email });
  if (!user) {
    const salt = randomBytes(16).toString("hex"), key = await scrypt(password, salt, 64);
    const now = new Date();
    const result = await users.insertOne({ name: "Memora Demo", email, passwordHash: `${salt}:${key.toString("hex")}`, createdAt: now, updatedAt: now });
    user = { _id: result.insertedId };
  }
  const userId = user._id, now = Date.now(), items = [
    ["youtube", "Next.js caching explained", "Understand when cached data should update.", "Learn", "Web Development", ["nextjs", "caching"]],
    ["tiktok", "A seamless editing transition", "A transition idea to try in a short video.", "Inspiration", "Video Editing", ["transition", "editing"]],
    ["instagram", "Portfolio layout inspiration", "An expressive portfolio grid and typography treatment.", "Inspiration", "Design", ["portfolio", "layout"]],
    ["reddit", "A useful web development discussion", "Practical notes from a developer community thread.", "Learn", "Web Development", ["community", "frontend"]],
    ["web", "CSS animation guide", "A clear guide to building small, purposeful interface motion.", "Learn", "Design", ["css", "animation"]],
    ["youtube", "Premiere color grading workflow", "A grading reference for the next film edit.", "Use Later", "Video Editing", ["premiere", "colorgrading"]],
  ];
  const categories = ["Web Development", "Video Editing", "Design", "Learning", "Business", "Music", "Ideas", "Personal", "Other"];
  const reasons = ["Learn", "Inspiration", "Watch Later", "Use Later", "Work", "Buy", "Personal", "Other"];
  await Promise.all([
    db.collection("categories").bulkWrite(categories.map((name) => ({ updateOne: { filter: { userId, name }, update: { $setOnInsert: { userId, name, createdAt: new Date() } }, upsert: true } })), { ordered: false }),
    db.collection("reasons").bulkWrite(reasons.map((name) => ({ updateOne: { filter: { userId, name }, update: { $setOnInsert: { userId, name, createdAt: new Date() } }, upsert: true } })), { ordered: false }),
  ]);
  const categoryRows = await db.collection("categories").find({ userId }).toArray(), categoryMap = new Map(categoryRows.map(({ _id, name }) => [name, _id]));
  let inserted = 0;
  for (const [platform, title, description, reason, categoryName, tags] of items) {
    const url = `https://example.com/memora-demo/${platform}/${encodeURIComponent(title.toLowerCase().replaceAll(" ", "-"))}`;
    const result = await db.collection("saved_items").updateOne({ userId, canonicalUrl: url }, { $setOnInsert: { userId, url, canonicalUrl: url, platform, contentType: platform === "youtube" || platform === "tiktok" ? "video" : "article", title, description, thumbnailUrl: "", authorName: "", authorUrl: "", notes: "Development demo data — replace this with your own memory.", status: "unread", reason, categoryId: categoryMap.get(categoryName), categoryName, tags, savedAt: new Date(now - Math.random() * 21 * 86400000), updatedAt: new Date(), completedAt: null, archivedAt: null, reminderAt: null, lastOpenedAt: null, isDemoSeed: true } }, { upsert: true });
    if (result.upsertedCount) inserted++;
    for (const name of tags) await db.collection("tags").updateOne({ userId, name }, { $setOnInsert: { userId, name, createdAt: new Date() } }, { upsert: true });
  }
  console.log(`Inserted ${inserted} demo items for ${email}. They are marked isDemoSeed=true.`);
} finally { await client.close(); }
