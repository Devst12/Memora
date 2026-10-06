import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "sonner";
import { DialogHost } from "@/components/confirm-dialog";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-app", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Memora — Keep what matters. Find it when it counts.", template: "%s · Memora" },
  description: "Your personal digital memory for videos, articles, ideas, and inspiration you want to revisit. Save what matters and remember why.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Memora" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f5f1" },
    { media: "(prefers-color-scheme: dark)", color: "#151813" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`h-full antialiased ${inter.variable}`}>
      <body className="min-h-full flex flex-col">
        <script
          // Apply the saved theme before paint to avoid a light-flash on dark devices.
          dangerouslySetInnerHTML={{ __html: `try{if(localStorage.getItem('memora-theme')==='dark')document.documentElement.classList.add('dark')}catch(e){}` }}
        />
        {children}
        <DialogHost />
        <Toaster position="bottom-center" toastOptions={{ style: { borderRadius: "14px" } }} />
        <script
          // Installable PWA: registering the service worker enables "Add to Home
          // screen"/install, which is what makes Memora appear in the phone's
          // share sheet. Idempotent; silently skipped where unsupported.
          dangerouslySetInnerHTML={{ __html: `try{if('serviceWorker' in navigator)window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){})})}catch(e){}` }}
        />
      </body>
    </html>
  );
}
