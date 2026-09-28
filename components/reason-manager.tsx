"use client";

import { useCallback, useEffect, useState } from "react";

type Reason = { id: string; name: string };
export default function ReasonManager() {
  const [reasons, setReasons] = useState<Reason[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    const response = await fetch("/api/taxonomy/reasons"), body = await response.json();
    if (!response.ok) throw new Error(body.error || "Couldn’t load save reasons.");
    setReasons(body.items || []);
  }, []);
  useEffect(() => {
    let active = true;
    fetch("/api/taxonomy/reasons").then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Couldn’t load save reasons.");
      if (active) setReasons(body.items || []);
    }).catch((cause) => { if (active) setError(cause.message); });
    return () => { active = false; };
  }, []);
  async function create(event: React.FormEvent) {
    event.preventDefault(); setError("");
    try { const response = await fetch("/api/taxonomy/reasons", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error); setName(""); await refresh(); }
    catch (cause) { setError((cause as Error).message); }
  }
  async function rename(reason: Reason) {
    const next = prompt("Rename save reason", reason.name);
    if (!next?.trim() || next.trim() === reason.name) return;
    const response = await fetch("/api/taxonomy/reasons", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: reason.id, name: next.trim() }) });
    if (!response.ok) { const body = await response.json(); setError(body.error || "Couldn’t rename this reason."); return; }
    await refresh();
  }
  async function remove(reason: Reason) {
    if (!confirm(`Delete “${reason.name}”? Saved items will keep their existing reason.`)) return;
    const response = await fetch(`/api/taxonomy/reasons?id=${reason.id}`, { method: "DELETE" });
    if (!response.ok) { setError("Couldn’t delete this reason."); return; }
    await refresh();
  }
  return <section className="panel"><h2 className="text-lg font-semibold">Save reasons</h2><p className="mt-1 text-sm text-[#81877e]">Choose and manage the reasons that help you remember.</p><div className="mt-4 space-y-2">{reasons.map((reason) => <div key={reason.id} className="flex items-center gap-3 rounded-xl bg-[#f7f6f2] px-3 py-2 text-sm"><button onClick={() => rename(reason)} className="min-w-0 flex-1 truncate text-left hover:underline">{reason.name}</button><button onClick={() => remove(reason)} className="text-[#8a8f86] hover:text-red-700" aria-label={`Delete ${reason.name}`}>×</button></div>)}</div><form onSubmit={create} className="mt-4 flex gap-2"><input value={name} onChange={(event) => setName(event.target.value)} className="input" placeholder="New reason" maxLength={80} /><button className="secondary shrink-0">Add</button></form>{error && <p role="alert" className="mt-3 text-xs text-[#926c62]">{error}</p>}</section>;
}
