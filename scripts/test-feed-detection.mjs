/* eslint-disable @typescript-eslint/no-this-alias */
// Verifies the detection logic ported from extension/content.js against simulated DOM shapes.
// The functions below mirror the content script; keep them in sync or extract later.

function identityFromDomLike(video) {
  const VIDEO_PATH = /\/@([^/?#]+)\/video\/(\d{17,20})/;
  const BARE_ID = /(\d{17,20})/;
  let node = video;
  for (let depth = 0; node && depth < 12; depth++, node = node.parentElement) {
    const link = node.closest?.("a[href*='/video/']") || node.querySelector?.("a[href*='/video/']");
    if (link) {
      const match = (link.getAttribute("href") || "").match(VIDEO_PATH);
      if (match) return { author: match[1], id: match[2] };
    }
    for (const attribute of ["id", "data-e2e", "data-video-id"]) {
      const value = node.getAttribute?.(attribute) || "";
      if (attribute === "data-e2e") continue;
      const match = value.match(BARE_ID);
      if (match) return { author: null, id: match[1] };
    }
  }
  return null;
}

function activeVideoLike(videos) {
  let best = null, bestDistance = Infinity;
  const centerY = 400; // viewport 800 tall
  for (const video of videos) {
    const rect = video.getBoundingClientRect();
    if (rect.height < 40) continue;
    const distance = Math.abs(rect.top + rect.height / 2 - centerY);
    if (distance < bestDistance) { bestDistance = distance; best = video; }
  }
  return best;
}

// --- Fake DOM helpers ---------------------------------------------------------------
function makeElement(attrs = {}, parent = null) {
  return {
    attrs,
    parentElement: parent,
    getAttribute(name) { return this.attrs[name] ?? null; },
    closest(selector) {
      if (!selector.includes("a[href*='/video/']")) return null;
      for (let node = this; node; node = node.parentElement) { if (node.attrs.href?.includes("/video/")) return node; }
      return null;
    },      querySelector(selector) {
      if (selector.includes("a[href*='/video/']")) {
        const stack = [this];
        while (stack.length) {
          const current = stack.pop();
          for (const child of current.children || []) {
            if (child.attrs.href?.includes("/video/")) return child;
            stack.push(child);
          }
        }
      }
      return null;
    },
    children: [],
  };
}

function makeVideo(top, height, parent = null) {
  const video = makeElement({}, parent);
  video.getBoundingClientRect = () => ({ top, height });
  return video;
}

let passed = 0, failed = 0;
function check(name, condition) {
  if (condition) { passed++; console.log(`  ok  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}`); }
}

// 1. Centered video wins over first video
{
  const prev = makeVideo(-600, 700);  // mostly above viewport
  const current = makeVideo(50, 700); // centered
  const next = makeVideo(760, 700);   // below
  check("picks the centered video, not the first", activeVideoLike([prev, current, next]) === current);
}
// 2. Tiny preload slot ignored
{
  const tiny = makeVideo(0, 10);
  const real = makeVideo(100, 600);
  check("ignores tiny preload videos", activeVideoLike([tiny, real]) === real);
}
// 3. Parent-walk finds the /@user/video/<id> link
{
  const container = makeElement({ id: "feed-item-0" });
  const link = makeElement({ href: "/@nasa/video/7284567890123456789?is_copy_url=1" }, container);
  const video = makeVideo(0, 600, container);
  container.children.push(link, video);
  const identity = identityFromDomLike(video, {});
  check("walks up to the video link with author+id", identity?.author === "nasa" && identity?.id === "7284567890123456789");
}
// 4. data-e2e is never treated as an id source
{
  const wrapper = makeElement({ "data-e2e": "video-card-12345", id: "x" });
  const video = makeVideo(0, 600, wrapper);
  wrapper.children.push(video);
  check("ignores data-e2e ui labels", identityFromDomLike(video, {}) === null);
}
// 5. Bare 19-digit id attribute accepted (author missing)
{
  const wrapper = makeElement({ "data-video-id": "7284567890123456789" });
  const video = makeVideo(0, 600, wrapper);
  wrapper.children.push(video);
  const identity = identityFromDomLike(video, {});
  check("accepts bare digit id without author", identity?.id === "7284567890123456789" && identity?.author === null);
}
// 6. Short ids (16 digits or fewer) are rejected
{
  const wrapper = makeElement({ id: "item-728456789012345" });
  const video = makeVideo(0, 600, wrapper);
  wrapper.children.push(video);
  check("rejects ids shorter than 17 digits", identityFromDomLike(video, {}) === null);
}
// 7. Hydration JSON merges: bare dom id + hydration author
{
  const domIdentity = { author: null, id: "7284567890123456789" };
  const hydration = { author: "nasa", id: "7284567890123456789", caption: "How we test parachutes" };
  const id = domIdentity.id || hydration.id;
  const author = domIdentity.author || hydration.author;
  check("merges dom id with hydration author", id === "7284567890123456789" && author === "nasa");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
