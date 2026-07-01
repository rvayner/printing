// insider-signal.mjs — a STATISTICALLY STRUCTURED insider signal. Combines the
// documented indicators (fresh wallet + big size + non-sports event + uncertain
// price) into a score, then validates each score tier with a calibration z-score
// (is the win rate anomalous vs the price by more than chance — the p-value test
// the detection tools use). Confirms the signal is consistent + accurate.
//
// Run: node insider-signal.mjs

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { buildWalletBets, categorize } from './src/polymarket.mjs';

const FRESH_K = 10, BIG = 1000, VBIG = 4000, SLIP = 0.03;
const cachePath = new URL('./wallet-bets-cache.json', import.meta.url).pathname;

let wb;
if (existsSync(cachePath)) { console.log('Loading cached real bets…'); wb = new Map(JSON.parse(readFileSync(cachePath))); }
else { wb = await buildWalletBets({ sinceISO: '2024-01-01', marketLimit: 2500 }); writeFileSync(cachePath, JSON.stringify([...wb])); }
if ([...wb.values()][0]?.[0]?.title === undefined) { console.log('Rebuilding cache (need title)…'); wb = await buildWalletBets({ sinceISO: '2024-01-01', marketLimit: 2500 }); writeFileSync(cachePath, JSON.stringify([...wb])); }

const normCdf = (x) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)); const d = 0.3989423 * Math.exp(-x * x / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };

// assign each bet its wallet-freshness (# prior bets by that wallet) + features
const bets = [];
for (const [, arr] of wb) {
  const s = arr.filter((b) => b.cost > 0 && b.cost < 1 && b.size > 0 && b.title).sort((a, b) => a.time - b.time);
  s.forEach((b, i) => {
    const cat = categorize(b.title), usd = b.size * b.cost;
    bets.push({ ...b, prior: i, cat, usd,
      fresh: i < FRESH_K, big: usd >= BIG, vbig: usd >= VBIG,
      event: !['sports', 'crypto'].includes(cat), uncertain: b.cost >= 0.30 && b.cost <= 0.70 });
  });
}

// statistical calibration test for a cohort
function stat(rows) {
  const n = rows.length; if (!n) return { n: 0 };
  const exp = rows.reduce((s, b) => s + b.cost, 0), act = rows.reduce((s, b) => s + b.won, 0);
  const varr = rows.reduce((s, b) => s + b.cost * (1 - b.cost), 0) || 1e-9;
  const z = (act - exp) / Math.sqrt(varr);
  let staked = 0, pnl = 0; for (const b of rows) { const e = Math.min(0.95, b.cost + SLIP); staked += e; pnl += b.won ? 1 - e : -e; }
  return { n, price: exp / n, win: act / n, edge: (act - exp) / n, z, p: 1 - normCdf(z), roi: pnl / staked };
}
const show = (label, rows) => { const r = stat(rows); if (r.n < 15) { console.log(`  ${label}: too few (${r.n})`); return; } console.log(`  ${label.padEnd(34)} n=${String(r.n).padStart(5)} · price ${(r.price * 100).toFixed(0)}¢ · win ${(r.win * 100).toFixed(0)}% · z=${r.z.toFixed(1)} · p=${r.p < 0.001 ? '<0.001' : r.p.toFixed(3)} · ROI ${(r.roi * 100 >= 0 ? '+' : '') + (r.roi * 100).toFixed(0)}%`); };

console.log('\n── Building the insider signal, tier by tier (z = statistical significance) ──');
show('all big event bets', bets.filter((b) => b.big && b.event));
show('+ uncertain (35-70¢)', bets.filter((b) => b.big && b.event && b.uncertain));
show('+ FRESH wallet', bets.filter((b) => b.big && b.event && b.uncertain && b.fresh));
show('+ FRESH + VERY big ($4k+)', bets.filter((b) => b.vbig && b.event && b.uncertain && b.fresh));

// graded insider score 0-5 → does edge/z rise monotonically?
console.log('\n── Insider score (fresh + big + very-big + event + uncertain) vs outcome ──');
const score = (b) => (b.fresh ? 1 : 0) + (b.big ? 1 : 0) + (b.vbig ? 1 : 0) + (b.event ? 1 : 0) + (b.uncertain ? 1 : 0);
for (let s = 5; s >= 2; s--) show(`score ${s}`, bets.filter((b) => score(b) === s));

console.log('\nIf edge + z rise as the score rises, and the top tier has p<0.05 with real ROI,');
console.log('the insider signal is statistically confirmed — consistent and accurate.');
