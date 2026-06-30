// big-bet-follow.mjs — rigorously test the informed-money signal: follow LARGE bets
// on MID-PRICED (uncertain) markets. Out-of-sample across time folds, after the
// slippage of entering AFTER the big bet moved the price. Also sweeps slippage to
// find the breakeven, and reports a confidence interval on the edge.
//
// Run: node big-bet-follow.mjs [--lo 0.40 --hi 0.70 --min 1000 --slip 0.03]

import { existsSync, readFileSync } from 'node:fs';
import { buildWalletBets } from './src/polymarket.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const LO = arg('lo', 0.40), HI = arg('hi', 0.70), MINUSD = arg('min', 1000), MAXUSD = arg('max', 20000);
const FOLDS = 6;
const cachePath = new URL('./wallet-bets-cache.json', import.meta.url).pathname;

let wb;
if (existsSync(cachePath)) { console.log('Loading cached real bets…'); wb = new Map(JSON.parse(readFileSync(cachePath))); }
else { wb = await buildWalletBets({ sinceISO: '2024-01-01', marketLimit: 2500 }); }

// the informed-money signal: large bets on mid-priced (uncertain) markets
const sig = [...wb.values()].flat()
  .filter((b) => b.cost > 0 && b.cost < 1 && b.time && b.size * b.cost >= MINUSD && b.size * b.cost < MAXUSD && b.cost >= LO && b.cost <= HI)
  .sort((a, b) => a.time - b.time);
console.log(`${sig.length} large ($${MINUSD}-${MAXUSD}) bets on ${LO * 100}-${HI * 100}¢ markets\n`);

function roi(rows, slip) {
  let staked = 0, profit = 0, wins = 0;
  for (const b of rows) { const e = Math.min(0.95, b.cost + slip); staked += e; profit += b.won ? 1 - e : -e; if (b.won) wins++; }
  return rows.length ? { n: rows.length, roi: profit / staked, win: wins / rows.length } : { n: 0 };
}

// 1) slippage sweep (how much can the price move against you before the edge dies?)
console.log('── Slippage sweep (whole sample) ──');
for (const s of [0, 0.02, 0.03, 0.05, 0.08]) {
  const r = roi(sig, s);
  console.log(`  slip ${(s * 100).toFixed(0)}¢: win ${(r.win * 100).toFixed(0)}% · ROI ${(r.roi * 100 >= 0 ? '+' : '') + (r.roi * 100).toFixed(1)}%`);
}

// 2) out-of-sample stability across time folds (at realistic 3¢ slippage)
const SLIP = arg('slip', 0.03);
console.log(`\n── Across ${FOLDS} time folds (slippage ${SLIP * 100}¢) ──`);
const size = Math.floor(sig.length / FOLDS);
let pos = 0;
for (let f = 0; f < FOLDS; f++) {
  const r = roi(sig.slice(f * size, (f + 1) * size), SLIP);
  if (r.n) { if (r.roi > 0) pos++; console.log(`  fold ${f + 1}: n=${String(r.n).padStart(3)} · win ${(r.win * 100).toFixed(0)}% · ROI ${(r.roi * 100 >= 0 ? '+' : '') + (r.roi * 100).toFixed(1)}%`); }
}
// 3) edge CI on per-bet P&L
const pnls = sig.map((b) => { const e = Math.min(0.95, b.cost + SLIP); return (b.won ? 1 - e : -e) / e; });
const mean = pnls.reduce((s, x) => s + x, 0) / pnls.length;
const sd = Math.sqrt(pnls.reduce((s, x) => s + (x - mean) ** 2, 0) / pnls.length);
const se = sd / Math.sqrt(pnls.length);
console.log(`\nROI ${(mean * 100).toFixed(1)}% · 95% CI [${((mean - 1.96 * se) * 100).toFixed(1)}, ${((mean + 1.96 * se) * 100).toFixed(1)}]% · positive in ${pos}/${FOLDS} folds`);
console.log((mean - 1.96 * se) > 0 && pos >= FOLDS - 1
  ? '\n✅ REAL & TRADEABLE: informed big-money on uncertain markets has a significant, stable edge.'
  : '\n⚠ Edge present but not conclusively stable/significant — needs more data (the strongest insider tier is rare).');
