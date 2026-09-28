// Verifies the detection and resolution logic from extension/content.js against simulated data.
// The functions mirror the content script; keep them in sync or extract later.

// ---- Deep hydration scan (mirrors collectHydrationItems) ----------------------------
function collectHydrationItems(scripts) {
  const items = [];
  const seen = new Set();
  function dig(value, depth) {
    if (!value || depth > 8 || seen.has(value)) return;
    if (Array.isArray(value)) { for (const entry of value) dig(entry, depth + 1); return; }
    if (typeof value !== "object") return;
    seen.add(value);
    const id = value.id ?? value.aweme_id ?? value.video?.id;
    if (id && /^\d{17,20}$/.test(String(id)) && (value.author || value.video)) {
      items.push({
        id: String(id),
        author: value.author?.uniqueId || value.author?.uniqueID || null,
        caption: value.desc ? String(value.desc).slice(0, 300) : "",
        cover: value.video?.cover || value.video?.originCover || value.video?.dynamicCover || "",
      });
      return;
    }
    for (const key of Object.keys(value)) dig(value[key], depth + 1);
  }
  for (const text of scripts) {
    try { dig(JSON.parse(text), 0); } catch { /* Malformed script. */ }
  }
  return items;
}

// ---- Resolution cascade (mirrors currentFeedItem's core) ----------------------------
function resolveFeed({ fromDom, tapped, hydration, description }) {
  if (fromDom) return { id: fromDom.id, author: fromDom.author, title: description || "" };
  const candidates = [...tapped, ...hydration];
  const uniqueById = new Map();
  for (const item of candidates) if (item.id && !uniqueById.has(item.id)) uniqueById.set(item.id, item);
  const pool = [...uniqueById.values()];
  if (!pool.length) return { refused: true };
  if (description) {
    const normalize = (text) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    const wanted = normalize(description);
    const captionMatch = pool.find((item) => item.caption && normalize(item.caption) === wanted)
      || pool.find((item) => item.caption && wanted.length > 20 && (wanted.includes(normalize(item.caption)) || normalize(item.caption).includes(wanted)));
    if (captionMatch) return { id: captionMatch.id, author: captionMatch.author, title: captionMatch.caption || description };
  }
  if (pool.length === 1) return { id: pool[0].id, author: pool[0].author, title: pool[0].caption || description };
  if (pool.every((item) => item.author && item.author === pool[0].author)) {
    const item = pool[pool.length - 1];
    return { id: item.id, author: item.author, title: item.caption || description };
  }
  return { refused: true };
}

let passed = 0, failed = 0;
function check(name, condition) {
  if (condition) { passed++; console.log(`  ok  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}`); }
}

const NASA = { id: "7284567890123456789", author: "nasa", caption: "How engineers test spacecraft parachutes #nasa #space", cover: "https://p19-sign.tiktokcdn.com/cover.jpeg" };
const CHEF = { id: "7359123456789012345", author: "gordonramsayvideo", caption: "Easy pasta recipe #cooking #italianfood", cover: "" };

// 1. DOM identity wins over everything
check("dom author+id wins", resolveFeed({ fromDom: { author: "nasa", id: NASA.id }, tapped: [CHEF], hydration: [], description: "" }).author === "nasa");

// 2. Deep scan finds items nested under unknown schema keys
{
  const weird = { appState: { vitals: { list: [{ weirdModule: { aweme_id: CHEF.id, desc: CHEF.caption, author: { uniqueID: CHEF.author }, video: { cover: "x.jpg" } } }] } } };
  const items = collectHydrationItems([JSON.stringify(weird)]);
  check("deep scan finds items under unknown keys", items.length === 1 && items[0].id === CHEF.id && items[0].author === CHEF.author);
}
// 3. Caption match resolves the active video from a multi-video pool
{
  const resolved = resolveFeed({ fromDom: null, tapped: [NASA, CHEF], hydration: [], description: "Easy pasta recipe #cooking #italianfood" });
  check("caption match picks the on-screen video", resolved.id === CHEF.id && resolved.author === CHEF.author);
}
// 4. Caption match with punctuation/case differences still hits
{
  const resolved = resolveFeed({ fromDom: null, tapped: [NASA, CHEF], hydration: [], description: "EASY   PASTA RECIPE! #cooking" });
  check("caption match ignores case and punctuation", resolved.id === CHEF.id);
}
// 5. Single known candidate is unambiguous
{
  const resolved = resolveFeed({ fromDom: null, tapped: [NASA], hydration: [], description: "" });
  check("single candidate resolves without a description", resolved.id === NASA.id && resolved.author === "nasa");
}
// 6. Same-author pool (profile feed): newest wins
{
  const older = { id: "7100000000000000001", author: "nasa", caption: "Old rocket video" };
  const resolved = resolveFeed({ fromDom: null, tapped: [older, NASA], hydration: [], description: "" });
  check("same-author pool takes the newest item", resolved.id === NASA.id);
}
// 7. Ambiguous pool with no description refuses rather than guessing
{
  const other = { id: "7199999999999999999", author: "someoneelse", caption: "A different video" };
  check("ambiguous pool without description refuses", resolveFeed({ fromDom: null, tapped: [NASA, other], hydration: [], description: "" }).refused === true);
}
// 8. Empty pool refuses
check("no data at all refuses", resolveFeed({ fromDom: null, tapped: [], hydration: [], description: "" }).refused === true);
// 9. Tapped items dedupe by id (feed refetches the same video)
{
  const resolved = resolveFeed({ fromDom: null, tapped: [NASA, { ...NASA, cover: "updated.jpeg" }], hydration: [], description: "" });
  check("duplicate tapped ids collapse to one", resolved.id === NASA.id);
}
// 10. Hydration fallback when the tap missed the response
{
  const resolved = resolveFeed({ fromDom: null, tapped: [], hydration: [NASA, CHEF], description: "How engineers test spacecraft parachutes #nasa #space" });
  check("hydration items work when the tap missed", resolved.id === NASA.id && resolved.author === "nasa");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
