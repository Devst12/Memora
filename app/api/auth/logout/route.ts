import { clearSession } from "@/lib/auth";
import { handleError } from "@/lib/http";
export async function POST() { try { await clearSession(); return Response.json({ ok: true }); } catch (error) { return handleError(error); } }
