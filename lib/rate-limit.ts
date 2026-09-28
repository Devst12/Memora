import { createHmac } from "node:crypto";
import { database } from "@/lib/db";

export async function rateLimited(request: Request, scope: string, limit: number, windowMs: number) {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("AUTH_SECRET must contain at least 32 characters.");
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = request.headers.get("x-real-ip") || forwarded || "unknown";
  const windowStart = Math.floor(Date.now() / windowMs);
  const key = createHmac("sha256", secret).update(`${scope}:${address}:${windowStart}`).digest("hex");
  const db = await database(), limits = db.collection<{ _id: string; count: number; expiresAt: Date }>("rate_limits"), expiresAt = new Date((windowStart + 1) * windowMs + 60000);
  try {
    const result = await limits.updateOne({ _id: key }, { $inc: { count: 1 }, $setOnInsert: { expiresAt } }, { upsert: true });
    if (result.upsertedCount) return false;
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
  }
  const entry = await limits.findOne({ _id: key }, { projection: { count: 1 } });
  return (entry?.count || 0) > limit;
}
