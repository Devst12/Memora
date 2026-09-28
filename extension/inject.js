// Runs in the page's MAIN world on TikTok (declared in the manifest). TikTok fetches its feed
// through the page's own fetch/XHR — data the isolated content script can't see. This tap
// intercepts those responses, pulls out video items (author + id + caption + cover), and
// announces each one on a DOM event the content script listens for. No network requests of
// its own, no storage — a pure observer.
(function () {
  if (window.__memoraTapInstalled) return;
  window.__memoraTapInstalled = true;

  const FEED_URL = /\/api\/(feed|item|recommend|passthrough|post\/item_list)|item_list|aweme\/v1\/feed/i;

  const buffer = new Map(); // id -> detail; content.js loads later (document_idle) and asks for a replay.

  function authorOf(item) {
    const a = item?.author;
    return (typeof a === "string" ? a : a?.uniqueId || a?.uniqueID) || item?.authorInfo?.uniqueId || null;
  }

  function toDetail(item) {
    return {
      author: authorOf(item),
      id: String(item?.id || item?.video?.id || item?.aweme_id || ""),
      caption: item?.desc ? String(item.desc).slice(0, 300) : "",
    };
  }

  function emit(item) {
    try {
      const detail = toDetail(item);
      buffer.set(detail.id, detail);
      if (buffer.size > 300) buffer.delete(buffer.keys().next().value);
      window.dispatchEvent(new CustomEvent("memora-tiktok-item", { detail: JSON.stringify(detail) }));
    } catch { /* The listener is torn down during navigation; the next response re-announces. */ }
  }

  window.addEventListener("memora-tiktok-replay", () => {
    for (const detail of buffer.values()) {
      window.dispatchEvent(new CustomEvent("memora-tiktok-item", { detail: JSON.stringify(detail) }));
    }
  });

  // React keeps each feed item's data in the props of the component that renders its <video>.
  // Those expando properties (__reactFiber$...) are invisible to the isolated content script,
  // so the lookup lives here. content.js tags the active <video> and asks; we answer synchronously.
  function itemInProps(value, depth) {
    if (!value || typeof value !== "object" || depth > 3 || value instanceof Node) return null;
    const id = value.id ?? value.aweme_id;
    if (id && /^\d{17,20}$/.test(String(id)) && (value.author || value.video || value.desc !== undefined)) return value;
    for (const key of Object.keys(value)) {
      const hit = itemInProps(value[key], depth + 1);
      if (hit) return hit;
    }
    return null;
  }

  function fiberIdentity(video) {
    let node = video;
    for (let up = 0; node && up < 15; up++, node = node.parentElement) {
      const key = Object.keys(node).find((k) => k.startsWith("__reactFiber$"));
      if (!key) continue;
      let fiber = node[key];
      for (let steps = 0; fiber && steps < 30; steps++, fiber = fiber.return) {
        const hit = itemInProps(fiber.memoizedProps, 0);
        if (hit) return toDetail(hit);
      }
    }
    return null;
  }

  window.addEventListener("memora-tiktok-resolve", () => {
    let result = null;
    try {
      const video = document.querySelector("video[data-memora-active]");
      if (video) result = fiberIdentity(video);
    } catch { /* Fall back to the tap store in content.js. */ }
    window.dispatchEvent(new CustomEvent("memora-tiktok-resolved", { detail: result ? JSON.stringify(result) : "" }));
  });

  function dig(value, depth) {
    // Walk arbitrary API JSON looking for item-shaped objects instead of trusting one schema.
    if (!value || depth > 6) return;
    if (Array.isArray(value)) { for (const entry of value) dig(entry, depth + 1); return; }
    if (typeof value !== "object") return;
    const id = value.id ?? value.aweme_id ?? value.video?.id;
    if (id && /^\d{17,20}$/.test(String(id)) && (value.author || value.video)) { emit(value); return; }
    for (const key of Object.keys(value)) dig(value[key], depth + 1);
  }

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    try {
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url || "";
      if (FEED_URL.test(url) && response.clone) {
        response.clone().json().then((data) => dig(data, 0)).catch(() => { /* Non-JSON feed response. */ });
      }
    } catch { /* Never break the host page. */ }
    return response;
  };

  const OriginalOpen = XMLHttpRequest.prototype.open;
  const OriginalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__memoraUrl = String(url || "");
    return OriginalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    if (FEED_URL.test(this.__memoraUrl || "")) {
      this.addEventListener("load", () => {
        try { dig(JSON.parse(this.responseText), 0); } catch { /* Non-JSON or unreadable body. */ }
      });
    }
    return OriginalSend.apply(this, args);
  };
})();