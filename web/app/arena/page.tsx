import { headers } from "next/headers";
import QRCode from "qrcode";
import { config } from "@/lib/config";
import ArenaClient from "./ArenaClient";

export const dynamic = "force-dynamic";

async function arenaUrl(): Promise<string> {
  if (config.publicArenaUrl) return config.publicArenaUrl;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}/arena`;
}

export default async function ArenaPage() {
  const url = await arenaUrl();
  const svg = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  const qrSrc = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return (
    <div className="stack">
      <div>
        <h1>Attack arena: try to make the agent pay you</h1>
        <p className="muted">
          Paste a fake invoice, a phishing email or a chat message. It goes through the same pipeline as real mail: a
          reader with no tools, a planner, the plan&apos;s limits, then the contract.
        </p>
      </div>
      <div className="banner banner-info">
        <strong>Runs on a local test chain (Anvil fork), never the demo Safe.</strong> Only the outcome and the first 80
        characters of each attempt are shown on the board.
      </div>
      <div className="arena-top">
        <figure className="qr">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <p className="qr-hint">Scan to play on your phone</p>
          <img src={qrSrc} alt={`QR code for ${url}`} width={200} height={200} />
          <figcaption className="mono small">{url}</figcaption>
        </figure>
        <ArenaClient />
      </div>
    </div>
  );
}
