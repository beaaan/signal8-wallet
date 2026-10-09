import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import Link from "next/link";
import { config } from "@/lib/config";
import Nav from "./components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Signal 8 Wallet",
  description: "A small-business wallet that follows a plan the owners signed on a calm day.",
};

const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-sans", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono", display: "swap" });

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <header className="topbar">
          <div className="topbar-inner">
            <Link href="/" className="brand">
              <span className="brand-mark" aria-hidden>
                8
              </span>
              Signal 8
            </Link>
            <Nav />
            <span className="badge" title="Network this site reads">
              {config.network === "anvil" ? "local test chain" : config.network}
            </span>
          </div>
        </header>
        <main>{children}</main>
        <footer className="footer">
          Testnet demo · FinTechathon 2026 · Read only: this site holds no keys.
        </footer>
      </body>
    </html>
  );
}
