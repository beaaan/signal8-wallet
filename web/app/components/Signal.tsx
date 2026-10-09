// The Hong Kong Observatory tropical cyclone signal, drawn like the real symbols, and the GDACS alert chip.
import { gdacsName } from "@/lib/words";

function Symbol({ level }: { level: number }) {
  switch (level) {
    case 1: // T
      return <path d="M6 6h28v6H23v22h-6V12H6z" />;
    case 3: // inverted T
      return <path d="M17 6h6v22h11v6H6v-6h11z" />;
    case 8: // triangle
      return <path d="M20 5 36 34H4z" />;
    case 9: // hourglass
      return <path d="M6 5h28L20 20l14 15H6l14-15z" />;
    case 10: // cross
      return <path d="M17 4h6v13h13v6H23v13h-6V23H4v-6h13z" />;
    default:
      return <circle cx="20" cy="20" r="9" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="4 4" />;
  }
}

export function SignalBadge({ level, size = "md" }: { level: number | null; size?: "sm" | "md" | "lg" }) {
  const l = level ?? -1;
  const label = l > 0 ? `Signal No. ${l}` : l === 0 ? "No typhoon signal" : "Signal unknown";
  return (
    <span className={`signal signal-${size} ${l >= 8 ? "signal-high" : ""}`} role="img" aria-label={label} title={label}>
      <svg viewBox="0 0 40 40" fill="currentColor" aria-hidden>
        <Symbol level={l} />
      </svg>
      <span className="signal-no">{l > 0 ? `No. ${l}` : l === 0 ? "None" : "?"}</span>
    </span>
  );
}

export function GdacsChip({ level }: { level: number | null }) {
  const l = level ?? -1;
  return (
    <span className={`gdacs gdacs-${l < 0 ? "x" : l}`} title="GDACS alert level (Global Disaster Alert and Coordination System)">
      GDACS {l < 0 ? "unknown" : l === 0 ? "no alert" : gdacsName(l)}
    </span>
  );
}
