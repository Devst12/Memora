import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { buildZip } from "@/lib/extension-zip";
import { jsonError } from "@/lib/http";

// Files shipped in the downloadable extension bundle. Every entry must exist in
// extension/ — a stale list is a packaging bug, so the route fails loudly.
const FILES = [
  "manifest.json",
  "background.js",
  "content.js",
  "inject.js",
  "popup.html",
  "popup.css",
  "popup.js",
  "icon16.png",
  "icon32.png",
  "icon48.png",
  "icon128.png",
];

let cached: { zip: Buffer; etag: string } | null = null;

// Bundle the extension folder at request time so the download always matches
// the code on disk; a short in-memory cache avoids rezipping every click.
async function extensionZip() {
  if (cached) return cached;
  const root = path.join(process.cwd(), "extension");
  const present = new Set(await readdir(root));
  const missing = FILES.filter((name) => !present.has(name));
  if (missing.length) throw new Error(`Extension bundle incomplete — missing: ${missing.join(", ")}`);

  const entries = await Promise.all(FILES.map(async (name) => ({ name, data: await readFile(path.join(root, name)) })));
  const zip = buildZip(entries);
  const etag = `"${createHash("sha1").update(zip).digest("hex")}"`;
  cached = { zip, etag };
  return cached;
}

export async function GET(request: Request) {
  try {
    const { zip, etag } = await extensionZip();
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304 });
    return new Response(new Uint8Array(zip), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="memora-extension.zip"',
        "Content-Length": String(zip.length),
        "Cache-Control": "no-store",
        ETag: etag,
      },
    });
  } catch (error) {
    console.error(error);
    return jsonError("Extension bundle is not available right now. Please try again later.", 503);
  }
}
