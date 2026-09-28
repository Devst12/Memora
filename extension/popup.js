const $ = (id) => document.getElementById(id);
const config = $("config"), capture = $("capture"), message = $("message");
let activeUrl = "";
let contextKeywords = []; // Real page keywords from the content script (SPA feeds render client-side).

async function show() {
  const settings = await chrome.storage.local.get(["apiUrl", "token"]);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeUrl = tab?.url || "";
  tabTitle = tab?.title || "";
  // Prefer the in-page item URL/title (SPA feeds) over the raw tab state.
  const context = await pageContext();
  if (context?.url) activeUrl = context.url;
  if (context?.title) tabTitle = context.title;
  contextKeywords = context?.keywords || [];
  const connected = Boolean(settings.apiUrl && settings.token);
  config.hidden = connected; capture.hidden = !connected;
  if (connected) {
    $("url").textContent = activeUrl;
    $("title").value = tabTitle || "";
    const response = await fetch(`${settings.apiUrl}/api/taxonomy/categories`, { headers: { Authorization: `Bearer ${settings.token}` } });
    if (response.ok) {
      const { items } = await response.json();
      $("category").replaceChildren(new Option("Auto-detect", ""), ...(items || []).map((item) => new Option(item.name, item.id)));
    }
  } else {
    $("apiUrl").value = settings.apiUrl || "";
    if (!settings.apiUrl) message.textContent = "Paste your Memora app URL and capture token from Settings → Browser extension.";
  }
}

$("settings").addEventListener("click", async () => { await chrome.storage.local.remove(["token"]); message.textContent = "Enter your new capture token."; await show(); });
let connecting = false;
// Probe the page for the current item's real URL/title the same way the floating button does —
// on SPA feeds (TikTok) the address bar doesn't follow the video.
async function pageContext() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https?:/i.test(tab.url || "")) return { url: activeUrl, title: tabTitle, keywords: [] };
    const response = await chrome.tabs.sendMessage(tab.id, { type: "memora-context" }).catch(() => null);
    if (response?.url || response?.title) return { url: response.url || activeUrl, title: response.title || tabTitle, keywords: response.keywords || [] };
    return { url: activeUrl, title: tabTitle, keywords: [] };
  } catch { return { url: activeUrl, title: tabTitle, keywords: [] }; }
}
// Same idea as the content script: keywords from the live tab help categorize SPA pages (TikTok
// renders client-side, so the server-side fetch sees almost nothing).
let tabTitle = "";
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
  return [...words].slice(0, 12);
}
$("connect").addEventListener("click", async () => {
  if (connecting) return;
  const apiUrl = $("apiUrl").value.trim().replace(/\/$/, ""), token = $("token").value.trim();
  const button = $("connect");
  try {
    const parsed = new URL(apiUrl);
    if (!(["https:", "http:"].includes(parsed.protocol)) || !token.startsWith("mem_")) throw new Error("Enter your Memora URL and capture token.");
    connecting = true;
    button.disabled = true; button.textContent = "Connecting…";
    const granted = await chrome.permissions.request({ origins: [`${parsed.origin}/*`] });
    if (!granted) throw new Error("Allow Memora access to connect the extension.");
    await chrome.storage.local.set({ apiUrl, token });
    const check = await fetch(`${apiUrl}/api/extension-token`, { headers: { Authorization: `Bearer ${token}` } });
    if (check.status === 401) throw new Error("That token is invalid or revoked.");
    if (!check.ok) throw new Error(`Couldn't reach ${apiUrl}. Is the app running?`);
    message.textContent = "";
    await show();
  } catch (error) {
    message.textContent = error.message || "Couldn’t connect. Check the app URL.";
  } finally {
    connecting = false;
    button.disabled = false; button.textContent = "Connect";
  }
});
$("save").addEventListener("click", async () => {
  const button = $("save"), { apiUrl, token } = await chrome.storage.local.get(["apiUrl", "token"]);
  button.disabled = true; button.textContent = "Saving…"; message.textContent = "";
  try {
    if (!activeUrl || !/^https?:/i.test(activeUrl)) throw new Error("This page can't be saved (browser pages aren't saveable).");
    const response = await fetch(`${apiUrl}/api/extension/capture`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ url: activeUrl, title: $("title").value, pageTitle: tabTitle, keywords: contextKeywords.length ? contextKeywords : pageKeywords(), reason: $("reason").value, categoryId: $("category").value, notes: $("notes").value }) });
    const result = await response.json();
    if (response.status === 409) message.textContent = "Already in your memory ✓";
    else if (!response.ok) throw new Error(result.error || "Couldn’t save right now.");
    else message.textContent = `✓ Saved${result.categoryName ? ` · ${result.categoryName}` : ""}${result.reason ? ` · ${result.reason}` : ""}`;
    if (response.ok) button.textContent = "Saved";
  } catch (error) { message.textContent = error.message || "Couldn’t save. Check your connection and try again."; }
  finally { button.disabled = false; if (button.textContent === "Saving…") button.textContent = "Save to Memory"; }
});
show();
