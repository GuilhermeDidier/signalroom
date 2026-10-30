import type { Metadata, Viewport } from "next";
import { Barlow_Condensed, JetBrains_Mono, Public_Sans } from "next/font/google";
import "./globals.css";

const display = Barlow_Condensed({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const body = Public_Sans({
  variable: "--font-body",
  subsets: ["latin"],
});

const mono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: { default: "Signalroom — AI support copilot", template: "%s · Signalroom" },
  description:
    "Multi-tenant AI support copilot demo: hybrid RAG with citations, confidence lamps, human handoff, PII redaction and an audit log. Fictional companies, synthetic data.",
};

export const viewport: Viewport = {
  themeColor: "#e2e8ef",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
