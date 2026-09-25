export const DEFAULT_REASONS = ["Learn", "Inspiration", "Watch Later", "Use Later", "Work", "Buy", "Personal", "Other"];
export const DEFAULT_CATEGORIES = ["Web Development", "Video Editing", "Design", "Learning", "Business", "Music", "Ideas", "Personal", "Other"];

export async function seedDefaults(db: import("mongodb").Db, userId: import("mongodb").ObjectId) {
  const now = new Date();
  await Promise.all([
    db.collection("reasons").bulkWrite(DEFAULT_REASONS.map((name) => ({ updateOne: { filter: { userId, name }, update: { $setOnInsert: { userId, name, createdAt: now } }, upsert: true } })), { ordered: false }),
    db.collection("categories").bulkWrite(DEFAULT_CATEGORIES.map((name) => ({ updateOne: { filter: { userId, name }, update: { $setOnInsert: { userId, name, createdAt: now } }, upsert: true } })), { ordered: false }),
  ]);
}
