"use client";

import { toast } from "sonner";
import { useCallback, useEffect, useState } from "react";

type Taxonomy = { id: string; name: string };
type Rule = { id: string; categoryId: string; categoryName: string; keywords: string[] };

async function api(path: string, options?: RequestInit) {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...options?.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Something went wrong.");
  return body;
}

// Auto-save rules: category → keywords. The first rule whose keyword appears in a saved link's
// URL, title, or page context wins — this is what teaches the one-click extension capture which
// of your categories fits, in the exact words you choose.
export default function CategoryRules() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [categories, setCategories] = useState<Taxonomy[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [keywords, setKeywords] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ruleBody, categoryBody] = await Promise.all([api("/api/category-rules"), api("/api/taxonomy/categories")]);
      setRules(ruleBody.items || []);
      setCategories(categoryBody.items || []);
      setCategoryId((current) => current || categoryBody.items?.[0]?.id || "");
    } catch (error) { toast.error((error as Error).message); } finally { setLoading(false); }
  }, []);
  useEffect(() => {
    let active = true;
    api("/api/category-rules").then((body) => { if (active) setRules(body.items || []); }).catch((cause) => { if (active) toast.error((cause as Error).message); });
    api("/api/taxonomy/categories").then((body) => { if (active) { setCategories(body.items || []); setCategoryId((current) => current || body.items?.[0]?.id || ""); } }).catch(() => { /* The add form simply stays hidden. */ }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function addRule(event: React.FormEvent) {
    event.preventDefault();
    const list = keywords.split(",").map((word) => word.trim()).filter(Boolean);
    if (!categoryId || !list.length) { toast.error("Pick a category and at least one keyword."); return; }
    setBusy(true);
    try {
      await api("/api/category-rules", { method: "POST", body: JSON.stringify({ categoryId, keywords: list }) });
      setKeywords("");
      toast.success("Rule added — new captures will use it");
      await load();
    } catch (error) { toast.error((error as Error).message); } finally { setBusy(false); }
  }

  async function removeRule(id: string) {
    try { await api(`/api/category-rules?id=${encodeURIComponent(id)}`, { method: "DELETE" }); toast.success("Rule removed"); await load(); }
    catch (error) { toast.error((error as Error).message); }
  }

  return <section className="panel lg:col-span-2">
    <h2 className="text-lg font-semibold">Auto-save rules</h2>
    <p className="mt-1 text-sm leading-6 text-[var(--ink-soft)]">Teach the one-click capture button how to file links. If a link&apos;s address, title, or page text contains one of your keywords, it lands in that category — first rule wins.</p>
    {!loading && <form onSubmit={addRule} className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,180px)_1fr_auto]">
      <select aria-label="Category for the rule" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="select">
        {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
      </select>
      <input value={keywords} onChange={(e) => setKeywords(e.target.value)} className="input" placeholder="Keywords, comma separated — e.g. react, next.js, css" maxLength={400} />
      <button disabled={busy} className="secondary shrink-0">{busy ? "Adding…" : "Add rule"}</button>
    </form>}
    <div className="mt-3 space-y-2">
      {rules.map((rule, index) => <div key={rule.id} className="flex items-center gap-3 rounded-xl bg-[var(--bg)] px-3 py-2 text-sm">
        <span className="text-xs text-[var(--ink-faint)]">#{index + 1}</span>
        <span className="chip shrink-0 bg-[var(--accent-soft)] text-[var(--accent-ink)]">{rule.categoryName}</span>
        <span className="min-w-0 flex-1 truncate text-[var(--ink-soft)]">{rule.keywords.join(", ")}</span>
        <button onClick={() => removeRule(rule.id)} className="shrink-0 text-[var(--ink-faint)] hover:text-[var(--danger)]" aria-label={`Remove ${rule.categoryName} rule`}>×</button>
      </div>)}
      {!loading && !rules.length && <p className="text-xs text-[var(--ink-faint)]">No rules yet — without one, Memora picks the closest category by itself.</p>}
    </div>
  </section>;
}
