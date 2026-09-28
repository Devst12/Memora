import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Memora — Keep what matters. Find it when it counts.", template: "%s · Memora" },
  description: "Your personal digital memory for videos, articles, ideas, and inspiration you want to revisit. Save what matters and remember why.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
