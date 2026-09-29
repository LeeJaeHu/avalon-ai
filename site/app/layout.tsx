import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Avalon | 다섯 사람의 비밀 원정",
  description: "AI 네 명과 함께 즐기는 5인 아발론 웹 게임",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}
