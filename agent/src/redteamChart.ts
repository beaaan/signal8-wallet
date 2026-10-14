// `npm run redteam:chart [-- <summary.json>] [--out <file.svg>]`: the deck figure for the red-team benchmark.
// Three headline tiles (attack runs the attacker won, funds lost, benign tasks done right), bare agent vs ours, then
// one row per attack family with each side's attacker wins as a dot. Reads the same summary as npm run redteam:table
// (default redteam/results/summary.json); writes an SVG next to the screenshots in docs/images. Read-only otherwise.

import { readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { PATHS, REPO_ROOT } from "./config.ts";
import { isMain } from "./isMain.ts";
import { parseSummary, type Sides } from "./redteamTable.ts";

type Side = NonNullable<Sides["ours"]>;

// Reference palette (dataviz skill), light mode; validated as a pair: CVD ΔE 24.7, normal-vision ΔE 33.6.
const C = {
  surface: "#fcfcfb",
  ink: "#0b0b0b",
  ink2: "#52514e",
  muted: "#8a8984",
  grid: "#e4e3df",
  ours: "#2a78d6", // categorical slot 1
  bare: "#eb6834", // categorical slot 2
};

const FAMILY: Record<string, string> = {
  bank_detail_change: "Fake bank-detail change",
  encoded: "Encoded payloads",
  escalation: "Permission escalation",
  fake_storm_warning: "Fake storm warning",
  poisoned_memory: "Poisoned memory",
  registered_payee_abuse: "Registered-payee abuse",
  role_play: "Role-play reframing",
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const text = (x: number, y: number, s: string, size: number, fill: string, opts: { weight?: number; anchor?: "start" | "middle" | "end" } = {}) =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-weight="${opts.weight ?? 400}" text-anchor="${opts.anchor ?? "start"}">${esc(s)}</text>`;

function totals(s: Side) {
  const runs = s.families.reduce((n, f) => n + f.runs, 0);
  const wins = s.families.reduce((n, f) => n + f.attackerWins, 0);
  const lost = s.families.reduce((n, f) => n + Number(f.fundsLost), 0);
  return { runs, wins, lost };
}

const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** The figure as SVG (1600×900, a 16:9 slide). Both sides must be present. */
export function redteamChartSvg(s: Required<Sides>, caption: string): string {
  const W = 1600;
  const H = 900;
  const L = 80;
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Inter, 'Helvetica Neue', Arial, sans-serif">`);
  out.push(`<rect width="${W}" height="${H}" fill="${C.surface}"/>`);
  out.push(text(L, 92, "Red team: who can talk the agent out of the money?", 44, C.ink, { weight: 600 }));
  out.push(text(L, 136, caption, 22, C.ink2));

  // Legend (two series): a swatch beside each name; the names are ink, never the series colour.
  const legend = [
    ["Bare agent (model + wallet tool)", C.bare],
    ["Signal 8 Wallet", C.ours],
  ] as const;
  let lx = L;
  for (const [name, colour] of legend) {
    out.push(`<circle cx="${lx + 9}" cy="${178}" r="9" fill="${colour}"/>`);
    out.push(text(lx + 28, 186, name, 22, C.ink));
    lx += 28 + name.length * 11.5 + 48;
  }

  // Headline tiles: label, then each side's value.
  const b = totals(s.bare);
  const o = totals(s.ours);
  const tiles = [
    { label: "Attack runs the attacker won", bare: `${b.wins} / ${b.runs}`, ours: `${o.wins} / ${o.runs}` },
    { label: "Funds lost (mUSD)", bare: money(b.lost), ours: money(o.lost) },
    { label: "Benign tasks done right", bare: `${s.bare.benign.passed} / ${s.bare.benign.cases}`, ours: `${s.ours.benign.passed} / ${s.ours.benign.cases}` },
  ];
  const tw = (W - 2 * L - 2 * 32) / 3;
  tiles.forEach((t, i) => {
    const x = L + i * (tw + 32);
    const y = 224;
    out.push(`<rect x="${x}" y="${y}" width="${tw}" height="196" rx="12" fill="#ffffff" stroke="${C.grid}" stroke-width="2"/>`);
    out.push(text(x + 28, y + 48, t.label, 22, C.ink2));
    for (const [j, [v, colour, who]] of ([[t.bare, C.bare, "Bare"], [t.ours, C.ours, "Ours"]] as const).entries()) {
      const vx = x + 28 + j * (tw / 2);
      out.push(`<rect x="${vx}" y="${y + 76}" width="6" height="88" rx="3" fill="${colour}"/>`);
      out.push(text(vx + 20, y + 102, who, 20, C.ink2));
      out.push(text(vx + 20, y + 152, v, 46, C.ink, { weight: 600 }));
    }
  });

  // Per-family dot rows: x = attacker wins out of that family's runs.
  const families = [...new Set([...s.bare.families, ...s.ours.families].map((f) => f.family))].sort();
  const top = 476;
  const rowH = (H - 60 - top) / families.length;
  const x0 = L + 360;
  const x1 = W - L - 120;
  const maxRuns = Math.max(...[...s.bare.families, ...s.ours.families].map((f) => f.runs));
  const xs = (n: number) => x0 + (n / maxRuns) * (x1 - x0);
  out.push(text(L, top - 14, "Attacker wins per attack family, out of each family's runs (ordinary day + storm mode)", 20, C.ink2));
  for (let n = 0; n <= maxRuns; n += Math.max(1, Math.ceil(maxRuns / 8))) {
    out.push(`<line x1="${xs(n)}" y1="${top}" x2="${xs(n)}" y2="${H - 60}" stroke="${C.grid}" stroke-width="1"/>`);
    out.push(text(xs(n), H - 32, String(n), 18, C.muted, { anchor: "middle" }));
  }
  families.forEach((fam, i) => {
    const cy = top + i * rowH + rowH / 2;
    const fb = s.bare.families.find((f) => f.family === fam);
    const fo = s.ours.families.find((f) => f.family === fam);
    out.push(text(L, cy + 7, FAMILY[fam] ?? fam, 21, C.ink));
    out.push(`<line x1="${x0}" y1="${cy}" x2="${x1}" y2="${cy}" stroke="${C.grid}" stroke-width="2"/>`);
    // Two dots per row, nudged apart vertically so equal counts never hide each other; a 2px surface ring each.
    for (const [f, colour, dy] of [[fb, C.bare, -7], [fo, C.ours, 7]] as const) {
      if (!f) continue;
      out.push(`<circle cx="${xs(f.attackerWins)}" cy="${cy + dy}" r="8" fill="${colour}" stroke="${C.surface}" stroke-width="2"/>`);
    }
    const label = `${fb ? `${fb.attackerWins}/${fb.runs}` : "–"} · ${fo ? `${fo.attackerWins}/${fo.runs}` : "–"}`;
    out.push(text(x1 + 24, cy + 7, label, 19, C.ink2));
  });
  out.push(text(x1 + 24, top - 14, "bare · ours", 18, C.muted));
  out.push("</svg>");
  return out.join("\n");
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  const outAt = args.indexOf("--out");
  const out = outAt >= 0 ? args[outAt + 1]! : join(REPO_ROOT, "docs", "images", "redteam-chart.svg");
  const file = args.find((a, i) => !a.startsWith("--") && i !== outAt + 1) ?? join(PATHS.redteam, "results", "summary.json");
  const sides = parseSummary(JSON.parse(readFileSync(file, "utf8")));
  if (!sides.bare || !sides.ours) {
    console.error(`${file} needs both sides (npm run redteam -- --model and npm run redteam:bare)`);
    process.exit(1);
  }
  const day = (d?: string) => d?.slice(0, 10) ?? "undated";
  const lost = [sides.bare, sides.ours].map((x) => totals(x).lost);
  const attacks = sides.ours.families.reduce((n, f) => n + f.cases, 0);
  const caption = `Same model on both sides (${sides.ours.provider}), ${day(sides.ours.generatedAt)}; ${attacks} attacks, each on an ordinary day and in storm mode.${lost.every((n) => n === 0) ? " No funds were lost on either side." : ""}`;
  writeFileSync(out, redteamChartSvg({ bare: sides.bare, ours: sides.ours }, caption));
  console.log(`Wrote ${relative(REPO_ROOT, out)}`);
}
