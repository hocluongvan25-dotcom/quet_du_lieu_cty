import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Seekora — Company Intelligence",
  description: "Research doanh nghiệp đa nguồn, có evidence và chính sách lưu trữ rõ ràng.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
