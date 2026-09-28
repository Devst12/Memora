// Infers reason, category, and tags for a link without user input.
// Deterministic keyword scoring against the user's own taxonomy — no network calls, no AI.

export type AutoSuggestion = { reason: string; categoryName: string | null; tags: string[] };
export type CategoryRule = { categoryName: string; keywords: string[] };

const VIDEO_REASON = "Watch Later";
const LEARN_REASON = "Learn";
const INSPIRE_REASON = "Inspiration";
const BUY_REASON = "Buy";

const URL_REASON_HINTS: Array<[RegExp, string]> = [
  [/youtube\.com|youtu\.be|tiktok\.com|vimeo\.com|twitch\.tv|instagram\.com|facebook\.com|fb\.watch/, VIDEO_REASON],
  [/docs?\.[a-z]|developer\.|readthedocs|mozilla\.org|stackoverflow|stackexchange|github\.com|gitlab\.com|arxiv\.org|medium\.com|dev\.to|freecodecamp|wikipedia\.org|coursera|udemy|khanacademy/, LEARN_REASON],
  [/dribbble\.com|behance\.net|awwwards\.com|pinterest\./, INSPIRE_REASON],
  [/amazon\.|flipkart\.|ebay\.|aliexpress|etsy\.com/, BUY_REASON],
];

// Category name pattern -> keywords that boost that category when found in page text.
const CATEGORY_HINTS: Array<[RegExp, string[]]> = [
  [/web\s*dev|front.?end|full.?stack|backend/i, ["github", "gitlab", "stackoverflow", "dev.to", "javascript", "typescript", "react", "next.js", "nextjs", "node", "css", "html", "tailwind", "api", "component", "framework", "hook", "server"]],
  [/video edit|editing|film|premiere/i, ["premiere", "after effects", "davinci", "capcut", "final cut", "color grade", "colorgrade", "editing", "transition", "timeline", "render"]],
  [/design|^ui$|^ux$/i, ["figma", "dribbble", "behance", "awwwards", "typography", "portfolio", "layout", "design", "font", "wireframe"]],
  [/learn|study|course/i, ["course", "tutorial", "learn", "guide", "docs", "documentation", "lesson", "explained", "introduction"]],
  [/business|startup|marketing/i, ["startup", "marketing", "saas", "revenue", "pricing", "strategy", "growth", "founder", "pitch", "brand"]],
  [/music/i, ["music", "song", "album", "guitar", "piano", "beat", "producer", "mixing", "mastering"]],
  [/idea/i, ["idea", "concept", "brainstorm", "inspiration", "note"]],
  [/personal|life|home/i, ["recipe", "travel", "fitness", "health", "home", "budget", "diy"]],
  [/ai|machine learning|paper/i, ["arxiv", "paper", "model", "neural", "transformer", "llm", "gpt", "dataset", "training", "inference", "attention"]],
];

const STOPWORDS = new Set("a an and are as at be but by for from has have how i in is it its of on or that the this to was were will with what when where who you your we they them then than so if not no yes do does did done can could should would may might must about into over under more most other some such only own same too very just also via using use used new get make made top best full free official video watch page home intro welcome welcome".split(" "));

function keywordsFor(name: string) {
  const words = name.toLowerCase().split(/[^a-z0-9+#.]+/).filter((word) => word.length > 1);
  const singulars = words.map((word) => (word.endsWith("s") && word.length > 3 ? word.slice(0, -1) : word));
  return [...new Set([...words, ...singulars])];
}

function rootDomain(url: string) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const parts = host.split(".");
    return parts.length > 1 ? parts[parts.length - 2] : host;
  } catch {
    return "";
  }
}

// Rules the user defined in Settings (category → keywords). One keyword hit is a strong,
// deterministic signal and beats the built-in heuristics — ties go to the earliest rule.
function ruleMatch(text: string, rules: CategoryRule[]): CategoryRule | null {
  for (const rule of rules) {
    for (const rawKeyword of rule.keywords) {
      const keyword = rawKeyword.trim().toLowerCase();
      if (keyword.length < 2) continue;
      if (text.includes(keyword)) return rule;
    }
  }
  return null;
}

export function suggestMeta(input: { url: string; title?: string; description?: string; platform?: string; categories?: string[]; rules?: CategoryRule[]; keywords?: string[] }): AutoSuggestion {
  // Extra words the capturer saw in the live page (page keywords/headings) — they carry real
  // context that static metadata misses, so they weigh in on category and reason too.
  const contextWords = (input.keywords || []).join(" ");
  const text = `${input.url} ${contextWords} ${input.title || ""} ${input.description || ""}`.toLowerCase().slice(0, 4000);

  let reason = ["youtube", "tiktok", "instagram", "facebook"].includes(input.platform || "") ? VIDEO_REASON : LEARN_REASON;
  for (const [pattern, value] of URL_REASON_HINTS) {
    if (pattern.test(text)) { reason = value; break; }
  }

  const matchedRule = ruleMatch(text, input.rules || []);
  if (matchedRule) return { reason, categoryName: matchedRule.categoryName, tags: tagsFor(input, text) };

  let categoryName: string | null = null, bestScore = 0;
  const categoryText = `${input.url} ${input.title || ""} ${input.description || ""}`.toLowerCase().slice(0, 4000); // Heuristics stay on static metadata; rules already saw live keywords.
  for (const name of input.categories || []) {
    let score = 0;
    for (const [pattern, words] of CATEGORY_HINTS) {
      if (!pattern.test(name)) continue;
      for (const word of words) if (categoryText.includes(word)) score += 2;
    }
    for (const word of keywordsFor(name)) if (word.length >= 3 && categoryText.includes(word)) score += 2;
    if (score > bestScore) { bestScore = score; categoryName = name; }
  }

  const tags: string[] = [];
  const host = rootDomain(input.url);
  if (host && host.length >= 3) tags.push(host);
  for (const word of (input.title || "").toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, " ").split(/\s+/)) {
    if (word.length >= 3 && word.length <= 20 && !STOPWORDS.has(word) && !tags.includes(word)) tags.push(word);
    if (tags.length >= 5) break;
  }

  return { reason, categoryName, tags: tagsFor(input, text) };
}

function tagsFor(input: { url: string; title?: string }, text: string) {
  const tags: string[] = [];
  const host = rootDomain(input.url);
  if (host && host.length >= 3) tags.push(host);
  for (const word of text.replace(/https?:\/\/\S+/g, " ").replace(/[^\p{L}\p{N} ]+/gu, " ").split(/\s+/)) {
    if (word.length >= 3 && word.length <= 20 && !STOPWORDS.has(word) && !tags.includes(word)) tags.push(word);
    if (tags.length >= 5) break;
  }
  return tags;
}
