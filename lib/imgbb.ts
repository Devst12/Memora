// Server-side upload to imgbb.com (free image host). The API key lives only in
// process.env (see .env.local / hosting env vars) — never in committed code.
// API: POST https://api.imgbb.com/1/upload?key=<KEY> with multipart field `image`
// (binary or base64). 32 MB per upload; large images are compressed client-side
// in the extension composer before they ever reach this code.

type ImgbbsResult = {
  url: string;
  displayUrl: string;
  thumbUrl: string;
  deleteUrl: string;
  width: number | null;
  height: number | null;
  size: number | null;
};

export function imgbbConfigured() {
  return Boolean(process.env.IMGBB_API_KEY);
}

export async function uploadToImgbb(file: File): Promise<ImgbbsResult> {
  const key = process.env.IMGBB_API_KEY;
  if (!key) throw new Error("Image hosting is not configured (IMGBB_API_KEY missing).");
  if (file.size > 30 * 1024 * 1024) throw new Error("This image is too large even after compression. Try a smaller one.");

  const form = new FormData();
  form.append("image", file, file.name || "image");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  let response: Response;
  try {
    response = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(key)}`, { method: "POST", body: form, signal: controller.signal });
  } catch {
    throw new Error("Couldn't reach the image host. Check the connection and try again.");
  } finally {
    clearTimeout(timer);
  }
  let body: { success?: boolean; data?: { url?: string; display_url?: string; thumb?: { url?: string }; delete_url?: string; width?: number; height?: number; size?: number }; error?: { message?: string } } = {};
  try { body = await response.json(); } catch { /* Non-JSON body falls through to the generic error. */ }
  const data = body.data;
  if (!response.ok || !body.success || !data?.url) {
    throw new Error(body.error?.message || `Image host rejected the upload (HTTP ${response.status}).`);
  }
  return {
    url: data.url,
    displayUrl: data.display_url || data.url,
    thumbUrl: data.thumb?.url || data.url,
    deleteUrl: data.delete_url || "",
    width: typeof data.width === "number" ? data.width : null,
    height: typeof data.height === "number" ? data.height : null,
    size: typeof data.size === "number" ? data.size : null,
  };
}
