"use client";

import { useCallback, useEffect, useState } from "react";

type Entry = { id: string; createdAt: string };
export default function ActiveExtensionTokens() {
  const [tokens, setTokens] = useState<Entry[]>([]);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    const response = await fetch("/api/extension-token");
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Couldn’t load capture tokens.");
    setTokens(body.tokens || []);
  }, []);
  useEffect(() => {
    let active = true;
    fetch("/api/extension-token").then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Couldn’t load capture tokens.");
      if (active) setTokens(body.tokens || []);
    }).catch((cause) => { if (active) setError(cause.message); });
    return () => { active = false; };
  }, []);
  async function revoke(id: string) {
    if (!confirm("Revoke this extension token? Any extension using it will stop saving.")) return;
    const response = await fetch(`/api/extension-token?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!response.ok) { setError("Could not revoke this token."); return; }
    await refresh();
  }
  return <div className="mt-4 space-y-2">
    {tokens.map((token) => <div key={token.id} className="flex items-center gap-3 rounded-xl bg-[#f7f6f2] px-3 py-2 text-xs"><span className="min-w-0 flex-1 truncate font-mono">Token ···{token.id.slice(-6)} · {new Date(token.createdAt).toLocaleDateString()}</span><button onClick={() => revoke(token.id)} className="shrink-0 text-[#926c62] hover:underline">Revoke</button></div>)}
    {error && <p role="status" className="text-xs text-[#926c62]">{error}</p>}
    {!tokens.length && !error && <p className="text-xs text-[#8a8f86]">No active tokens.</p>}
  </div>;
}
