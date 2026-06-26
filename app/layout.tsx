import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "フロントエンド大量データ パフォーマンス検証",
  description: "Next.js + TypeScript frontend performance lab for large browser datasets.",
  icons: {
    icon: "/favicon.svg"
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
