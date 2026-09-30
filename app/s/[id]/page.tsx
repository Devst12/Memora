import ShareNoteView from "@/components/share-note-view";
import { database } from "@/lib/db";
import { notesCollection, serializeNote } from "@/lib/notes";
import { notFound } from "next/navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public share page for a note: /s/<slug>. Private notes 404 for everyone here
// (only the owner's authenticated API can read them — see /api/notes/[id]).
export default async function SharedNotePage({ params }: PageProps<"/s/[id]">) {
  const { id } = await params;
  const note = await notesCollection(await database()).findOne({ slug: id });
  if (!note || note.visibility !== "public") notFound();
  const data = serializeNote(note);
  return (
    <main className="min-h-dvh px-4 py-10">
      <ShareNoteView
        title={data.title}
        text={data.text}
        files={data.files}
        sourceUrl={data.sourceUrl}
        sourceTitle={data.sourceTitle}
        createdAt={data.createdAt.toISOString()}
      />
    </main>
  );
}
