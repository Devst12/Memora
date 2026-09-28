import { ObjectId } from "mongodb";
import { currentUser } from "@/lib/auth";
import { database } from "@/lib/db";
import { handleError, jsonError } from "@/lib/http";

export async function GET() {
  try {
    const user = await currentUser(); if (!user) return jsonError("Sign in required.", 401);
    const db = await database(), items = db.collection("saved_items"), now = new Date(), forgottenBefore = new Date(Date.now() - 7 * 86400000);
    const forgottenFilter = { userId: user._id, status: { $in: ["unread", "in_progress"] }, savedAt: { $lte: forgottenBefore }, $or: [{ lastOpenedAt: null }, { lastOpenedAt: { $lte: forgottenBefore } }] };
    const [total, unread, completed, reminders, categories, recent, forgotten, forgottenCount, activity] = await Promise.all([
      items.countDocuments({ userId: user._id }), items.countDocuments({ userId: user._id, status: "unread" }), items.countDocuments({ userId: user._id, status: "completed" }),
      items.find({ userId: user._id, reminderAt: { $lte: now } }).sort({ reminderAt: 1 }).limit(5).toArray(),
      db.collection("categories").find({ userId: user._id }).sort({ name: 1 }).toArray(),
      items.find({ userId: user._id, status: { $ne: "archived" } }).sort({ savedAt: -1 }).limit(4).toArray(),
      items.find(forgottenFilter).sort({ savedAt: 1 }).limit(4).toArray(), items.countDocuments(forgottenFilter),
      db.collection("activity").find({ userId: user._id }).sort({ createdAt: -1 }).limit(8).toArray(),
    ]);
    const serialize = (item: { _id: ObjectId; categoryId?: ObjectId | null; [key: string]: unknown }) => ({ ...item, id: item._id.toHexString(), _id: undefined, userId: undefined, categoryId: item.categoryId?.toHexString?.() ?? null });
    const activityItems = await items.find({ userId: user._id, _id: { $in: activity.map(({ itemId }) => itemId) } }).project({ title: 1 }).toArray();
    const activityTitle = new Map(activityItems.map(({ _id, title }) => [_id.toHexString(), title]));
    return Response.json({ stats: { total, unread, completed, forgotten: forgottenCount }, items: { recent: recent.map(serialize), forgotten: forgotten.map(serialize), reminders: reminders.map(serialize) }, categories: categories.map(({ _id, name }) => ({ id: _id.toHexString(), name })), activity: activity.map(({ type, createdAt, itemId }) => ({ type, createdAt, itemId: itemId.toHexString(), title: activityTitle.get(itemId.toHexString()) || "Saved item" })) });
  } catch (error) { return handleError(error); }
}
