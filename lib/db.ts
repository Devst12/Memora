import { MongoClient, type Db } from "mongodb";

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error("MONGODB_URI is not configured.");

declare global {
  // eslint-disable-next-line no-var
  var memoraMongo: { client: MongoClient; promise: Promise<MongoClient> } | undefined;
}

const client = new MongoClient(uri);
const cached = global.memoraMongo ??= { client, promise: client.connect() };

export async function database(): Promise<Db> {
  const client = await cached.promise;
  const db = client.db(process.env.MONGODB_DATABASE || "memora");
  await Promise.all([
    db.collection("users").createIndex({ email: 1 }, { unique: true }),
    db.collection("sessions").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection("saved_items").createIndex({ userId: 1, canonicalUrl: 1 }, { unique: true }),
    db.collection("saved_items").createIndex({ userId: 1, savedAt: -1 }),
    db.collection("saved_items").createIndex({ userId: 1, status: 1, savedAt: -1 }),
    db.collection("saved_items").createIndex({ userId: 1, categoryId: 1 }),
    db.collection("saved_items").createIndex({ userId: 1, tags: 1 }),
    db.collection("saved_items").createIndex({ userId: 1, reminderAt: 1 }),
    db.collection("categories").createIndex({ userId: 1, name: 1 }, { unique: true }),
    db.collection("tags").createIndex({ userId: 1, name: 1 }, { unique: true }),
  ]);
  return db;
}
