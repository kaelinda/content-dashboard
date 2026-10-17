import type { Metadata } from "next";
import "./globals.css";
import "./studio.css";
export const metadata: Metadata = {
  title: "Content Hub · 内容中枢",
  description: "你的私有内容工作台。收集信息，沉淀观点，连接每一次创作。",
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
