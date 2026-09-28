// Service worker: performs saves for the floating button and right-click menu, tracks badge feedback.
// The content script never trusts location.href — SPA sites like TikTok keep the address bar
// stale or bare (tiktok.com while scrolling a feed), so the real URL is resolved here per tab.

async function capture({ apiUrl, token }, payload) {
  const response = await fetch(`${apiUrl.replace(/\/$/, "")}/api/extension/capture`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  let body = {};
  try { body = await response.json(); } catch { /* Non-JSON error body is handled below. */ }
  return { status: response.status, body };
}

// Resolve the address to save: an explicit link (right-click) wins; otherwise ask Chrome for the
// tab's live URL and title. activeTab permission grants this on the tab the user is on.
async function resolveTab(url, sender) {
  if (url) return { url, title: "" };
  const tabId = sender?.tab?.id;
  if (tabId == null) return null;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url || !/^https?:/i.test(tab.url)) return null;
    return { url: tab.url, title: tab.title || "" };
  } catch { return null; }
}

async function save({ url: rawUrl, title: pageTitle, keywords }, sender) {
  const { apiUrl, token } = await chrome.storage.local.get(["apiUrl", "token"]);
  if (!apiUrl || !token) {
    return { ok: false, message: "Memora isn't connected. Open the popup to add your app URL and capture token." };
  }
  const resolved = await resolveTab(rawUrl, sender);
  if (!resolved) return { ok: false, message: "This page can't be saved." };
  try {
    const { status, body } = await capture({ apiUrl, token }, {
      url: resolved.url,
      pageTitle,
      keywords: Array.isArray(keywords) ? keywords : [],
    });
    if (status === 409) {
      return { ok: true, duplicate: true, title: body.title, platform: body.platform, thumbnailUrl: body.thumbnailUrl, message: body.message };
    }
    if (!status || status >= 400) {
      return { ok: false, message: body.error || `Couldn't save (HTTP ${status || "network error"}).` };
    }
    return { ok: true, title: body.title, platform: body.platform, reason: body.reason, categoryName: body.categoryName, tags: body.tags, thumbnailUrl: body.thumbnailUrl, message: body.message };
  } catch {
    return { ok: false, message: "Network error — is your Memora app running?" };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "memora-save") {
    save(message, sender).then(sendResponse);
    return true; // keep the message channel open for the async response
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "memora-save", title: "Save to Memora", contexts: ["page", "link"] });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "memora-save") return;
  const result = await save({ url: info.linkUrl || info.pageUrl || null, title: tab?.title || "", keywords: [] }, { tab });
  const ok = result.ok && !result.duplicate;
  await chrome.action.setBadgeBackgroundColor({ color: ok ? "#526b4b" : "#995f4f" });
  await chrome.action.setBadgeText({ text: ok ? "✓" : "!" });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 3000);
  // Surface the result in the page when the content script is available.
  try {
    if (tab?.id != null) {
      await chrome.tabs.sendMessage(tab.id, {
        type: "memora-show-result",
        result,
      });
    }
  } catch { /* Pages without the content script (e.g. chrome://) only get the badge. */ }
});
