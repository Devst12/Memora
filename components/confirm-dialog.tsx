"use client";

// Styled, promise-based replacement for window.confirm / window.prompt.
// askDialog() resolves from the styled <DialogHost /> mounted in the root
// layout; if the host is missing, busy, or fails, it falls back to the native
// browser dialog so no flow can ever hang or get stuck.

import { useCallback, useEffect, useRef, useState } from "react";

export type DialogOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  initialValue?: string; // Providing one turns the dialog into a prompt.
  maxLength?: number;
};

type Pending = { options: DialogOptions; resolve: (value: string | null) => void };

let hostAsk: ((options: DialogOptions) => Promise<string | null>) | null = null;

// Native dialogs are the fallback of last resort — same answers, default look.
function nativeFallback(options: DialogOptions): Promise<string | null> {
  try {
    const text = [options.title, options.message].filter(Boolean).join("\n\n");
    if (typeof options.initialValue === "string") return Promise.resolve(window.prompt(text, options.initialValue));
    return Promise.resolve(window.confirm(text) ? "" : null);
  } catch {
    return Promise.resolve(null);
  }
}

export function askDialog(options: DialogOptions): Promise<string | null> {
  if (!hostAsk) return nativeFallback(options);
  return hostAsk(options).catch(() => nativeFallback(options));
}

/** Resolves true when the user confirms, false on cancel. */
export function confirmDialog(options: Omit<DialogOptions, "initialValue">): Promise<boolean> {
  return askDialog(options).then((value) => value !== null);
}

/** Resolves the entered string, or null when cancelled. */
export function promptDialog(options: DialogOptions & { initialValue: string }): Promise<string | null> {
  return askDialog(options);
}

export function DialogHost() {
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);

  const settle = useCallback((value: string | null) => {
    pendingRef.current?.resolve(value);
    pendingRef.current = null;
    setPending(null);
  }, []);

  useEffect(() => {
    hostAsk = (options) => {
      if (pendingRef.current) return nativeFallback(options); // One dialog at a time; extras go native.
      return new Promise((resolve) => {
        const next = { options, resolve };
        pendingRef.current = next;
        setPending(next);
      });
    };
    return () => {
      hostAsk = null;
      const active = pendingRef.current;
      if (active) nativeFallback(active.options).then(active.resolve); // Don't strand the caller if the host unmounts.
      pendingRef.current = null;
      setPending(null);
    };
  }, []);

  useEffect(() => {
    if (!pending) return;
    function onKey(event: KeyboardEvent) { if (event.key === "Escape") settle(null); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, settle]);

  if (!pending) return null;
  const { options } = pending;
  const isPrompt = typeof options.initialValue === "string";
  const danger = options.tone === "danger";
  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[#131a12]/40 px-4 py-8 backdrop-blur-[2px]"
      onMouseDown={(event) => { if (event.target === event.currentTarget) settle(null); }}
    >
      <form
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="memora-dialog-title"
        aria-describedby={options.message ? "memora-dialog-message" : undefined}
        onSubmit={(event) => { event.preventDefault(); settle(options.initialValue ?? ""); }}
        className="anim-pop w-full max-w-sm rounded-3xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-[var(--shadow-pop)]"
      >
        <h2 id="memora-dialog-title" className="text-lg font-semibold tracking-tight">{options.title}</h2>
        {options.message && <p id="memora-dialog-message" className="mt-1.5 text-sm leading-6 text-[var(--ink-soft)]">{options.message}</p>}
        {isPrompt && <input name="value" defaultValue={options.initialValue} maxLength={options.maxLength ?? 200} autoFocus aria-label={options.title} className="input mt-4 w-full" />}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={() => settle(null)} className="secondary">{options.cancelLabel || "Cancel"}</button>
          <button type="submit" autoFocus={!isPrompt} className={danger ? "rounded-xl bg-[var(--danger)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90" : "primary"}>
            {options.confirmLabel || "Confirm"}
          </button>
        </div>
      </form>
    </div>
  );
}
