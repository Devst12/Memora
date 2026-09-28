import { currentUser, createExtensionToken } from "@/lib/auth";
import { database } from "@/lib/db";
import { handleError, jsonError } from "@/lib/http";

export async function GET(request: Request) {
  try {
    const user = await currentUser(request); if (!user) return jsonError("Sign in required.", 401);
    const tokens = await (await database()).collection("extension_tokens").find({ userId: user._id, revokedAt: null }).project({ _id: 1, createdAt: 1 }).sort({ createdAt: -1 }).toArray();
    return Response.json({ tokens: tokens.map(({ _id, createdAt }) => ({ id: _id.toHexString(), createdAt })) });
  } catch (error) { return handleError(error); }
}

export async function POST() {
  try { const user = await currentUser(); if (!user) return jsonError("Sign in required.", 401); return Response.json({ token: await createExtensionToken(user._id) }, { status: 201 }); }
  catch (error) { return handleError(error); }
}

export async function DELETE(request: Request) {
  try {
    const user = await currentUser(); if (!user) return jsonError("Sign in required.", 401);
    const id = new URL(request.url).searchParams.get("id"); if (!id || !/^[a-f\d]{24}$/i.test(id)) return jsonError("Token not found.", 404);
    const result = await (await database()).collection("extension_tokens").updateOne({ _id: new (await import("mongodb")).ObjectId(id), userId: user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
    return result.matchedCount ? Response.json({ ok: true }) : jsonError("Token not found.", 404);
  } catch (error) { return handleError(error); }
}
