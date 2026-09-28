// Service worker: performs saves for the floating button and right-click menu, tracks badge feedback.

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

async function save(url, title) {
  const { apiUrl, token } = await chrome.storage.local.get(["apiUrl", "token"]);
  if (!apiUrl || !token) {
    return { ok: false, message: "Memora isn't connected. Open the popup to add your app URL and capture token." };
  }
  try {
    const { status, body } = await capture({ apiUrl, token }, { url, title });
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "memora-save" && typeof message.url === "string") {
    save(message.url, typeof message.title === "string" ? message.title : "").then(sendResponse);
    return true; // keep the message channel open for the async response
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "memora-save", title: "Save to Memora", contexts: ["page", "link"] });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "memora-save") return;
  const url = info.linkUrl || info.pageUrl || tab?.url;
  if (!url) return;
  const result = await save(url, tab?.title || "");
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
