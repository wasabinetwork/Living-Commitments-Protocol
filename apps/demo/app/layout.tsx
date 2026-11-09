import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

const themeBootstrap = `
  (() => {
    try {
      const saved = localStorage.getItem("lcp-color-theme");
      const theme = saved === "dark" || saved === "light"
        ? saved
        : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      document.documentElement.dataset.theme = theme;
    } catch {
      document.documentElement.dataset.theme = "light";
    }
  })();
`;

export const metadata: Metadata = {
  title: "LCP — Living Commitments",
  description: "Inspect on-chain commitments, evidence, and recurring budget eligibility.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script id="lcp-theme-bootstrap" strategy="beforeInteractive">{themeBootstrap}</Script>
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
