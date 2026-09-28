// Floating "Save to Memora" side button injected into every page.
// One click saves the current page (or right-clicked link) instantly with an on-screen toast.
// The button face is the Memora logo bundled with the extension; save state shows as a small
// badge. On SPA feeds (TikTok) the item's identity is read from the page itself with strict
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
  const match = location.pathname.match(/^\/@([^/]+)\/video\/(\d{17,20})/);
  return match ? { author: match[1], id: match[2] } : null;
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
  if (!author) return { refused: true }; // Building /video/<id> without an author guesses wrong.
  const caption = found.caption || tapItems.get(found.id)?.caption || "";
  return {
    id: found.id,
    author,
    url: `${location.origin}/@${author}/video/${found.id}`,
    title: caption || cardOf(video)?.querySelector("[data-e2e='video-desc'], [data-e2e='browse-video-desc']")?.textContent?.trim().slice(0, 300) || "",
  };
}

// Non-feed pages (a direct TikTok video URL, or any other site): the tab URL is the identity.
function currentPageUrl() {
  if (isTikTok()) {
    const feedItem = currentFeedItem();
    if (feedItem?.refused) return null;
    if (feedItem?.url) return feedItem.url;
  }
  try {
    const copyField = document.querySelector("[data-e2e='copy-link-input']");
    if (copyField?.value && /tiktok\.com/.test(copyField.value)) return copyField.value;
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
  return [...words].slice(0, 12);
}

// The item's real title on SPA feeds lives in the page, not document.title (which stays
// "TikTok - Make Your Day"). Probes stay site-specific and best-effort.
function currentPageTitle() {
  try {
    if (isTikTok()) {
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
  } catch { /* No thumbnail is fine — the card falls back to the platform icon. */ }
  return "";
}

// ---- Saving -------------------------------------------------------------------------------

async function saveCurrentTarget(linkUrl) {
  if (saveTimer) return; // A save is already running; ignore repeat clicks until it settles.
  setFab("busy");

  // Right-clicked links save directly; feed pages need a stable, resolvable video identity.
  if (!linkUrl && isTikTok()) {
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
    const target = !linkUrl && isTikTok() ? currentFeedItem() : null;
    const result = await chrome.runtime.sendMessage({
      type: "memora-save",
      url: linkUrl || target?.url || currentPageUrl() || null, // null = let the background resolve the tab URL
      title: target ? target.title : currentPageTitle() || document.title || "",
      author: target?.author || "",
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
      if (!linkUrl && isTikTok()) {
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