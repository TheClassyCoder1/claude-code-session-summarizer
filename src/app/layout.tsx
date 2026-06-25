import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "claude-kanban",
  description: "A simple AI-assisted kanban board powered by Claude.",
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
