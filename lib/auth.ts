import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { ObjectId } from "mongodb";
import { database } from "@/lib/db";

const scrypt = promisify(scryptCallback);
const COOKIE = "memora_session";
const SESSION_DAYS = 30;

function secret() {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) throw new Error("AUTH_SECRET must contain at least 32 characters.");
  return value;
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const actual = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hash, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function sign(id: string) {
  return createHmac("sha256", secret()).update(id).digest("hex");
}

export async function createSession(userId: ObjectId) {
  const db = await database();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000);
  await db.collection("sessions").insertOne({ userId, tokenHash: createHmac("sha256", secret()).update(token).digest("hex"), expiresAt, createdAt: new Date() });
  const jar = await cookies();
  jar.set(COOKIE, `${token}.${sign(userId.toHexString())}.${userId.toHexString()}`, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires: expiresAt,
  });
}

export async function clearSession() {
  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value;
  if (raw) {
    const [token, , userId] = raw.split(".");
    if (token && ObjectId.isValid(userId)) {
      const db = await database();
      await db.collection("sessions").deleteOne({ userId: new ObjectId(userId), tokenHash: createHmac("sha256", secret()).update(token).digest("hex") });
    }
  }
  jar.delete(COOKIE);
}

export async function currentUser() {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  const [token, signature, id] = raw.split(".");
  if (!token || !signature || !ObjectId.isValid(id)) return null;
  const expected = Buffer.from(sign(id), "hex");
  const received = Buffer.from(signature, "hex");
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  const db = await database();
  const tokenHash = createHmac("sha256", secret()).update(token).digest("hex");
  const session = await db.collection("sessions").findOne({ userId: new ObjectId(id), tokenHash, expiresAt: { $gt: new Date() } });
  if (!session) return null;
  return db.collection("users").findOne({ _id: session.userId }, { projection: { passwordHash: 0 } });
}

export async function requireUser() {
  const user = await currentUser();
  if (!user) throw new Response("Unauthorized", { status: 401 });
  return user;
}
