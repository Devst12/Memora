"use client";

// The public face of a shared note (page /s/<slug>): readable text, image
// gallery, downloadable files, copy-link, and a QR / native-share panel.
// Deliberately dependency-free React so it renders identically from the share
// page and any future embed.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type ShareFile = { id: string; name: string; type: string; size: number; kind: "image" | "file"; url: string; thumbUrl: string };

type Props = {
  title: string;
  text: string;
  files: ShareFile[];
  sourceUrl: string;
  sourceTitle: string;
  createdAt: string;
};

const NOTE_FILE_ROUTE = "/api/notes"; // + /<noteId>/files/<fileId>

function fileHref(noteId: string, file: ShareFile, download: boolean) {
  return `${NOTE_FILE_ROUTE}/${noteId}/files/${encodeURIComponent(file.id)}${download ? "?download=1" : ""}`;
}

function prettyBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Only called from event handlers (never during render), so reading location is safe.
function absoluteShareUrl() {
  return `${location.origin}${location.pathname}`;
}

export default function ShareNoteView({ title, text, files, sourceUrl, sourceTitle, createdAt }: Props) {
  // The note id is recoverable straight from the attachment URLs the server rendered.
  const [noteId, setNoteId] = useState(() => {
    for (const file of files) {
      const match = file.url?.match(/\/api\/notes\/([a-f\d]{24})\/files\//);
      if (match?.[1]) return match[1];
    }
    return "";
  });
  const [toast, setToast] = useState("");
  const [lightbox, setLightbox] = useState(-1);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrUrl, setQrUrl] = useState("");

  useEffect(() => {
    if (noteId) return; // Notes without files resolve their id via the slug API.
    let cancelled = false;
    fetch(location.pathname.replace("/s/", "/api/notes/by-slug/"))
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => { if (!cancelled && body?.note?.id) setNoteId(body.note.id); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [noteId]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 2200);
    return () => clearTimeout(timer);
  }, [toast]);

  const copy = useCallback(async (value: string, what: string) => {
    try { await navigator.clipboard.writeText(value); setToast(`${what} copied`); }
    catch { setToast(`Couldn't copy the ${what.toLowerCase()}`); }
  }, []);

  const share = useCallback(async () => {
    const url = absoluteShareUrl();
    if (navigator.share) {
      try { await navigator.share({ title: title || "Memora note", url }); return; } catch { /* User dismissed. */ }
    }
    copy(url, "Link");
  }, [copy, title]);

  const images = files.filter((f) => f.kind === "image");
  const docs = files.filter((f) => f.kind === "file");

  return (
    <div className="mx-auto w-full max-w-2xl">
      <header className="mb-6 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold tracking-tight text-[var(--ink-soft)] hover:text-[var(--ink)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" className="h-6 w-6 rounded-md" onError={(e) => { e.currentTarget.style.display = "none"; }} />
          Memora
        </Link>
        <span className="chip bg-[var(--accent-soft)] text-[var(--accent-ink)]">Public note</span>
      </header>

      <article className="card p-6 anim-fade-up sm:p-8">
        {title ? <h1 className="text-2xl font-semibold leading-snug tracking-tight">{title}</h1> : null}
        <p className="mt-1 text-xs text-[var(--ink-faint)]">
          {new Date(createdAt).toLocaleString()}
          {sourceUrl ? (
            <> · from <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted hover:text-[var(--ink)]">{sourceTitle || new URL(sourceUrl).hostname}</a></>
          ) : null}
        </p>

        {text ? (
          <>
            <p className="mt-4 whitespace-pre-wrap text-[15px] leading-7">{text}</p>
            <button type="button" onClick={() => copy(text, "Text")} className="secondary mt-4">Copy text</button>
          </>
        ) : null}

        {images.length ? (
          <div className={`mt-5 grid gap-2 ${images.length === 1 ? "grid-cols-1" : "grid-cols-2 sm:grid-cols-3"}`}>
            {images.map((file, index) => (
              <button
                key={file.id}
                type="button"
                onClick={() => setLightbox(index)}
                className="group relative overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-raised)]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={file.thumbUrl || file.url} alt={file.name} loading="lazy" className="h-40 w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]" />
              </button>
            ))}
          </div>
        ) : null}

        {docs.length ? (
          <ul className="mt-5 space-y-2">
            {docs.map((file) => (
              <li key={file.id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-raised)] px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{file.name}</p>
                  <p className="text-xs text-[var(--ink-faint)]">{prettyBytes(file.size)}</p>
                </div>
                <div className="flex flex-none gap-2">
                  <a href={fileHref(noteId, file, false)} target="_blank" rel="noopener noreferrer" className="secondary !min-h-0 px-3 py-1.5 text-xs">View</a>
                  <a href={fileHref(noteId, file, true)} className="primary !min-h-0 px-3 py-1.5 text-xs">Download</a>
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-2 border-t border-[var(--border)] pt-5">
          <button type="button" onClick={() => { setQrUrl(absoluteShareUrl()); setQrOpen(true); }} className="btn btn-primary">QR code</button>
          <button type="button" onClick={share} className="btn btn-secondary">Share</button>
          <button type="button" onClick={() => copy(absoluteShareUrl(), "Link")} className="btn btn-secondary">Copy link</button>
        </div>
      </article>

      {lightbox >= 0 && images[lightbox] ? (
        <div
          role="presentation"
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/85 p-4"
          onClick={(event) => { if (event.target === event.currentTarget) setLightbox(-1); }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={images[lightbox].url} alt={images[lightbox].name} className="max-h-[80vh] max-w-full rounded-xl object-contain" />
          <div className="flex gap-2">
            <a href={images[lightbox].url} download={images[lightbox].name} className="btn btn-secondary">Download image</a>
            <button type="button" onClick={() => copy(images[lightbox].url, "Image link")} className="btn btn-secondary">Copy image link</button>
            <button type="button" onClick={() => setLightbox(-1)} className="btn btn-ghost text-white">Close</button>
          </div>
        </div>
      ) : null}

      {qrOpen ? (
        <div
          role="presentation"
          className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4 backdrop-blur-[2px]"
          onClick={(event) => { if (event.target === event.currentTarget) setQrOpen(false); }}
        >
          <div className="anim-pop w-full max-w-xs rounded-3xl border border-[var(--border)] bg-[var(--card)] p-6 text-center shadow-[var(--shadow-pop)]">
            <h2 className="text-lg font-semibold tracking-tight">Scan to open</h2>
            <p className="mt-1 text-xs text-[var(--ink-faint)]">Point a phone camera at the code.</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/qr?data=${encodeURIComponent(qrUrl || absoluteShareUrl())}`}
              alt="QR code for this note"
              className="mx-auto mt-4 w-44 rounded-xl border border-[var(--border)] bg-white p-2"
            />
            <div className="mt-5 flex flex-col gap-2">
              <a href={`/api/qr?data=${encodeURIComponent(qrUrl || absoluteShareUrl())}&png=1`} download="memora-qr.png" className="btn btn-primary">Download QR</a>
              <button type="button" onClick={share} className="btn btn-secondary">Share link</button>
              <button type="button" onClick={() => copy(qrUrl || absoluteShareUrl(), "Link")} className="btn btn-secondary">Copy link</button>
              <button type="button" onClick={() => setQrOpen(false)} className="btn btn-ghost">Close</button>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className="anim-pop fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-[var(--ink)] px-4 py-2 text-sm text-[var(--bg)] shadow-lg">{toast}</div>
      ) : null}
    </div>
  );
}
