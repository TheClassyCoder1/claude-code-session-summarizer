import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Claude Session Dashboard",
  description: "A dashboard of what you built with Claude Code — per session, with token usage and cost.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
