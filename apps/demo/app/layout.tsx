import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LCP — Living Commitments",
  description: "Inspect on-chain commitments, evidence, and recurring budget eligibility.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
