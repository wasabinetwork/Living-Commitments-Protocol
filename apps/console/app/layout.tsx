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

const siteDescription = "Create on-chain commitments on NEAR, attach verifiable evidence, and apply transparent policies to recurring support.";

export const metadata: Metadata = {
  metadataBase: new URL("https://lcp.gama.works"),
  title: "Living Commitments Protocol | NEAR",
  description: siteDescription,
  applicationName: "Living Commitments Protocol",
  keywords: [
    "Living Commitments Protocol",
    "NEAR Protocol",
    "on-chain commitments",
    "verifiable evidence",
    "recurring support",
  ],
  authors: [{ name: "WasabiNetwork", url: "https://x.com/WasabiNetwork" }],
  creator: "WasabiNetwork",
  publisher: "GAMA Works",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "/",
    siteName: "Living Commitments Protocol",
    title: "Living Commitments Protocol | NEAR",
    description: siteDescription,
  },
  twitter: {
    card: "summary",
    site: "@WasabiNetwork",
    creator: "@WasabiNetwork",
    title: "Living Commitments Protocol | NEAR",
    description: siteDescription,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
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
