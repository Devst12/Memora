// One-time generation of the PWA icon set from the existing brand logo.
// Run with: node scripts/make-icons.mjs
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = `${root}/public/logo.png`;
mkdirSync(`${root}/public/icons`, { recursive: true });

// Standard launcher sizes plus a maskable variant (safe area) and an
// apple-touch-icon. Same art, sized for each platform's expectations.
const jobs = [
  { file: "icon-192.png", size: 192 },
  { file: "icon-512.png", size: 512 },
  { file: "maskable-192.png", size: 192, maskable: true },
  { file: "maskable-512.png", size: 512, maskable: true },
  { file: "apple-touch-icon.png", size: 180, maskable: true },
];

for (const { file, size, maskable } of jobs) {
  // Maskable icons need the art inside a safe area (~80% of the tile) or
  // Android's circular mask clips it.
  const pipeline = maskable
    ? sharp(source).resize(Math.round(size * 0.8), Math.round(size * 0.8), { fit: "inside" })
        .extend({ top: Math.round(size * 0.1), bottom: Math.round(size * 0.1), left: Math.round(size * 0.1), right: Math.round(size * 0.1), background: { r: 49, g: 73, b: 58, alpha: 1 } })
    : sharp(source).resize(size, size);
  await pipeline.png().toFile(`${root}/public/icons/${file}`);
  console.log("✓", file);
}
