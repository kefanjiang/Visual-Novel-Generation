import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "剧情工坊 · 多 Agent 剧情游戏生成器",
  description: "一句话描述想要的剧情游戏，AI agent 团队协作生成可玩、可分享的 web app。",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
