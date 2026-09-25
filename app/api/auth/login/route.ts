import { database } from "@/lib/db";
import { createSession, verifyPassword } from "@/lib/auth";
import { handleError, jsonError, safeText } from "@/lib/http";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const email = safeText(body.email, 254).toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";
    const db = await database();
    const user = await db.collection("users").findOne({ email });
    if (!user || !(await verifyPassword(password, user.passwordHash))) return jsonError("Email or password is incorrect.", 401);
    await createSession(user._id);
    return Response.json({ user: { id: user._id.toHexString(), name: user.name, email: user.email } });
  } catch (error) { return handleError(error); }
}
