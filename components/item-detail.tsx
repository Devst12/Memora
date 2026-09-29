"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { confirmDialog } from "@/components/confirm-dialog";
import { useEffect, useState } from "react";

type Item = {
  id: string; title: string; url: string; platform: string; description: string;
  thumbnailUrl: string; authorName: string; notes: string; reason: string;
  categoryName: string; categoryId: string | null; tags: string[]; status: string;
  savedAt: string; lastOpenedAt?: string; reminderAt?: string | null;
};
type Option = { id: string; name: string };

const platformLabel: Record<string, string> = { youtube: "YouTube", tiktok: "TikTok", instagram: "Instagram", facebook: "Facebook", reddit: "Reddit", web: "Web" };

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
      toast.success("Changes saved");
    } catch (cause) { toast.error((cause as Error).message); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!(await confirmDialog({ title: "Delete this memory?", message: "This can’t be undone.", confirmLabel: "Delete", tone: "danger" }))) return;
    try {
      const response = await fetch(`/api/saved-items/${id}`, { method: "DELETE" });
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || "Could not delete this memory. Try again."); }
      toast.success("Memory deleted");
      router.push("/");
    } catch (cause) { toast.error((cause as Error).message); }
  }

  if (error) return <main className="grid min-h-screen place-items-center bg-[var(--bg)] p-5"><div className="panel max-w-md text-center"><h1 className="text-xl font-semibold">Memory unavailable</h1><p className="mt-2 text-sm text-[var(--ink-soft)]">{error}</p><Link href="/" className="mt-5 inline-block text-sm font-medium text-[var(--accent-ink)] hover:underline">← Back to your memory</Link></div></main>;
  if (!item) return <main className="mx-auto max-w-3xl px-5 py-10"><div className="card p-6 sm:p-10"><div className="skeleton h-4 w-24" /><div className="skeleton mt-8 h-10 w-3/4" /><div className="skeleton mt-4 h-4 w-full" /><div className="skeleton mt-2 h-4 w-2/3" /><div className="skeleton mt-10 h-24 w-full rounded-2xl" /></div></main>;

  return <main className="min-h-screen bg-[var(--bg)] px-4 py-6 text-[var(--ink)] sm:py-12 sm:px-6">
    <article className="anim-fade-up mx-auto max-w-3xl">
      <Link href="/" className="text-sm text-[var(--ink-soft)] hover:text-[var(--accent-ink)] hover:underline">← Back to your memory</Link>
      <div className="mt-4 rounded-3xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-[var(--shadow-card)] sm:p-10">
        <div className="flex items-center justify-between text-xs uppercase tracking-[.12em] text-[var(--ink-faint)]"><span>{platformLabel[item.platform] || item.platform}{item.authorName && ` · ${item.authorName}`}</span><span>{new Date(item.savedAt).toLocaleDateString()}</span></div>
        {item.thumbnailUrl && <img src={item.thumbnailUrl} alt="" loading="lazy" className="mt-6 max-h-80 w-full rounded-2xl bg-[var(--accent-soft)] object-cover" />}
        <h1 className="mt-7 text-3xl font-semibold leading-tight tracking-[-.035em] sm:text-4xl">{item.title}</h1>
        {item.description && <p className="mt-4 leading-7 text-[var(--ink-soft)]">{item.description}</p>}
        <div className="mt-6 flex flex-wrap gap-2">
          {item.reason && <span className="chip bg-[var(--amber-soft)] px-3 py-1.5 text-sm text-[var(--amber-ink)]">Saved for: {item.reason}</span>}
          {item.categoryName && <span className="chip bg-[var(--accent-soft)] px-3 py-1.5 text-sm text-[var(--accent-ink)]">{item.categoryName}</span>}
          {item.tags?.map((tag) => <span key={tag} className="chip bg-[var(--bg)] px-3 py-1.5 text-sm text-[var(--ink-soft)]">#{tag}</span>)}
        </div>
        <div className="mt-8 border-t border-[var(--border)] pt-6">
          <div className="flex items-center justify-between"><h2 className="font-semibold">My note</h2><button onClick={() => setEdit(!edit)} className="rounded-lg px-2 py-1 text-sm text-[var(--accent-ink)] hover:bg-[var(--accent-soft)]">{edit ? "Cancel" : "Edit"}</button></div>
          {edit ? <div className="mt-3 space-y-3">
            <label className="block text-sm font-medium text-[var(--ink-soft)]">Title<input className="input mt-1.5" value={title} maxLength={300} onChange={(event) => setTitle(event.target.value)} /></label>
            <label className="block text-sm font-medium text-[var(--ink-soft)]">My note<textarea className="input mt-1.5 min-h-28" value={notes} maxLength={5000} onChange={(event) => setNotes(event.target.value)} /></label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-medium text-[var(--ink-soft)]">Why did you save it?<select className="select mt-1.5 w-full" value={reason} onChange={(event) => setReason(event.target.value)}><option value="">No reason</option>{reasons.map((entry) => <option key={entry.id} value={entry.name}>{entry.name}</option>)}</select></label>
              <label className="block text-sm font-medium text-[var(--ink-soft)]">Category<select className="select mt-1.5 w-full" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">No category</option>{categories.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
            </div>
            <label className="block text-sm font-medium text-[var(--ink-soft)]">Tags<input className="input mt-1.5" value={tags} onChange={(event) => setTags(event.target.value)} placeholder="Separate tags with commas" /></label>
            <div className="flex gap-2"><button disabled={busy} onClick={async () => { await patch({ title, notes, reason, categoryId, tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean) }); setEdit(false); }} className="primary">Save changes</button><button onClick={() => setEdit(false)} className="secondary">Cancel</button></div>
          </div> : <p className="mt-3 whitespace-pre-wrap rounded-2xl bg-[var(--bg)] px-4 py-3 text-sm leading-7 text-[var(--ink-soft)]">{item.notes || "No note yet. Add a thought about why you saved this."}</p>}
        </div>
        <div className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--bg)] p-4"><p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-faint)]">Original link</p><a href={item.url} target="_blank" rel="noreferrer" onClick={() => patch({ opened: true, status: item.status === "unread" ? "in_progress" : item.status })} className="mt-2 block break-all text-sm leading-6 text-[var(--accent-ink)] hover:underline">{item.url} ↗</a></div>
        {item.reminderAt && <p className="mt-4 text-sm text-[var(--amber-ink)]">⏰ Reminder: {new Date(item.reminderAt).toLocaleString()}</p>}
        <div className="mt-8 flex flex-wrap gap-2 border-t border-[var(--border)] pt-6"><button onClick={() => patch({ status: item.status === "completed" ? "unread" : "completed" })} className="primary">{item.status === "completed" ? "Mark unread" : "✓ Mark complete"}</button><button onClick={() => patch({ status: item.status === "archived" ? "unread" : "archived" })} className="secondary">{item.status === "archived" ? "Restore" : "Archive"}</button><button onClick={remove} className="btn-danger-ghost ml-auto rounded-xl border border-[var(--border)] px-4">Delete</button></div>
      </div>
    </article>
  </main>;
}
