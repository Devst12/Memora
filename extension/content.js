// Floating "Save to Memora" side button injected into every page.
// One click saves the current page (or right-clicked link) instantly with an on-screen toast.
// The button face is the Memora logo bundled with the extension; save state shows as a small
// badge. Holding the button ~2 seconds opens the composer: post text, images and documents
// as a shareable note (public link + QR, or private). One click still saves as always.
// On SPA feeds (TikTok) the item's identity is read from the page itself with strict
// validation: the video nearest the viewport center is the one being watched, its ID is read
// from surrounding DOM or the page's hydration JSON, and a save only proceeds on a stable ID.
// When no identity can be found on a feed, the save is refused rather than storing a junk URL.

const HOST_ID = "memora-float-root";
const TOAST_MS = 3500;
const EDGE_MARGIN = 18;

let shadowRoot = null;
let hideTimer = null;
let saveTimer = null;
let fabTop = null; // Persisted vertical position so the toast follows a dragged button.
let lastSavedFeedId = ""; // Skip re-saves when the feed re-renders the same video.
let lastSaveWasDuplicate = false; // Re-click after a duplicate should show the duplicate, not the feed refusal.
let longPressTimer = null; // 2s hold opens the composer; cancelled by release, drag, or cancel events.
let suppressClick = false; // The click that ends a long-press must not also save the page.

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
    .m-fab{position:fixed;right:${EDGE_MARGIN}px;top:58%;width:46px;height:46px;border-radius:50%;border:1px solid rgba(255,255,255,.35);
      background:rgba(28,34,26,.78);cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.35);opacity:.88;
      transition:opacity .15s,transform .15s,background .15s;user-select:none;-webkit-user-select:none;padding:3px;box-sizing:border-box}
    .m-fab:hover{opacity:1;transform:scale(1.08)}
    .m-fab img{width:100%;height:100%;border-radius:50%;display:block;object-fit:contain;pointer-events:none}
    .m-fab.busy{opacity:1;pointer-events:none}
    .m-fab.busy img{animation:m-pulse 1s ease-in-out infinite}
    @keyframes m-pulse{0%,100%{opacity:.55}50%{opacity:1}}
    .m-fab .m-badge{position:absolute;right:-2px;bottom:-2px;width:16px;height:16px;border-radius:50%;color:#fff;font:700 11px/16px system-ui,sans-serif;text-align:center;display:none;box-shadow:0 1px 4px rgba(0,0,0,.4)}
    .m-fab.ok .m-badge{display:block;background:#4f7d58}
    .m-fab.err .m-badge{display:block;background:#a35445}
    .m-toast{position:fixed;right:${EDGE_MARGIN + 8}px;top:calc(58% + 56px);max-width:320px;background:#20251f;color:#f3f4f1;border-radius:14px;
      padding:12px 14px;font:13px/1.45 system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.4);opacity:0;transform:translateY(6px);
      transition:opacity .18s,transform .18s;pointer-events:none;display:flex;gap:10px;align-items:flex-start}
    .m-toast.show{opacity:1;transform:translateY(0);pointer-events:auto}
    .m-thumb{width:44px;height:44px;border-radius:9px;object-fit:cover;background:#39423a;flex:0 0 auto}
    .m-t-title{font-weight:600;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
    .m-t-meta{margin-top:3px;font-size:11.5px;color:#a9b3a5}
    .m-composer{position:fixed;right:${EDGE_MARGIN}px;bottom:20px;width:min(420px,calc(100vw - 32px));max-height:min(660px,calc(100vh - 48px));overflow:auto;
      background:#20251f;color:#f3f4f1;border-radius:18px;padding:16px;box-shadow:0 24px 70px -20px rgba(0,0,0,.65);
      font:13px/1.5 system-ui,sans-serif;z-index:2;animation:m-pop .18s cubic-bezier(.2,.9,.3,1.2) both}
    @keyframes m-pop{from{opacity:0;transform:translateY(10px) scale(.98)}to{opacity:1;transform:none}}
    .m-c-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
    .m-c-title{font-size:15px;font-weight:650}
    .m-c-close,.m-c-file-x{background:none;border:none;color:#a9b3a5;font-size:18px;line-height:1;cursor:pointer;padding:4px}
    .m-c-close:hover,.m-c-file-x:hover{color:#fff}
    .m-c-close:disabled{opacity:.4;cursor:wait}
    .m-c-input,.m-c-text,.m-c-select{width:100%;background:#181c16;border:1px solid #39423a;border-radius:10px;color:#f3f4f1;
      padding:9px 11px;font:inherit;outline:none;margin-bottom:8px;box-sizing:border-box}
    .m-c-input:focus,.m-c-text:focus,.m-c-select:focus{border-color:#7fa074}
    .m-c-text{min-height:110px;resize:vertical}
    .m-c-select{appearance:none;margin-bottom:0;width:auto;max-width:62%}
    .m-c-file-row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:2px 0 8px}
    .m-c-add{background:#2c332a;border:1px solid #39423a;color:#dce4d8;border-radius:9px;padding:7px 10px;font:inherit;font-size:12.5px;cursor:pointer}
    .m-c-add:hover{border-color:#7fa074}
    .m-c-file{display:flex;align-items:center;gap:8px;padding:6px 2px;border-bottom:1px solid #2c332a;font-size:12.5px}
    .m-c-file-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .m-c-file-state{color:#a9b3a5;font-size:11.5px;flex:none}
    .m-c-file-state.bad{color:#d99a8b}
    .m-c-note{min-height:18px;font-size:12px;color:#a9b3a5;margin:6px 0}
    .m-c-note.bad{color:#d99a8b}
    .m-c-post{width:100%;background:#4f7d58;color:#fff;border:none;border-radius:11px;padding:11px;font:inherit;font-weight:650;font-size:14px;cursor:pointer}
    .m-c-post:hover{background:#45704e}
    .m-c-post:disabled{opacity:.6;cursor:wait}
    .m-share{position:fixed;right:${EDGE_MARGIN}px;bottom:20px;width:264px;background:#20251f;color:#f3f4f1;border-radius:18px;padding:16px;
      box-shadow:0 24px 70px -20px rgba(0,0,0,.65);font:13px/1.5 system-ui,sans-serif;z-index:3;text-align:center;
      animation:m-pop .18s cubic-bezier(.2,.9,.3,1.2) both}
    .m-share-title{font-weight:650;margin-bottom:10px}
    .m-share-qr{width:150px;height:150px;background:#fff;border-radius:12px;padding:6px;box-sizing:border-box;display:block;margin:0 auto}
    .m-share-link{display:block;margin:8px 0 2px;color:#a9d0a4;font-size:11.5px;word-break:break-all;text-decoration:none}
    .m-share-link:hover{text-decoration:underline}
    .m-share-row{display:flex;gap:6px;margin-top:8px}
    .m-share-btn{flex:1;background:#2c332a;border:1px solid #39423a;color:#dce4d8;border-radius:9px;padding:7px 4px;font:inherit;font-size:12px;cursor:pointer}
    .m-share-btn:hover{border-color:#7fa074;color:#fff}
    .m-share-close{width:100%;margin-top:8px}
    .m-share-vis{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:10px;font-size:12px;color:#a9b3a5;text-align:left}
    .m-share-hint{margin-top:8px;font-size:11.5px;color:#8a938a;text-align:left}
  `;
  shadowRoot.appendChild(style);
  return { host, root: shadowRoot };
}

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
  hideTimer = setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 250);
  }, TOAST_MS);
}

function setFab(state) {
  const { root } = ensureShadow();
  const fab = root.getElementById("m-fab");
  if (!fab) return;
  fab.className = `m-fab${state === "idle" ? "" : ` ${state}`}`;
  const badge = fab.querySelector(".m-badge");
  if (badge) badge.textContent = state === "ok" ? "✓" : state === "err" ? "!" : "";
}

// ---- Composer (long-press on the floating button) -----------------------------------------
// Holding the button ~2 seconds opens a small panel: paste text, attach images
// (compressed hard in the browser first) or documents, choose public/private,
// then Post. The note gets a share link + QR code; the one-click save above is
// untouched.

const COMPRESS_TARGET_BYTES = 900 * 1024; // Per-image compression target (~<1MB).

let composerState = null; // { files: [{file, name, kind, size, status}], visibility: "public" }

// Offscreen-canvas re-encode: WebP first (smallest), quality and then size
// ratcheted down until the result fits the target. Quality never drops below
// 0.62, so a 60-70MB photo shrinks hard without turning into mush. Resolves
// null when the browser can't decode the file — the original is sent instead.
function compressImage(file) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
    createImageBitmap(file).then((bitmap) => {
      const longest = Math.max(bitmap.width, bitmap.height);
      let scale = Math.min(1, 2400 / longest);
      const attempt = (quality) => {
        if (settled) return;
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          if (settled || !blob) return;
          const ext = blob.type === "image/png" ? "png" : blob.type === "image/jpeg" ? "jpg" : "webp";
          if (blob.size <= COMPRESS_TARGET_BYTES || (quality <= 0.62 && scale <= 0.4)) { bitmap.close(); return finish({ blob, name: `image.${ext}` }); }
          if (quality > 0.62) attempt(Math.max(0.62, quality - 0.15));
          else if (scale > 0.4) { scale *= 0.75; attempt(0.8); }
          else { bitmap.close(); finish({ blob, name: `image.${ext}` }); }
        }, "image/webp", quality);
      };
      attempt(0.85);
    }).catch(() => resolve(null));
  });
}

function composerAddFiles(fileList) {
  if (!composerState) return;
  for (const file of Array.from(fileList || [])) {
    if (composerState.files.length >= 10) { composerNote("Up to 10 attachments per note.", true); break; }
    const isImage = /^image\//i.test(file.type) || /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(file.name);
    composerState.files.push({ file, name: file.name, kind: isImage ? "image" : "file", size: file.size, status: isImage ? "pending" : "ready" });
  }
  composerRenderFiles();
}

function composerRenderFiles() {
  const list = shadowRoot?.getElementById("m-c-files");
  if (!list || !composerState) return;
  list.textContent = "";
  composerState.files.forEach((entry, index) => {
    const row = document.createElement("div");
    row.className = "m-c-file";
    const label = document.createElement("span");
    label.className = "m-c-file-name";
    label.textContent = `${entry.kind === "image" ? "🖼" : "📄"} ${entry.name} (${Math.max(1, Math.round(entry.size / 1024))} KB)`;
    const state = document.createElement("span");
    state.className = "m-c-file-state";
    if (entry.status === "compressing") state.textContent = "compressing…";
    else if (entry.status === "uploading") state.textContent = "uploading…";
    else if (entry.status === "error") { state.textContent = entry.error || "failed"; state.classList.add("bad"); }
    const remove = document.createElement("button");
    remove.type = "button"; remove.className = "m-c-file-x"; remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove ${entry.name}`);
    remove.addEventListener("click", () => { composerState.files.splice(index, 1); composerRenderFiles(); });
    row.append(label, state, remove);
    list.appendChild(row);
  });
}

function composerNote(message, bad) {
  const el = shadowRoot?.getElementById("m-c-note");
  if (!el) return;
  el.textContent = message || "";
  el.classList.toggle("bad", Boolean(bad));
}

function closeComposer() {
  shadowRoot.getElementById("m-composer")?.remove();
  composerState = null;
}

function composerBusy(busy) {
  const button = shadowRoot.getElementById("m-c-post");
  if (button) { button.disabled = busy; button.textContent = busy ? "Posting…" : "Post"; }
  const close = shadowRoot.getElementById("m-c-close");
  if (close) close.disabled = busy;
}

// Fire the POST as soon as the note is stored — the server answers 202 while
// image uploads continue in the background, so this stays instant even with
// big files. Returns the share URL for the card below.
async function composerPost() {
  if (!composerState) return;
  const text = shadowRoot.getElementById("m-c-text").value.trim();
  const title = shadowRoot.getElementById("m-c-title").value.trim();
  if (!text && !composerState.files.length) { composerNote("Add some text or a file first."); return; }
  const { apiUrl, token } = await chrome.storage.local.get(["apiUrl", "token"]);
  if (!apiUrl) { composerNote("Open the Memora popup and connect first.", true); return; }
  composerBusy(true);
  composerNote("Preparing attachments…");
  const form = new FormData();
  form.append("text", text);
  form.append("title", title);
  form.append("visibility", composerState.visibility);
  form.append("sourceUrl", currentPageUrl() || location.href || "");
  form.append("sourceTitle", (currentPageTitle() || document.title || "").slice(0, 300));

  try {
    let uploadingName = "";
    let pending = 0;
    for (const entry of composerState.files) {
      if (entry.kind === "image") {
        entry.status = "compressing"; composerRenderFiles();
        const compressed = await compressImage(entry.file);
        const blob = compressed?.blob || entry.file;
        if (compressed) { entry.size = blob.size; entry.name = compressed.name; }
        entry.status = "uploading"; composerRenderFiles();
        pending += 1;
        if (!uploadingName) uploadingName = entry.name;
        form.append("files", new File([blob], entry.name, { type: blob.type || "image/webp" }));
      } else {
        if (entry.file.size > 8 * 1024 * 1024) throw new Error(`"${entry.name}" is over the 8MB limit for documents.`);
        form.append("files", entry.file);
      }
    }
    composerNote(pending ? `Uploading ${pending} image${pending > 1 ? "s" : ""}…` : "Posting…");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); // The 202 arrives fast; uploads continue server-side.
    let response, body = {};
    try {
      response = await fetch(`${apiUrl.replace(/\/+$/, "")}/api/notes`, {
        method: "POST",
        body: form,
        signal: controller.signal,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        credentials: "include",
      });
      try { body = await response.json(); } catch { /* The server's 202 hangup lands here — still a success. */ }
    } catch (error) {
      if (error?.name === "AbortError") { composerBusy(false); composerNote("Large upload still running — it will finish in the background. Check Memora in a moment.", true); return; }
      throw error;
    } finally { clearTimeout(timeout); }
    if (response.status === 202 || (response.ok && body.async)) body.ok = true;
    if (!response.ok && response.status !== 202) throw new Error(body.error || `Couldn't post (HTTP ${response.status}).`);
    closeComposer();
    setFab("ok");
    showToast("Note posted ✓", uploadingName ? `Uploading "${uploadingName}" finishes in the background.` : "Use the link or QR code to share it.", "");
    showShareCard({ shareUrl: body.shareUrl, slug: body.slug, id: body.id }, uploadingName);
    setTimeout(() => setFab("idle"), 2400);
  } catch (error) {
    composerBusy(false);
    composerNote(error?.message || "Couldn't post the note.", true);
  }
}

// Bottom card with the QR code, the link, and quick actions — shown right
// after a note is posted so sharing is one glance away.
function showShareCard({ shareUrl, slug, id }, uploadingName) {
  const { root } = ensureShadow();
  root.getElementById("m-share")?.remove();
  chrome.storage.local.get(["apiUrl"]).then(({ apiUrl }) => {
    const origin = (apiUrl || "").replace(/\/+$/, "");
    const url = `${origin}${shareUrl || `/s/${slug || id}`}`;
    const card = document.createElement("div");
    card.className = "m-share";
    card.id = "m-share";
    const title = document.createElement("div");
    title.className = "m-share-title";
    title.textContent = "Note posted — share it";
    const qr = document.createElement("img");
    qr.className = "m-share-qr";
    qr.alt = "QR code";
    qr.src = `${origin}/api/qr?data=${encodeURIComponent(url)}`;
    const link = document.createElement("a");
    link.className = "m-share-link";
    link.href = url; link.target = "_blank"; link.rel = "noopener";
    link.textContent = url;
    const mkButton = (label, onClick) => {
      const button = document.createElement("button");
      button.type = "button"; button.className = "m-share-btn"; button.textContent = label;
      button.addEventListener("click", onClick);
      return button;
    };
    const row = document.createElement("div");
    row.className = "m-share-row";
    row.append(
      mkButton("Copy link", async () => { try { await navigator.clipboard.writeText(url); } catch { /* Clipboard can be blocked; the link is visible above. */ } }),
      mkButton("Open", () => window.open(url, "_blank", "noopener")),
      mkButton("Save QR", async () => {
        try {
          const response = await fetch(`${origin}/api/qr?data=${encodeURIComponent(url)}&png=1`);
          const blob = await response.blob();
          const objectUrl = URL.createObjectURL(blob);
          const anchor = document.createElement("a");
          anchor.href = objectUrl; anchor.download = "memora-qr.png"; anchor.click();
          setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
        } catch { window.open(`${origin}/api/qr?data=${encodeURIComponent(url)}&png=1`, "_blank", "noopener"); }
      }),
    );
    const visRow = document.createElement("div");
    visRow.className = "m-share-vis";
    const visLabel = document.createElement("span");
    visLabel.textContent = "🌍 Public — anyone with the link";
    const visToggle = mkButton("Make private", async () => {
      if (!id) { visLabel.textContent = "Sign in to Memora to change visibility."; return; }
      const next = visToggle.dataset.vis === "public" ? "private" : "public";
      try {
        const response = await fetch(`${origin}/api/notes/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ visibility: next }),
        });
        if (!response.ok) throw new Error();
        visToggle.dataset.vis = next;
        visToggle.textContent = next === "public" ? "Make private" : "Make public";
        visLabel.textContent = next === "public" ? "🌍 Public — anyone with the link" : "🔒 Private — only you";
      } catch { visLabel.textContent = "Couldn't change visibility — sign in to Memora first."; }
    });
    visToggle.dataset.vis = "public";
    if (!id) visToggle.disabled = true;
    visRow.append(visLabel, visToggle);
    const hint = document.createElement("div");
    hint.className = "m-share-hint";
    hint.textContent = uploadingName ? `"${uploadingName}" finishes uploading in the background.` : "Anyone with this link or QR can view and download the note.";
    const close = mkButton("Close", () => card.remove());
    close.classList.add("m-share-close");
    card.append(title, qr, link, row, visRow, hint, close);
    root.appendChild(card);
  });
}

function openComposer() {
  const { root } = ensureShadow();
  if (root.getElementById("m-composer")) return;
  composerState = { files: [], visibility: "public" };
  const panel = document.createElement("div");
  panel.className = "m-composer";
  panel.id = "m-composer";

  const header = document.createElement("div");
  header.className = "m-c-header";
  const heading = document.createElement("div");
  heading.className = "m-c-title";
  heading.textContent = "Post to Memora";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "m-c-close";
  close.id = "m-c-close";
  close.textContent = "×";
  close.setAttribute("aria-label", "Close composer");
  close.addEventListener("click", closeComposer);
  header.append(heading, close);

  const title = document.createElement("input");
  title.className = "m-c-input";
  title.id = "m-c-title";
  title.placeholder = "Title (optional)";
  title.maxLength = 300;

  const textarea = document.createElement("textarea");
  textarea.className = "m-c-text";
  textarea.id = "m-c-text";
  textarea.placeholder = "Paste text or notes…";
  textarea.maxLength = 50000;

  const fileRow = document.createElement("div");
  fileRow.className = "m-c-file-row";
  const fileButton = document.createElement("button");
  fileButton.type = "button";
  fileButton.className = "m-c-add";
  fileButton.textContent = "+ Add images or files";
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.multiple = true;
  fileInput.accept = "image/*,.pdf,.doc,.docx,.txt,.md,.csv,.json,.rtf,.xls,.xlsx,.ppt,.pptx";
  fileInput.style.display = "none";
  fileInput.addEventListener("change", () => { composerAddFiles(fileInput.files); fileInput.value = ""; });
  fileButton.addEventListener("click", () => fileInput.click());
  const visibility = document.createElement("select");
  visibility.className = "m-c-select";
  visibility.innerHTML = `<option value="public">🌍 Public — anyone with the link</option><option value="private">🔒 Private — only you</option>`;
  visibility.addEventListener("change", () => { if (composerState) composerState.visibility = visibility.value; });
  fileRow.append(fileButton, visibility);

  const files = document.createElement("div");
  files.className = "m-c-files";
  files.id = "m-c-files";

  const note = document.createElement("div");
  note.className = "m-c-note";
  note.id = "m-c-note";

  const post = document.createElement("button");
  post.type = "button";
  post.className = "m-c-post";
  post.id = "m-c-post";
  post.textContent = "Post";
  post.addEventListener("click", composerPost);

  panel.addEventListener("keydown", (event) => { if (event.key === "Escape") closeComposer(); });
  panel.append(header, title, textarea, fileRow, fileInput, files, note, post);
  root.appendChild(panel);
  setTimeout(() => textarea.focus(), 30);
}

function describe(result) {
  const chips = [result.categoryName, result.reason, ...(result.tags || []).slice(0, 2)]
    .filter(Boolean)
    .join("  ");
  return [result.platform, chips].filter(Boolean).join(" · ");
}

// ---- TikTok / SPA feed identity detection -----------------------------------------------
// TikTok's feed keeps several videos loaded (previous, current, next) and never changes the
// address bar while you swipe. The video being watched is the one nearest the viewport center.

function isTikTok() {
  const host = location.hostname.replace(/^www\./, "");
  return host === "tiktok.com" || host.endsWith(".tiktok.com");
}

function isDouyin() {
  return /(^|\.)douyin\.com$/.test(location.hostname);
}

// Either of these is a ByteDance-style feed with no per-item URL by default.
function isFeedPlatform() {
  return isTikTok() || isDouyin();
}

// The <video> closest to the viewport center is the one the user is watching. Measured on
// demand (no observers, no timers) — cheap and always current at click time.
function activeVideo() {
  const videos = document.querySelectorAll("video");
  let best = null, bestDistance = Infinity;
  const centerY = window.innerHeight / 2;
  for (const video of videos) {
    const rect = video.getBoundingClientRect();
    if (rect.height < 40) continue; // Preload slots are tiny or zero-height.
    const distance = Math.abs(rect.top + rect.height / 2 - centerY);
    if (distance < bestDistance) { bestDistance = distance; best = video; }
  }
  return best;
}

// ---- Identity sources, best first ---------------------------------------------------------
// 1. Address bar on a real video page (/@user/video/<id>) — exact.
// 2. React props of the active <video> (asked from inject.js in the page's own JS world) — exact.
// 3. Feed-API items seen by inject.js, matched to the on-screen author + caption — good.
// 4. The <a href="/@user/video/<id>"> inside the active video's own feed card — sometimes present.
// The old hydration-JSON lookup is gone: on the feed it only describes the first video loaded.

const VIDEO_ID = /^\d{17,20}$/;
const tapItems = new Map(); // id -> { author, id, caption } from feed API responses

window.addEventListener("memora-tiktok-item", (event) => {
  try {
    const item = typeof event.detail === "string" ? JSON.parse(event.detail) : event.detail;
    if (item?.id && VIDEO_ID.test(item.id)) tapItems.set(item.id, item);
  } catch { /* Malformed announcement; ignore. */ }
});
// inject.js runs at document_start, this script at document_idle: ask for anything already seen.
window.dispatchEvent(new CustomEvent("memora-tiktok-replay"));

function identityFromLocation() {
  const tiktok = location.pathname.match(/^\/@([^/]+)\/video\/(\d{17,20})/);
  if (tiktok) return { author: tiktok[1], id: tiktok[2] };
  // Douyin's direct video page needs no username: douyin.com/video/<id>.
  const douyinPath = location.pathname.match(/^\/video\/(\d{17,20})/);
  if (douyinPath) return { author: null, id: douyinPath[1] };
  // Douyin's feed opens a video as an overlay without changing the path, but stamps the id
  // into a modal_id query param (e.g. /?recommend=1&modal_id=712...). Confirmed via Douyin's
  // own yt-dlp integration, which normalizes these same URLs before download.
  const modalId = new URLSearchParams(location.search).get("modal_id");
  if (modalId && /^\d{17,20}$/.test(modalId)) return { author: null, id: modalId };
  return null;
}

function identityFromReact(video) {
  if (!video) return null;
  let raw = "";
  const onResolved = (event) => { raw = event.detail || ""; };
  window.addEventListener("memora-tiktok-resolved", onResolved);
  video.setAttribute("data-memora-active", "1");
  try { window.dispatchEvent(new CustomEvent("memora-tiktok-resolve")); }
  finally {
    video.removeAttribute("data-memora-active");
    window.removeEventListener("memora-tiktok-resolved", onResolved);
  }
  try {
    const item = raw ? JSON.parse(raw) : null;
    if (item?.id && VIDEO_ID.test(item.id)) return item;
  } catch { /* Fall through to the next source. */ }
  return null;
}

function cardOf(video) {
  return video?.closest("article, [data-e2e='recommend-list-item-container']") || video?.parentElement?.parentElement || null;
}

function identityFromTap(video) {
  const card = cardOf(video);
  if (!card || !tapItems.size) return null;
  const norm = (text) => String(text || "").replace(/\s+/g, " ").trim().toLowerCase();
  const shownAuthor = norm(card.querySelector("[data-e2e='video-author-uniqueid'], [data-e2e='browse-username']")?.textContent).replace(/^@/, "");
  const shownCaption = norm(card.querySelector("[data-e2e='video-desc'], [data-e2e='browse-video-desc']")?.textContent);
  let best = null;
  for (const item of tapItems.values()) {
    if (shownAuthor && norm(item.author) !== shownAuthor) continue;
    const caption = norm(item.caption);
    if (shownCaption && caption && (shownCaption.startsWith(caption.slice(0, 30)) || caption.startsWith(shownCaption.slice(0, 30)))) return item;
    if (!best && shownAuthor && !shownCaption && !caption) best = item;
  }
  return best;
}

function identityFromCardLink(video) {
  const card = cardOf(video);
  const href = card?.querySelector("a[href*='/video/']")?.getAttribute("href") || "";
  const match = href.match(/\/@([^/?#]+)\/video\/(\d{17,20})/);
  return match ? { author: match[1], id: match[2] } : null;
}

// Returns { url, title, id } for the video being watched, or { refused: true } when nothing
// resolves. Refusing beats saving tiktok.com junk the user can never reopen.
let feedMemo = null, feedMemoAt = 0;
function currentFeedItem() {
  if (!isTikTok()) return null;
  const now = Date.now();
  if (feedMemo && now - feedMemoAt < 400) return feedMemo;
  feedMemo = computeFeedItem();
  feedMemoAt = now;
  return feedMemo;
}

function computeFeedItem() {
  const video = activeVideo();
  const found = identityFromLocation() || identityFromReact(video) || identityFromTap(video) || identityFromCardLink(video);
  if (!found?.id) return { refused: true };
  const author = found.author || tapItems.get(found.id)?.author || null;
  // TikTok's canonical link needs the author in the path; Douyin's doesn't. Only TikTok refuses
  // without one — building a wrong TikTok URL is worse than a Douyin link missing the author name.
  if (isTikTok() && !author) return { refused: true };
  const caption = found.caption || tapItems.get(found.id)?.caption || "";
  const url = isDouyin() ? `${location.origin}/video/${found.id}` : `${location.origin}/@${author}/video/${found.id}`;
  return {
    id: found.id,
    author,
    url,
    title: caption || cardOf(video)?.querySelector("[data-e2e='video-desc'], [data-e2e='browse-video-desc']")?.textContent?.trim().slice(0, 300) || "",
  };
}

// Public, stable permalink shapes these platforms use for "share this post" links. Unlike the
// TikTok/Douyin feed work, this needs no DOM or React digging: the address bar already carries
// the exact item the moment the user opens one directly (from search, a profile, a shared link,
// or clicking into it from a feed). It only misses the case where someone never clicks in and
// the URL never changes at all — raw infinite scroll — which is what the per-site work is for.
const DIRECT_ITEM_PATTERNS = [
  { host: /(^|\.)instagram\.com$/, path: /^\/(p|reel|reels|tv)\/[A-Za-z0-9_-]+/ },
  { host: /(^|\.)(x|twitter)\.com$/, path: /^\/[^/]+\/status\/\d+/ },
  { host: /(^|\.)facebook\.com$/, path: /^\/(watch\/|reel\/|[^/]+\/(videos|posts)\/)/ },
  { host: /(^|\.)pinterest\.[a-z.]+$/, path: /^\/pin\/\d+/ },
  { host: /(^|\.)reddit\.com$/, path: /^\/r\/[^/]+\/comments\/[a-z0-9]+/ },
  { host: /(^|\.)linkedin\.com$/, path: /^\/(posts\/|feed\/update\/)/ },
  { host: /(^|\.)threads\.net$/, path: /^\/@[^/]+\/post\/[A-Za-z0-9_-]+/ },
];

function directItemUrl() {
  const matched = DIRECT_ITEM_PATTERNS.some((p) => p.host.test(location.hostname) && p.path.test(location.pathname));
  if (!matched) return null;
  // Tracking params (igshid, si, utm_*...) make the same post look like a new URL every time
  // it's shared, so duplicate detection would never catch it. The item's own path already
  // carries the id for every pattern above except Facebook's /watch/?v=<id>, so drop the query
  // string everywhere else.
  const idIsInQuery = /^\/watch\/?$/.test(location.pathname) && new URLSearchParams(location.search).has("v");
  return idIsInQuery ? `${location.origin}${location.pathname}${location.search}` : `${location.origin}${location.pathname}`;
}

// Non-feed pages (a direct TikTok video URL, or any other site): the tab URL is the identity.
function currentPageUrl() {
  const direct = directItemUrl();
  if (direct) return direct;

  if (isFeedPlatform()) {
    const feedItem = currentFeedItem();
    if (feedItem?.refused) return null;
    if (feedItem?.url) return feedItem.url;
  }
  try {
    const copyField = document.querySelector("[data-e2e='copy-link-input']");
    if (copyField?.value && /(tiktok|douyin)\.com/.test(copyField.value)) return copyField.value;
    const canonical = document.querySelector("link[rel='canonical']")?.href || document.querySelector("meta[property='og:url']")?.content;
    if (canonical && /\/video\/\d{17,20}/.test(canonical)) return canonical;
  } catch { /* Fall through to the plain tab URL. */ }
  return null;
}

// Visible words from the live page that static metadata fetching can't see (SPAs render
// client-side). Headings, meta keywords, and hashtags give the categorizer real context.
function pageKeywords() {
  const words = new Set();
  const add = (value) => {
    for (const word of String(value || "").toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, " ").split(/\s+/)) {
      if (word.length >= 3 && word.length <= 24 && words.size < 12) words.add(word);
    }
  };
  document.querySelectorAll("h1, h2, [itemprop='keywords'], meta[name='keywords']").forEach((el) => {
    add(el.getAttribute?.("content") || el.textContent);
  });
  for (const match of document.title.matchAll(/#(\w{3,24})/g)) add(match[1]);
  for (const match of pageMetaDescription().matchAll(/#(\w{3,24})/g)) add(match[1]);
  return [...words].slice(0, 12);
}

// The item's real title on SPA feeds lives in the page, not document.title (which stays
// "TikTok - Make Your Day"). Probes stay site-specific and best-effort.
function currentPageTitle() {
  try {
    const structured = pageStructuredData();
    if (directItemUrl() && structured?.title) return structured.title;
    if (isFeedPlatform()) {
      const feedItem = currentFeedItem();
      if (feedItem?.title) return feedItem.title;
    }
  } catch { /* Fall through to document.title. */ }
  return document.title || "";
}

// The rendered video's poster frame — the server can't fetch TikTok previews, but the page
// already has the image loaded, so send it along for the card thumbnail.
function currentPageThumbnail() {
  try {
    const video = activeVideo() || document.querySelector("video[poster]");
    if (video?.poster && /^https:\/\//.test(video.poster)) return video.poster;
    const img = document.querySelector("img[src*='thumbnail'], img[src*='/aweme/']");
    const src = img?.getAttribute("src");
    if (src && /^https:\/\//.test(src)) return src;
    const og = document.querySelector("meta[property='og:image'], meta[name='twitter:image']")?.getAttribute("content");
    if (og && /^https:\/\//.test(og)) return og;
    const structured = pageStructuredData();
    if (structured?.thumbnailUrl && /^https:\/\//.test(structured.thumbnailUrl)) return structured.thumbnailUrl;
  } catch { /* No thumbnail is fine — the card falls back to the platform icon. */ }
  return "";
}

// General-purpose description/author for every site, not just TikTok. Most sites — even
// JS-heavy ones a server-side fetch can't render — put these in <meta> tags the browser has
// already parsed by the time this script runs, so reading them here works far more broadly
// than trying to write a scraper per site.
// Structured data (schema.org JSON-LD) is how search engines get exact facts about a page, so
// most content platforms that care about SEO — YouTube, Pinterest, many news and shopping sites,
// and plenty of others — embed it whether or not their normal meta tags are any good. Reading it
// gives a real title/caption/author for pages the plain meta-tag pass alone would miss.
function pageStructuredData() {
  try {
    for (const node of document.querySelectorAll('script[type="application/ld+json"]')) {
      let parsed;
      try { parsed = JSON.parse(node.textContent || ""); } catch { continue; }
      for (const entry of Array.isArray(parsed) ? parsed : [parsed]) {
        const type = String(entry?.["@type"] || "");
        if (/VideoObject|ImageObject|Article|SocialMediaPosting|CreativeWork/i.test(type)) {
          const author = entry.author?.name || (typeof entry.author === "string" ? entry.author : "") || entry.creator?.name || "";
          return {
            title: String(entry.name || entry.headline || "").trim().slice(0, 300),
            description: String(entry.description || "").trim().slice(0, 2000),
            author: String(author).trim().slice(0, 120),
            thumbnailUrl: (Array.isArray(entry.thumbnailUrl) ? entry.thumbnailUrl[0] : entry.thumbnailUrl) || (Array.isArray(entry.image) ? entry.image[0] : entry.image) || "",
          };
        }
      }
    }
  } catch { /* Not every site publishes this; the meta-tag pass still runs either way. */ }
  return null;
}

function pageMetaDescription() {
  try {
    const structured = pageStructuredData();
    if (structured?.description) return structured.description;
    const el = document.querySelector("meta[property='og:description'], meta[name='twitter:description'], meta[name='description']");
    return el?.getAttribute("content")?.trim().slice(0, 2000) || "";
  } catch { return ""; }
}

function pageMetaAuthor() {
  try {
    const structured = pageStructuredData();
    if (structured?.author) return structured.author;
    const el = document.querySelector("meta[name='author'], meta[property='article:author'], meta[property='og:site_name']");
    return el?.getAttribute("content")?.trim().slice(0, 120) || "";
  } catch { return ""; }
}

// ---- Saving -------------------------------------------------------------------------------

async function saveCurrentTarget(linkUrl) {
  if (saveTimer) return; // A save is already running; ignore repeat clicks until it settles.
  setFab("busy");

  // Right-clicked links save directly; feed pages need a stable, resolvable video identity.
  if (!linkUrl && isFeedPlatform()) {
    const feedItem = currentFeedItem();
    if (feedItem?.refused) {
      if (lastSaveWasDuplicate && lastSavedFeedId) {
        lastSaveWasDuplicate = false; // The feed re-rendered the already-saved video; report that.
        showToast("Already saved", "This video is in your memory — scroll for the next one.", "");
      } else {
        showToast("No video detected yet.", "TikTok is still loading this one — click again in a moment.", "");
      }
      saveTimer = setTimeout(() => { saveTimer = null; setFab("idle"); }, 1200);
      return;
    }
    if (feedItem.id === lastSavedFeedId) {
      showToast("Already saved", "This video is in your memory — scroll for the next one.", "");
      saveTimer = setTimeout(() => { saveTimer = null; setFab("idle"); }, 1200);
      return;
    }
  }

  try {
    const target = !linkUrl && isFeedPlatform() ? currentFeedItem() : null;
    const result = await chrome.runtime.sendMessage({
      type: "memora-save",
      url: linkUrl || target?.url || currentPageUrl() || null, // null = let the background resolve the tab URL
      title: target ? target.title : currentPageTitle() || document.title || "",
      author: target?.author || pageMetaAuthor(),
      description: target ? target.title : pageMetaDescription(),
      keywords: pageKeywords(),
      thumbnailUrl: currentPageThumbnail(),
    });
    if (result === undefined) {
      // The service worker didn't answer: it was reloaded/updated after this page loaded, so
      // this content script belongs to a dead extension context. Reload fixes it.
      setFab("err");
      showToast("Memora was updated — reload this page.", "Press F5 (or Ctrl+R) and the button will work again.", "");
    } else if (!result || !result.ok) {
      setFab("err");
      showToast(result?.message || "Couldn't save this page.", "Check your connection or open the Memora popup to reconnect.");
    } else {
      setFab(result.duplicate ? "idle" : "ok");
      if (!linkUrl && isFeedPlatform()) {
        const feedItem = currentFeedItem();
        if (feedItem?.id) {
          lastSavedFeedId = feedItem.id;
          lastSaveWasDuplicate = Boolean(result.duplicate);
        }
      }
      showToast(
        result.duplicate ? result.title || "Already saved" : result.title || "Saved",
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
  fab.title = "Save to Memora";
  // The Memora logo (bundled with the extension) is the button face; a small badge shows save state.
  const logo = document.createElement("img");
  logo.src = chrome.runtime.getURL("icon48.png");
  logo.alt = "";
  const badge = document.createElement("span");
  badge.className = "m-badge";
  fab.append(logo, badge);
  // Drag vertically along the right edge so it never blocks content; a real drag must not trigger a save.
  let dragging = false, moved = false, startY = 0, startTop = 0;
  const cancelLongPress = () => { if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; } };
  fab.addEventListener("pointerdown", (event) => {
    dragging = true;
    moved = false;
    suppressClick = false;
    startY = event.clientY;
    startTop = fab.getBoundingClientRect().top;
    fab.setPointerCapture(event.pointerId);
    // Hold ~2s to open the composer; a quick release still saves instantly.
    cancelLongPress();
    longPressTimer = setTimeout(() => {
      longPressTimer = null;
      suppressClick = true; // The click that ends this hold must not save.
      openComposer();
    }, 2000);
  });
  fab.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const delta = event.clientY - startY;
    if (Math.abs(delta) > 6) { moved = true; cancelLongPress(); } // Dragging cancels the hold.
    if (moved) {
      const max = window.innerHeight - 56;
      fab.style.top = `${Math.min(Math.max(startTop + delta, 12), max)}px`;
    }
  });
  fab.addEventListener("pointerup", () => { dragging = false; cancelLongPress(); });
  fab.addEventListener("pointercancel", () => { dragging = false; cancelLongPress(); });
  fab.addEventListener("click", (event) => {
    if (suppressClick) { suppressClick = false; return; } // Long-press just opened the composer.
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
  // Popup asks for the current item's real URL/title on SPA pages before opening its form.
  if (message?.type === "memora-context") {
    sendResponse({ url: currentPageUrl(), title: currentPageTitle(), keywords: pageKeywords(), thumbnailUrl: currentPageThumbnail() });
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