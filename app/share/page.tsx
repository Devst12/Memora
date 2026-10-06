import type { Metadata, Viewport } from "next";
import ShareClient from "@/components/share-client";

export const metadata: Metadata = {
  title: "Saving to Memora…",
  // The share sheet opens this page over the installed app; hide it from the
  // browser chrome entirely.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#31493a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// Target of the PWA share_target in public/manifest.webmanifest: the phone's
// share sheet lands here with ?title=&text=&url= and the client does the rest.
export default function SharePage() {
  return <ShareClient />;
}
