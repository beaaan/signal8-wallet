// Small inline SVG icon set (no icon library). Stroke icons follow currentColor.
import type { Kind } from "@/lib/activity";

const PATHS: Record<string, React.ReactNode> = {
  paid: <path d="M7 17 17 7M9 7h8v8" />,
  inflow: <path d="M17 7 7 17M15 17H7V9" />,
  refused: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m5.7 5.7 12.6 12.6" />
    </>
  ),
  proposed: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
    </>
  ),
  signal: <path d="M5 21V4M5 4h11l-2.5 4L16 12H5" />,
  stormOn: <path d="M13 2 4 14h7l-1 8 9-12h-7z" />,
  stormOff: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  cover: <path d="M12 3a9 9 0 0 1 9 9H3a9 9 0 0 1 9-9zM12 12v6.5a2.5 2.5 0 0 0 5 0" />,
  credit: (
    <>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18M7 15h4" />
    </>
  ),
  vault: (
    <>
      <path d="M4 20V10l8-6 8 6v10z" />
      <path d="M9 20v-6h6v6" />
    </>
  ),
  evidence: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  hold: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M10 9v6M14 9v6" />
    </>
  ),
  note: <path d="M4 5h16v11H9l-5 4z" />,
  alert: <path d="M12 3 2 20h20zM12 10v4M12 17v.5" />,
  check: <path d="m5 12 5 5L20 7" />,
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" />,
  cash: (
    <>
      <rect x="3" y="7" width="18" height="12" rx="2" />
      <path d="M3 11h18M16 15h2" />
      <path d="M6 7V5h12v2" />
    </>
  ),
  fund: <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />,
  limit: (
    <>
      <path d="M4 18a8 8 0 1 1 16 0" />
      <path d="m12 18 4-6" />
    </>
  ),
  plan: (
    <>
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M9 12h7M9 16h7M9 8h3" />
    </>
  ),
  timeline: <path d="M4 6h16M4 12h10M4 18h13" />,
};

export function Icon({ name, size = 20, label }: { name: Kind | string; size?: number; label?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className="icon"
    >
      {PATHS[name] ?? PATHS.note}
    </svg>
  );
}
