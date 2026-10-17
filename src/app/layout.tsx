import type { Metadata } from "next";
import "./globals.css";
import "./studio.css";
export const metadata: Metadata = {
  title: "Content Hub · 内容中枢",
  description:
    "多 Agent 的私有数据工作台。统一资料、内容与输出，管理授权并追溯每一次修改。",
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
