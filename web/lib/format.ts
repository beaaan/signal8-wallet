// Pure display helpers, safe to import from client components.
import { formatUnits } from "viem";

/** "12,345.5" from raw token units (decimal string or bigint). */
export function fmtUnits(raw: string | bigint | null | undefined, decimals = 6): string {
  if (raw === null || raw === undefined) return "–";
  const s = formatUnits(BigInt(raw), decimals);
  return fmtDecimal(s);
}

/** "12,345.5" from a decimal string in token units (as written in the plan book). */
export function fmtDecimal(s: string): string {
  const [int, frac] = s.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const f = (frac ?? "").replace(/0+$/, "").slice(0, 2);
  return f ? `${grouped}.${f}` : grouped;
}

export function shortAddr(a: string | null | undefined): string {
  if (!a) return "–";
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

export function shortHash(h: string | null | undefined): string {
  if (!h) return "–";
  return h.length > 14 ? `${h.slice(0, 10)}…${h.slice(-4)}` : h;
}

/** Block explorer base URL for a chain, or null (anvil has none). */
export function explorerBase(chainId: number | null | undefined): string | null {
  if (chainId === 84532) return "https://sepolia.basescan.org";
  if (chainId === 8453) return "https://basescan.org";
  return null;
}

export function txLink(chainId: number | null | undefined, tx: string | null | undefined): string | null {
  const base = explorerBase(chainId);
  return base && tx && /^0x[0-9a-fA-F]{64}$/.test(tx) ? `${base}/tx/${tx}` : null;
}

export function timeAgo(isoOrSeconds: string | number | null | undefined, now = Date.now()): string {
  if (isoOrSeconds === null || isoOrSeconds === undefined) return "";
  const t = typeof isoOrSeconds === "number" ? isoOrSeconds * 1000 : Date.parse(isoOrSeconds);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

