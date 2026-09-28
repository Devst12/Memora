import { ObjectId } from "mongodb";
import { database } from "@/lib/db";
import { createSession, hashPassword } from "@/lib/auth";
import { handleError, jsonError, safeText } from "@/lib/http";
import { seedDefaults } from "@/lib/defaults";
import { rateLimited } from "@/lib/rate-limit";

export async function POST(request: Request) {
  try {
    if (await rateLimited(request, "register", 5, 60 * 60 * 1000)) return jsonError("Too many signup attempts. Try again later.", 429);
    const body = await request.json();
    const name = safeText(body.name, 80), email = safeText(body.email, 254).toLowerCase(), password = typeof body.password === "string" ? body.password : "";
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 10 || password.length > 128) return jsonError("Enter your name, a valid email, and a password with at least 10 characters.");
    const db = await database();
    const userId = new ObjectId();
    try {
      await db.collection("users").insertOne({ _id: userId, name, email, passwordHash: await hashPassword(password), createdAt: new Date(), updatedAt: new Date() });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) return jsonError("An account with this email already exists.", 409);
      throw error;
    }
    await seedDefaults(db, userId);
    await createSession(userId);
    return Response.json({ user: { id: userId.toHexString(), name, email } }, { status: 201 });
  } catch (error) { return handleError(error); }
}
