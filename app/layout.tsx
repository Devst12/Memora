import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-app", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Memora — Keep what matters. Find it when it counts.", template: "%s · Memora" },
  description: "Your personal digital memory for videos, articles, ideas, and inspiration you want to revisit. Save what matters and remember why.",
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
        <Toaster position="bottom-center" toastOptions={{ style: { borderRadius: "14px" } }} />
      </body>
    </html>
  );
}
