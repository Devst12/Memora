import { currentUser } from "@/lib/auth";
import { handleError } from "@/lib/http";
export async function GET() { try { const user = await currentUser(); return Response.json({ user: user ? { id: user._id.toHexString(), name: user.name, email: user.email } : null }); } catch (error) { return handleError(error); } }
