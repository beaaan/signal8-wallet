import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { config } from "@/lib/config";
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
          <Link href="/" className="brand">
            Signal 8 Wallet
          </Link>
          <nav>
            <Link href="/">Dashboard</Link>
            <Link href="/plan">Plan</Link>
            <Link href="/arena">Arena</Link>
          </nav>
          <span className="badge" title="NETWORK">
            {config.network}
          </span>
        </header>
        <main>{children}</main>
        <footer className="footer">
          Testnet demo for FinTechathon 2026. Read-only: this site holds no keys and sends no transactions.
        </footer>
      </body>
    </html>
  );
}
