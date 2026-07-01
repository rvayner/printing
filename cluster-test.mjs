// cluster-test.mjs — validate the RING signature: multiple FRESH wallets converging
// on the SAME outcome in a short window (the Bubblemaps coordinated-insider pattern).
// Do these clusters win more than their price implies (z-tested)? If yes, it's the
// strongest insider tell.
//
// Run: node cluster-test.mjs

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { buildWalletBets, categorize } from './src/polymarket.mjs';

const FRESH_K = 15, RING_MIN = 2, WINDOW = 72 * 3600e3, SLIP = 0.03;
const cachePath = new URL('./wallet-bets-cache.json', import.meta.url).pathname;

let wb;
if (existsSync(cachePath)) { console.log('Loading cached real bets…'); wb = new Map(JSON.parse(readFileSync(cachePath))); }
else { wb = await buildWalletBets({ sinceISO: '2024-01-01', marketLimit: 2500 }); writeFileSync(cachePath, JSON.stringify([...wb])); }
if ([...wb.values()][0]?.[0]?.title === undefined) { console.log('Rebuilding (need title)…'); wb = await buildWalletBets({ sinceISO: '2024-01-01', marketLimit: 2500 }); writeFileSync(cachePath, JSON.stringify([...wb])); }

const normCdf = (x) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)); const d = 0.3989423 * Math.exp(-x * x / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };

// keep only FRESH-wallet bets on NON-sports EVENT markets
const fresh = [];
for (const [, arr] of wb) {
  const s = arr.filter((b) => b.cost > 0 && b.cost < 1 && b.title).sort((a, b) => a.time - b.time);
  s.forEach((b, i) => { const cat = categorize(b.title); if (i < FRESH_K && !['sports', 'crypto'].includes(cat)) fresh.push({ ...b, cat }); });
}

// group by (market, outcome) → collect distinct fresh wallets + times
const groups = new Map();
for (const b of fresh) {
  const key = `${b.marketId}:${b.outcomeIndex}`;
  const g = groups.get(key) || { wallets: new Map(), won: b.won, cost: 0, n: 0 };
  if (!g.wallets.has(b.wallet)) g.wallets.set(b.wallet, b.time);
  g.cost += b.cost; g.n++; groups.set(key, g);
}

// a RING = ≥RING_MIN distinct fresh wallets whose entries span ≤ WINDOW
const rings = [], solo = [];
for (const g of groups.values()) {
  const times = [...g.wallets.values()];
  const span = Math.max(...times) - Math.min(...times);
  const rec = { k: g.wallets.size, price: g.cost / g.n, won: g.won };
  if (g.wallets.size >= RING_MIN && span <= WINDOW) rings.push(rec);
  else if (g.wallets.size === 1) solo.push(rec);
}

function stat(rows) {
  const n = rows.length; if (!n) return { n: 0 };
  const exp = rows.reduce((s, r) => s + r.price, 0), act = rows.reduce((s, r) => s + r.won, 0);
  const varr = rows.reduce((s, r) => s + r.price * (1 - r.price), 0) || 1e-9;
  const z = (act - exp) / Math.sqrt(varr);
  let st = 0, pnl = 0; for (const r of rows) { const e = Math.min(0.95, r.price + SLIP); st += e; pnl += r.won ? 1 - e : -e; }
  return { n, price: exp / n, win: act / n, z, p: 1 - normCdf(z), roi: pnl / st };
}
const show = (label, rows) => { const r = stat(rows); if (r.n < 10) { console.log(`  ${label}: too few (${r.n})`); return; } console.log(`  ${label.padEnd(30)} n=${String(r.n).padStart(4)} · price ${(r.price * 100).toFixed(0)}¢ · win ${(r.win * 100).toFixed(0)}% · z=${r.z.toFixed(1)} · p=${r.p < 0.001 ? '<0.001' : r.p.toFixed(3)} · ROI ${(r.roi * 100 >= 0 ? '+' : '') + (r.roi * 100).toFixed(0)}%`); };

console.log(`\n── Fresh-wallet RING signature (≥${RING_MIN} fresh wallets, same outcome, ≤72h) ──`);
show('RING (≥2 fresh converging)', rings);
show('RING on uncertain (30-70¢)', rings.filter((r) => r.price >= 0.30 && r.price <= 0.70));
show('RING ≥3 fresh wallets', rings.filter((r) => r.k >= 3));
show('SOLO fresh wallet (baseline)', solo);
console.log('\nIf RINGS beat their price with high z (esp. ≥3 wallets / uncertain), coordinated');
console.log('fresh-wallet convergence is the strongest insider tell — the Bubblemaps pattern.');
