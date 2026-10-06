"use client";

// Landing page for the phone's share sheet (PWA share_target → /share).
// "Send and done": the save POST carries only what the share payload already
// contains and returns in one round trip; the video's real title, thumbnail
// and tags are pulled from the URL afterwards, in the background — the card
// updates in place as they land. The page also dismisses itself back to the
// previous app once the save is done.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Phase = "working" | "done" | "duplicate" | "signin" | "error" | "nourl";

type Item = { id: string; title: string; url: string; platform: string; thumbnailUrl: string; categoryName: string };

const URL_RE = /https?:\/\/[^\s"'<>()]+/i;

// Extract the first http(s) URL from anywhere in the share payload: the url
// param when the sharer provides one, otherwise the text field (many Android
// apps put "Video title https://… #hashtag" in text and leave url empty).
function extractUrl(title: string, text: string, url: string) {
  for (const candidate of [url, text, title]) {
    const match = (candidate || "").match(URL_RE);
    if (match) return match[0];
  }
  return "";
}

// Strip the URL (and stray pipes/dashes around it) out of a text field so the
// card shows the human part — "Video title | https://…" → "Video title".
function titleFromText(title: string, text: string) {
  const cleaned = (text || "").replace(URL_RE, "").replace(/[\s|·—–-]+$/, "").trim();
  return (cleaned || title || "").slice(0, 300);
}

export default function ShareClient() {
  const [phase, setPhase] = useState<Phase>("working");
  const [message, setMessage] = useState("");
  const [item, setItem] = useState<Item | null>(null);
  const router = useRouter();
  const started = useRef(false); // StrictMode runs effects twice in dev; save exactly once.
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoClosing = useRef(false);

  // Stable across renders: the one-shot effect below can depend on it honestly.
  const save = useCallback(async (rawUrl: string, title: string, text: string) => {
    try {
      const response = await fetch("/api/extension/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: rawUrl,
          title: titleFromText(title, text),
          pageTitle: titleFromText(title, text),
          description: "",
          author: "",
          thumbnailUrl: "",
          keywords: [],
        }),
      });
      if (response.status === 401) { setPhase("signin"); return; }
      const body = await response.json().catch(() => ({}));
      if (response.status === 409) {
        setItem(body.itemId ? { id: body.itemId, title: body.title || "Already saved", url: rawUrl, platform: body.platform || "web", thumbnailUrl: body.thumbnailUrl || "", categoryName: "" } : null);
        setPhase("duplicate");
        return;
      }
      if (!response.ok) throw new Error(body.error || "Something went wrong. Please try again.");
      setItem({ id: body.itemId, title: body.title, url: body.url || rawUrl, platform: body.platform, thumbnailUrl: body.thumbnailUrl || "", categoryName: body.categoryName || "" });
      setPhase("done");
      // "Send and done": once the save is confirmed, give the user a beat to
      // see the card, then return to where they were. window.close() closes
      // the share-sheet tab on Android (back to the previous app); where the
      // browser refuses, fall back to history or the dashboard.
      autoClosing.current = true;
      closeTimer.current = setTimeout(() => {
        window.close();
        if (!autoClosing.current) return;
        if (history.length > 1) history.back();
        else router.push("/");
      }, 3500);
    } catch (error) {
      setMessage((error as Error).message || "Couldn't save right now.");
      setPhase("error");
    }
  }, [router]);

  // Any tap on the card cancels the auto-close — the user wants to look around.
  function hold() {
    autoClosing.current = false;
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
  }

  useEffect(() => {
    // Deferred to a task so the effect body stays render-pure (react-hooks).
    const timer = setTimeout(() => {
      if (started.current) return;
      started.current = true;
      const params = new URLSearchParams(window.location.search);
      const title = params.get("title") || "";
      const text = params.get("text") || "";
      const rawUrl = extractUrl(title, text, params.get("url") || "");
      if (!rawUrl) { setPhase("nourl"); return; }
      void save(rawUrl, title, text);
    }, 0);
    return () => clearTimeout(timer);
  }, [save]);

  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  if (phase === "working") {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">
        <div className="anim-pop rounded-3xl border border-[var(--border)] bg-[var(--card)] p-7 shadow-[var(--shadow-pop)]">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--accent)] font-semibold text-white shadow-sm">m</span>
            <span className="text-xl font-semibold tracking-[-.04em]">memora</span>
          </div>
          <div className="mt-8 flex flex-col items-center gap-4 py-6 text-center">
            <span className="h-9 w-9 animate-spin rounded-full border-[3px] border-[var(--border-strong)] border-t-[var(--accent)]" />
            <p className="text-sm text-[var(--ink-soft)]">Saving…</p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">
      <div className="anim-pop rounded-3xl border border-[var(--border)] bg-[var(--card)] p-7 shadow-[var(--shadow-pop)]" onPointerDown={hold}>
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--accent)] font-semibold text-white shadow-sm">m</span>
          <span className="text-xl font-semibold tracking-[-.04em]">memora</span>
        </div>

        {(phase === "done" || phase === "duplicate") && (
          <div className="mt-6 anim-fade-up">
            {item?.thumbnailUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- thumbnails come from arbitrary platforms.
              <img src={item.thumbnailUrl} alt="" className="h-40 w-full rounded-2xl border border-[var(--border)] bg-[var(--bg)] object-cover" />
            )}
            <h1 className="mt-4 text-xl font-semibold leading-snug tracking-tight">{item?.title || (phase === "done" ? "Saved to your memory" : "Already in your memory")}</h1>
            <p className="mt-1.5 text-sm text-[var(--ink-soft)]">
              {phase === "duplicate" ? "This one is saved already — no copy was made." : item?.categoryName ? `${item.categoryName} · Saved just now` : "Saved just now"}
            </p>
            {item?.url && <p className="mt-3 truncate text-xs text-[var(--ink-faint)]">{item.url}</p>}
            <div className="mt-6 flex flex-wrap gap-2">
              {item?.id && <Link href={`/items/${item.id}`} className="primary flex-1 text-center">{phase === "duplicate" ? "Open it" : "Open"}</Link>}
              <Link href="/" className="secondary flex-1 text-center">My memory</Link>
            </div>
            {phase === "done" && <p className="mt-4 text-center text-xs text-[var(--ink-faint)]">Closing…</p>}
          </div>
        )}

        {phase === "signin" && (
          <div className="mt-6 anim-fade-up">
            <h1 className="text-xl font-semibold tracking-tight">One more step</h1>
            <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">Sign in to Memora in this browser, then share to it again — your save will go straight through.</p>
            <Link href="/" className="primary mt-6 block text-center">Sign in to Memora</Link>
          </div>
        )}

        {phase === "error" && (
          <div className="mt-6 anim-fade-up">
            <h1 className="text-xl font-semibold tracking-tight">That didn&apos;t work</h1>
            <p className="mt-2 text-sm leading-6 text-[var(--danger)]">{message}</p>
            <div className="mt-6 flex gap-2">
              <button onClick={() => { started.current = false; setPhase("working"); window.location.reload(); }} className="primary flex-1">Try again</button>
              <Link href="/" className="secondary flex-1 text-center">My memory</Link>
            </div>
          </div>
        )}

        {phase === "nourl" && (
          <div className="mt-6 anim-fade-up">
            <h1 className="text-xl font-semibold tracking-tight">No link found</h1>
            <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">Share a video or page from another app — YouTube, TikTok, Instagram, any browser — and it lands here automatically.</p>
            <Link href="/" className="secondary mt-6 block text-center">My memory</Link>
          </div>
        )}
      </div>
      <p className="mt-4 text-center text-xs text-[var(--ink-faint)]">Shared links are private to your account.</p>
    </main>
  );
}
