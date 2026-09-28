// Floating "Save to Memora" side button injected into every page.
// One click saves the current page (or right-clicked link) instantly with an on-screen toast.

const HOST_ID = "memora-float-root";
const TOAST_MS = 3500;
const EDGE_MARGIN = 18;

let shadowRoot = null;
let hideTimer = null;

function ensureShadow() {
  const existing = document.getElementById(HOST_ID);
  if (existing && shadowRoot) return { host: existing, root: shadowRoot };
  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;all:initial;";
  document.documentElement.appendChild(host);
  shadowRoot = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    .m-fab{position:fixed;right:${EDGE_MARGIN}px;top:58%;width:46px;height:46px;border-radius:50%;border:1px solid rgba(255,255,255,.25);
      background:linear-gradient(145deg,#3d5a44,#2c4032);color:#fff;font:700 20px/44px system-ui,sans-serif;text-align:center;cursor:pointer;
      box-shadow:0 6px 20px rgba(0,0,0,.35);opacity:.82;transition:opacity .15s,transform .15s,background .15s;user-select:none;-webkit-user-select:none}
    .m-fab:hover{opacity:1;transform:scale(1.08)}
    .m-fab.busy{opacity:1;pointer-events:none;background:#6b7280}
    .m-fab.ok{background:linear-gradient(145deg,#4f7d58,#3a5c42)}
    .m-fab.err{background:linear-gradient(145deg,#a35445,#7f4034)}
    .m-toast{position:fixed;right:${EDGE_MARGIN + 8}px;top:calc(58% + 56px);max-width:320px;background:#20251f;color:#f3f4f1;border-radius:14px;
      padding:12px 14px;font:13px/1.45 system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.4);opacity:0;transform:translateY(6px);
      transition:opacity .18s,transform .18s;pointer-events:none;display:flex;gap:10px;align-items:flex-start}
    .m-toast.show{opacity:1;transform:translateY(0);pointer-events:auto}
    .m-thumb{width:44px;height:44px;border-radius:9px;object-fit:cover;background:#39423a;flex:0 0 auto}
    .m-t-title{font-weight:600;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
    .m-t-meta{margin-top:3px;font-size:11.5px;color:#a9b3a5}
  `;
  shadowRoot.appendChild(style);
  return { host, root: shadowRoot };
}let fabTop = null; // Persisted vertical position so the toast follows a dragged button.

function showToast(title, meta, thumb) {
  const { root } = ensureShadow();
  root.getElementById("m-toast")?.remove();
  const toast = document.createElement("div");
  toast.className = "m-toast";
  toast.id = "m-toast";
  if (thumb) {
    const img = document.createElement("img");
    img.className = "m-thumb";
    img.src = thumb;
    toast.appendChild(img);
  }
  const box = document.createElement("div");
  const t = document.createElement("div");
  t.className = "m-t-title";
  t.textContent = title;
  const m = document.createElement("div");
  m.className = "m-t-meta";
  m.textContent = meta;
  box.append(t, m);
  toast.appendChild(box);
  if (fabTop != null) toast.style.top = `calc(${fabTop}px + 56px)`;
  root.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  if (hideTimer) clearTimeout(hideTimer);
  if (saveTimer) clearTimeout(saveTimer);
  hideTimer = setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 250);
  }, TOAST_MS);
}

function setFab(state, glyph = "m") {
  const { root } = ensureShadow();
  const fab = root.getElementById("m-fab");
  if (!fab) return;
  fab.className = `m-fab${state === "idle" ? "" : ` ${state}`}`;
  fab.textContent = state === "busy" ? "…" : state === "ok" ? "✓" : state === "err" ? "!" : glyph;
}

function describe(result) {
  const chips = [result.categoryName, result.reason, ...(result.tags || []).slice(0, 2)]
    .filter(Boolean)
    .join("  ");
  return [result.platform, chips].filter(Boolean).join(" · ");
}

let saveTimer = null;
async function saveCurrentTarget(linkUrl) {
  if (saveTimer) return; // A save is already running; ignore repeat clicks until it settles.
  const url = linkUrl || location.href;
  const title = document.title || url.replace(/^https?:\/\//, "").split("/")[0];
  setFab("busy");
  try {
    const result = await chrome.runtime.sendMessage({ type: "memora-save", url, title });
    if (!result || !result.ok) {
      setFab("err");
      showToast(result?.message || "Couldn't save this page.", "Check your connection or open the Memora popup to reconnect.");
    } else {
      setFab(result.duplicate ? "idle" : "ok");
      showToast(
        result.duplicate ? result.title || "Already saved" : result.title || url,
        (result.duplicate ? "Already in your memory · " : "Saved · ") + describe(result),
        result.thumbnailUrl
      );
    }
  } catch {
    setFab("err");
    showToast("Memora isn't connected.", "Open the extension popup and add your capture token.");
  }
  saveTimer = setTimeout(() => { saveTimer = null; setFab("idle"); }, 1600);
}

function mount() {
  const { root } = ensureShadow();
  if (root.getElementById("m-fab")) return;
  const fab = document.createElement("div");
  fab.id = "m-fab";
  fab.className = "m-fab";
  fab.textContent = "m";
  fab.title = "Save to Memora";
  // Drag vertically along the right edge so it never blocks content; a real drag must not trigger a save.
  let dragging = false, moved = false, startY = 0, startTop = 0;
  fab.addEventListener("pointerdown", (event) => {
    dragging = true;
    moved = false;
    startY = event.clientY;
    startTop = fab.getBoundingClientRect().top;
    fab.setPointerCapture(event.pointerId);
  });
  fab.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const delta = event.clientY - startY;
    if (Math.abs(delta) > 6) moved = true;
    if (moved) {
      const max = window.innerHeight - 56;
      fab.style.top = `${Math.min(Math.max(startTop + delta, 12), max)}px`;
    }
  });
  fab.addEventListener("pointerup", () => { dragging = false; });
  fab.addEventListener("click", (event) => {
    if (moved) { moved = false; return; } // drag ended here — don't treat as a click
    event.preventDefault();
    event.stopPropagation();
    saveCurrentTarget();
  });
  // Remember vertical placement so the toast can anchor under a dragged fab.
  const anchorObserver = new MutationObserver(() => {
    fabTop = parseFloat(fab.style.top) || null;
  });
  anchorObserver.observe(fab, { attributes: true, attributeFilter: ["style"] });
  root.appendChild(fab);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "memora-ping") {
    sendResponse({ alive: true });
    return;
  }
  // Background already saved (right-click menu): just show the outcome on screen.
  if (message?.type === "memora-show-result" && message.result) {
    const result = message.result;
    setFab(result.ok && !result.duplicate ? "ok" : result.ok ? "idle" : "err");
    showToast(
      result.duplicate ? result.title || "Already saved" : result.ok ? result.title || "Saved" : "Couldn't save",
      (result.duplicate ? "Already in your memory · " : result.ok ? "Saved · " : "") + describe(result),
      result.thumbnailUrl
    );
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = null; setFab("idle"); }, 1600);
  }
});

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
else mount();
