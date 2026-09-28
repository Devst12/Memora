"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Item = {
  id: string; title: string; url: string; platform: string; description: string;
  thumbnailUrl: string; authorName: string; notes: string; reason: string;
  categoryName: string; categoryId: string | null; tags: string[]; status: string;
  savedAt: string; lastOpenedAt?: string; reminderAt?: string | null;
};
type Option = { id: string; name: string };

// Link previews can be hosted on any public site, so remote image hosts cannot be allowlisted in next.config.
/* eslint-disable @next/next/no-img-element */
export default function ItemDetail({ id }: { id: string }) {
  const router = useRouter();
  const [item, setItem] = useState<Item | null>(null);
  const [error, setError] = useState("");
  const [edit, setEdit] = useState(false);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [tags, setTags] = useState("");
  const [categories, setCategories] = useState<Option[]>([]);
  const [reasons, setReasons] = useState<Option[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    Promise.all([
      fetch(`/api/saved-items/${id}`),
      fetch("/api/taxonomy/categories"),
      fetch("/api/taxonomy/reasons"),
    ]).then(async ([itemResponse, categoriesResponse, reasonsResponse]) => {
      const body = await itemResponse.json();
      const categoriesBody = await categoriesResponse.json();
      const reasonsBody = await reasonsResponse.json();
      if (!itemResponse.ok) throw new Error(body.error || "Could not open this memory.");
      setItem(body.item);
      setTitle(body.item.title);
      setNotes(body.item.notes || "");
      setReason(body.item.reason || "");
      setCategoryId(body.item.categoryId || "");
      setTags((body.item.tags || []).join(", "));
      setCategories(categoriesBody.items || []);
      setReasons(reasonsBody.items || []);
    }).catch((cause) => setError(cause.message));
  }, [id]);

  async function patch(changes: Record<string, unknown>) {
    if (!item) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/saved-items/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not save your changes.");
      setItem(body.item);
      setNotice("Changes saved.");
    } catch (cause) { setNotice((cause as Error).message); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!confirm("Delete this memory? This can’t be undone.")) return;
    const response = await fetch(`/api/saved-items/${id}`, { method: "DELETE" });
    if (response.ok) router.push("/");
    else setNotice("Could not delete this memory. Try again.");
  }

  if (error) return <main className="grid min-h-screen place-items-center bg-[#f7f6f2] p-5"><div className="panel max-w-md text-center"><h1 className="text-xl font-semibold">Memory unavailable</h1><p className="mt-2 text-sm text-[#7d8279]">{error}</p><Link href="/" className="mt-5 inline-block text-sm text-[#526b4b]">← Back to your memory</Link></div></main>;
  if (!item) return <main className="grid min-h-screen place-items-center bg-[#f7f6f2] text-[#72796e]">Opening memory…</main>;

  return <main className="min-h-screen bg-[#f7f6f2] px-5 py-8 text-[#20251f] sm:py-14">
    <article className="mx-auto max-w-3xl">
      <Link href="/" className="text-sm text-[#74806f] hover:underline">← Back to your memory</Link>
      <div className="mt-7 rounded-3xl border border-[#e6e5dc] bg-white p-6 shadow-sm sm:p-10">
        <div className="flex items-center justify-between text-xs uppercase tracking-[.12em] text-[#8a9185]"><span>{item.platform}{item.authorName && ` · ${item.authorName}`}</span><span>{new Date(item.savedAt).toLocaleDateString()}</span></div>
        {item.thumbnailUrl && <img src={item.thumbnailUrl} alt="" loading="lazy" className="mt-6 max-h-80 w-full rounded-2xl bg-[#f2f1ec] object-cover" />}
        <h1 className="mt-7 text-3xl font-semibold leading-tight tracking-[-.04em] sm:text-4xl">{item.title}</h1>
        {item.description && <p className="mt-4 leading-7 text-[#6f766c]">{item.description}</p>}
        <div className="mt-7 flex flex-wrap gap-2">
          {item.reason && <span className="rounded-full bg-[#f7f3e8] px-3 py-1.5 text-sm text-[#887750]">Saved for: {item.reason}</span>}
          {item.categoryName && <span className="rounded-full bg-[#f1f3ee] px-3 py-1.5 text-sm text-[#687761]">{item.categoryName}</span>}
          {item.tags?.map((tag) => <span key={tag} className="rounded-full bg-[#f5f5f1] px-3 py-1.5 text-sm text-[#858b81]">#{tag}</span>)}
        </div>
        <div className="mt-8 border-t border-[#efeee8] pt-6">
          <div className="flex items-center justify-between"><h2 className="font-semibold">My note</h2><button onClick={() => setEdit(!edit)} className="text-sm text-[#63795d]">{edit ? "Cancel edit" : "Edit"}</button></div>
          {edit ? <div className="mt-3 space-y-3">
            <label className="block text-sm">Title<input className="input mt-2" value={title} maxLength={300} onChange={(event) => setTitle(event.target.value)} /></label>
            <label className="block text-sm">My note<textarea className="input mt-2 min-h-28" value={notes} maxLength={5000} onChange={(event) => setNotes(event.target.value)} /></label>
            <label className="block text-sm">Why did you save it?<select className="select mt-2 w-full" value={reason} onChange={(event) => setReason(event.target.value)}><option value="">No reason</option>{reasons.map((entry) => <option key={entry.id} value={entry.name}>{entry.name}</option>)}</select></label>
            <label className="block text-sm">Category<select className="select mt-2 w-full" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">No category</option>{categories.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
            <label className="block text-sm">Tags<input className="input mt-2" value={tags} onChange={(event) => setTags(event.target.value)} placeholder="Separate tags with commas" /></label>
            <button disabled={busy} onClick={async () => { await patch({ title, notes, reason, categoryId, tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean) }); setEdit(false); }} className="primary">Save changes</button>
          </div> : <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-[#73796f]">{item.notes || "No note yet. Add a thought about why you saved this."}</p>}
        </div>
        <div className="mt-8 rounded-2xl bg-[#f7f6f2] p-4"><p className="text-xs font-semibold uppercase tracking-wide text-[#9a9d94]">Original link</p><a href={item.url} target="_blank" rel="noreferrer" onClick={() => patch({ opened: true, status: item.status === "unread" ? "in_progress" : item.status })} className="mt-2 block break-all text-sm leading-6 text-[#536c4d] hover:underline">{item.url} ↗</a></div>
        {item.reminderAt && <p className="mt-4 text-sm text-[#777e73]">Reminder: {new Date(item.reminderAt).toLocaleString()}</p>}
        {notice && <p role="status" className="mt-4 text-sm text-[#62775b]">{notice}</p>}
        <div className="mt-8 flex flex-wrap gap-2 border-t border-[#efeee8] pt-6"><button onClick={() => patch({ status: item.status === "completed" ? "unread" : "completed" })} className="primary">{item.status === "completed" ? "Mark unread" : "✓ Mark complete"}</button><button onClick={() => patch({ status: item.status === "archived" ? "unread" : "archived" })} className="secondary">{item.status === "archived" ? "Restore" : "Archive"}</button><button onClick={remove} className="secondary ml-auto text-[#926c62]">Delete</button></div>
      </div>
    </article>
  </main>;
}
