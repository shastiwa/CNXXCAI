import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SolvNow XC AI",
  description: "IT experience recovery: post-incident survey and closed-loop recovery",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
