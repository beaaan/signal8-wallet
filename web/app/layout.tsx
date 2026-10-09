import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { config } from "@/lib/config";
import Nav from "./components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Signal 8 Wallet",
  description: "A small-business wallet that follows a plan the owners signed on a calm day.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <div className="topbar-inner">
            <Link href="/" className="brand">
              <span className="brand-mark" aria-hidden>
                8
              </span>
              Signal 8 Wallet
            </Link>
            <Nav />
            <span className="badge" title="Network this site reads">
              {config.network === "anvil" ? "local test chain" : config.network}
            </span>
          </div>
        </header>
        <main>{children}</main>
        <footer className="footer">
          Testnet demo for FinTechathon 2026. This site only reads: it holds no keys and sends no transactions.
        </footer>
      </body>
    </html>
  );
}
