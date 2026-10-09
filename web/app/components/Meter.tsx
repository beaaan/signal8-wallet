export function MeterBar({ label, used, cap, pct, symbol }: { label: string; used: string; cap: string; pct: number; symbol: string }) {
  const tone = pct >= 90 ? "hot" : pct >= 70 ? "warm" : "ok";
  return (
    <div className="meter">
      <div className="meter-label">
        <span>{label}</span>
        <span className="meter-nums">
          <strong>{used}</strong> of {cap} {symbol}
        </span>
      </div>
      <div className="meter-track" role="progressbar" aria-label={label} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <div className={`meter-fill meter-${tone}`} style={{ width: `${Math.max(pct, pct > 0 ? 2 : 0)}%` }} />
      </div>
    </div>
  );
}
