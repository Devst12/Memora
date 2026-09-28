import { MongoClient, type Db } from "mongodb";

declare global {
  var memoraMongo: { uri: string; promise: Promise<MongoClient>; indexes?: Promise<void> } | undefined;
}

export async function database(): Promise<Db> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not configured. Copy .env.example to .env.local and add your MongoDB connection string.");
  let cache = global.memoraMongo;
  if (!cache || cache.uri !== uri) {
    const client = new MongoClient(uri);
    cache = { uri, promise: client.connect() };
    global.memoraMongo = cache;
  }
  const db = (await cache.promise).db(process.env.MONGODB_DATABASE || "memora");
  cache.indexes ??= Promise.all([
    db.collection("users").createIndex({ email: 1 }, { unique: true }),
    db.collection("sessions").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection("rate_limits").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection("saved_items").createIndex({ userId: 1, canonicalUrl: 1 }, { unique: true }),
    db.collection("saved_items").createIndex({ userId: 1, savedAt: -1 }),
    db.collection("saved_items").createIndex({ userId: 1, status: 1, savedAt: -1 }),
    db.collection("saved_items").createIndex({ userId: 1, categoryId: 1 }),
    db.collection("saved_items").createIndex({ userId: 1, tags: 1 }),
    db.collection("saved_items").createIndex({ userId: 1, reminderAt: 1 }),
    db.collection("saved_items").createIndex({ userId: 1, title: "text", description: "text", notes: "text", tags: "text", platform: "text", authorName: "text", categoryName: "text", reason: "text" }, { name: "memory_search" }),
    db.collection("categories").createIndex({ userId: 1, name: 1 }, { unique: true }),
    db.collection("tags").createIndex({ userId: 1, name: 1 }, { unique: true }),
    db.collection("reasons").createIndex({ userId: 1, name: 1 }, { unique: true }),
  ]).then(() => undefined);
  await cache.indexes;
  return db;
}
