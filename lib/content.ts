import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type Platform = "youtube" | "tiktok" | "instagram" | "facebook" | "reddit" | "web";
export function normalizeUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 2048) throw new Error("Please enter a valid URL.");
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error("Please enter a valid URL."); }
  if (!(["http:", "https:"].includes(url.protocol)) || url.username || url.password) throw new Error("Please enter a valid URL.");
  url.hash = "";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid|si$|feature$)/i.test(key)) url.searchParams.delete(key);
  if (["youtube.com", "m.youtube.com"].includes(url.hostname) && url.pathname === "/watch" && url.searchParams.has("v")) {
    url.hostname = "youtube.com"; url.search = `?v=${encodeURIComponent(url.searchParams.get("v")!)}`;
  }
  return url.toString().replace(/\/$/, url.pathname === "/" ? "/" : "");
}

export function detectPlatform(value: string): Platform {
  const host = new URL(value).hostname.replace(/^www\./, "");
  if (["youtube.com", "youtu.be"].includes(host)) return "youtube";
  if (host === "tiktok.com") return "tiktok";
  if (host === "instagram.com") return "instagram";
  if (["facebook.com", "fb.watch"].includes(host)) return "facebook";
  if (["reddit.com", "redd.it"].includes(host)) return "reddit";
  return "web";
}

function publicAddress(ip: string) {
  if (isIP(ip) === 4) {
    const parts = ip.split(".").map(Number);
    return !(parts[0] === 10 || parts[0] === 127 || parts[0] === 0 || parts[0] >= 224 || (parts[0] === 169 && parts[1] === 254) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168));
  }
  const normalized = ip.toLowerCase();
  return normalized === "::1" || normalized.startsWith("fe80:") || normalized.startsWith("fc") || normalized.startsWith("fd") ? false : true;
}

async function assertPublicUrl(url: URL) {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Unsafe URL");
  const host = url.hostname.toLowerCase();
  if (["localhost", "localhost.localdomain"].includes(host) || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("Unsafe URL");
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) throw new Error("Unsafe URL");
}

function meta(html: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i"), new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, "i")];
  return patterns.map((p) => html.match(p)?.[1]).find(Boolean)?.replaceAll("&amp;", "&").replaceAll("&quot;", '"').trim();
}

export async function fetchMetadata(raw: string) {
  let current = new URL(raw);
  await assertPublicUrl(current);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await fetch(current, { redirect: "manual", signal: AbortSignal.timeout(5000), headers: { "user-agent": "Memora/1.0 (+https://memora.app; link preview)", accept: "text/html,application/xhtml+xml" } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirects === 3) break;
      current = new URL(location, current); await assertPublicUrl(current); continue;
    }
    if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) break;
    const reader = response.body?.getReader();
    if (!reader) break;
    let body = "";
    while (body.length < 1_000_000) {
      const { done, value } = await reader.read();
      if (done) break;
      body += new TextDecoder().decode(value, { stream: true });
    }
    await reader.cancel();
    const title = meta(body, "og:title") || meta(body, "twitter:title") || body.match(/<title[^>]*>([^<]{1,300})<\/title>/i)?.[1]?.trim();
    const description = meta(body, "og:description") || meta(body, "twitter:description") || meta(body, "description");
    const image = meta(body, "og:image") || meta(body, "twitter:image");
    const canonical = body.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1];
    return { title: title?.replace(/&amp;/g, "&").slice(0, 300), description: description?.slice(0, 2000), thumbnailUrl: image ? new URL(image, current).toString() : undefined, canonicalUrl: canonical ? normalizeUrl(new URL(canonical, current).toString()) : undefined, authorName: meta(body, "og:site_name") || undefined };
  }
  return {};
}
