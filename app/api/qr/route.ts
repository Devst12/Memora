// QR codes for note share links, drawn as SVG with the zero-dependency `qrcode`
// package (server side only). ?png=1 returns a PNG data URL for downloads.
import QRCode from "qrcode";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const data = params.get("data") || "";
  const download = params.get("png") === "1";
  if (!data || data.length > 1000) {
    return new Response("Missing or too-long `data` parameter.", { status: 400 });
  }
  try {
    if (download) {
      const dataUrl = await QRCode.toDataURL(data, { errorCorrectionLevel: "M", margin: 2, width: 720, color: { dark: "#1f241e", light: "#ffffff" } });
      const png = Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ""), "base64");
      return new Response(new Uint8Array(png), {
        headers: { "Content-Type": "image/png", "Content-Disposition": 'attachment; filename="memora-qr.png"', "Cache-Control": "public, max-age=86400" },
      });
    }
    const svg = await QRCode.toString(data, { type: "svg", errorCorrectionLevel: "M", margin: 1, color: { dark: "#1f241e", light: "#ffffff" } });
    return new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" } });
  } catch {
    return new Response("Couldn't render that QR code.", { status: 400 });
  }
}
