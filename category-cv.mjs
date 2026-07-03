// category-cv.mjs — deepest confidence test: does the favorites edge hold
// INDEPENDENTLY in every market category? If politics, sports, crypto, econ, geo
// each show a significant positive edge on their own, it's a structural bias — not
// an artifact of one domain. Reports z-score + ROI per category, both edges.
//
// Run: node category-cv.mjs

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { buildWalletBets, categorize } from './src/polymarket.mjs';

const SLIP = 0.03;
const cachePath = new URL('./wallet-bets-cache.json', import.meta.url).pathname;
let wb;
if (existsSync(cachePath)) { console.log('Loading cached real bets…'); wb = new Map(JSON.parse(readFileSync(cachePath))); }
else { wb = await buildWalletBets({ sinceISO: '2024-01-01', marketLimit: 2500 }); writeFileSync(cachePath, JSON.stringify([...wb])); }
if ([...wb.values()][0]?.[0]?.title === undefined) { console.log('Rebuilding (need title)…'); wb = await buildWalletBets({ sinceISO: '2024-01-01', marketLimit: 2500 }); writeFileSync(cachePath, JSON.stringify([...wb])); }

const normCdf = (x) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)); const d = 0.3989423 * Math.exp(-x * x / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
const bets = [...wb.values()].flat().filter((b) => b.cost > 0 && b.cost < 1 && b.title).map((b) => ({ ...b, cat: categorize(b.title), usd: b.size * b.cost }));

function stat(rows) {
  if (rows.length < 20) return null;
  const exp = rows.reduce((s, b) => s + b.cost, 0), act = rows.reduce((s, b) => s + b.won, 0);
  const z = (act - exp) / Math.sqrt(rows.reduce((s, b) => s + b.cost * (1 - b.cost), 0));
  let st = 0, pnl = 0; for (const b of rows) { const e = Math.min(0.95, b.cost + SLIP); st += e; pnl += b.won ? 1 - e : -e; }
  return { n: rows.length, win: act / rows.length, price: exp / rows.length, z, p: 1 - normCdf(z), roi: pnl / st };
}
const line = (label, r) => r ? console.log(`  ${label.padEnd(12)}: n=${String(r.n).padStart(5)} · win ${(r.win * 100).toFixed(0)}% vs ${(r.price * 100).toFixed(0)}¢ · z=${r.z.toFixed(1)} · p=${r.p < 1e-4 ? '<0.0001' : r.p.toFixed(3)} · ROI ${(r.roi * 100 >= 0 ? '+' : '') + (r.roi * 100).toFixed(1)}%${r.z > 2 ? ' ✅' : ''}`) : console.log(`  ${label.padEnd(12)}: too few`);

const CATS = ['politics', 'geopolitics', 'econ', 'crypto', 'sports', 'other'];
console.log('\n══ FAVORITES edge (65-85¢) — does it hold in EVERY category? ══');
let allPass = true;
for (const c of CATS) { const r = stat(bets.filter((b) => b.cat === c && b.cost >= 0.65 && b.cost <= 0.85)); line(c, r); if (!r || r.z < 2) allPass = false; }
console.log(allPass ? '\n→ Favorites edge is SIGNIFICANT IN EVERY CATEGORY — structural, not a fluke. ✅' : '\n→ Some categories weak — edge is not uniform.');

console.log('\n══ INFORMED MONEY (big uncertain event bets) — by category ══');
for (const c of ['politics', 'geopolitics', 'econ', 'other']) line(c, stat(bets.filter((b) => b.cat === c && b.usd >= 1000 && b.cost >= 0.35 && b.cost <= 0.70)));
