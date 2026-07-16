import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { AppProviders } from "./providers";

const sans = Hanken_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};
// envicon:start
const _enviconEnv = process.env.APP_ENV || process.env.VERCEL_TARGET_ENV || process.env.VERCEL_ENV || process.env.NODE_ENV || 'development';
const _enviconIcon = _enviconEnv === 'production' || _enviconEnv === 'prod'
  ? { url: '/w_logo.svg' }
  : _enviconEnv === 'preview' || _enviconEnv === 'staging' || _enviconEnv === 'test'
    ? { url: '/env-favicon-preview.png' }
    : { url: '/env-favicon-development.png' };
// envicon:end

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "https://app.rubiconpay.xyz"),
  title: {
    default: "Rubicon App",
    template: "%s · Rubicon",
  },
  description: "Publish writing for AI agents, manage paid reads, and withdraw your earnings.",
    icons: [{ url: _enviconIcon.url }]
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
