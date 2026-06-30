// insider-test.mjs — test the refined thesis: insider info lives in POLITICAL/EVENT
// markets, NOT sports. Re-categorize big bets by the market title and compare the
// edge of large bets across categories and price bands. If political/geo big bets
// beat their price far more than sports, that's the genuine insider signal.
//
// Run: node insider-test.mjs

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { buildWalletBets, categorize } from './src/polymarket.mjs';

const cachePath = new URL('./wallet-bets-cache.json', import.meta.url).pathname;
let wb;
if (existsSync(cachePath)) { console.log('Loading cached real bets…'); wb = new Map(JSON.parse(readFileSync(cachePath))); }
else { wb = await buildWalletBets({ sinceISO: '2024-01-01', marketLimit: 2500 }); writeFileSync(cachePath, JSON.stringify([...wb])); }

// guard: need title (rebuild if old cache)
const sample = [...wb.values()][0]?.[0];
if (sample && sample.title === undefined) {
  console.log('Cache lacks title — rebuilding…');
  wb = await buildWalletBets({ sinceISO: '2024-01-01', marketLimit: 2500 });
  writeFileSync(cachePath, JSON.stringify([...wb]));
}

const bets = [...wb.values()].flat()
  .filter((b) => b.cost > 0 && b.cost < 1 && b.size > 0 && b.title)
  .map((b) => ({ ...b, cat: categorize(b.title), usd: b.size * b.cost }));

const SLIP = 0.03;
const roi = (rows) => { let st = 0, pr = 0, w = 0; for (const b of rows) { const e = Math.min(0.95, b.cost + SLIP); st += e; pr += b.won ? 1 - e : -e; if (b.won) w++; } return rows.length ? { n: rows.length, roi: pr / st, win: w / rows.length, avgP: rows.reduce((s, b) => s + b.cost, 0) / rows.length } : { n: 0 }; };

// big bets (≥$1k) by category, across all price bands
console.log('\n── BIG bets (≥$1000) by category — edge & follow-ROI (3¢ slip) ──');
const cats = ['politics', 'geopolitics', 'econ', 'crypto', 'sports', 'other'];
for (const c of cats) {
  const big = bets.filter((b) => b.usd >= 1000 && b.cat === c);
  const r = roi(big);
  if (r.n < 20) { console.log(`  ${c.padEnd(12)}: too few (${r.n})`); continue; }
  console.log(`  ${c.padEnd(12)}: n=${String(r.n).padStart(5)} · avg price ${(r.avgP * 100).toFixed(0)}¢ · win ${(r.win * 100).toFixed(0)}% · edge ${((r.win - r.avgP) * 100 >= 0 ? '+' : '') + ((r.win - r.avgP) * 100).toFixed(1)}¢ · ROI ${(r.roi * 100 >= 0 ? '+' : '') + (r.roi * 100).toFixed(1)}%`);
}

// the sharpest cut: big bets on NON-sports, by price band (incl longshots where insiders strike)
console.log('\n── NON-SPORTS big bets (≥$1000) by price band ──');
const nonSport = bets.filter((b) => b.usd >= 1000 && b.cat !== 'sports' && b.cat !== 'crypto');
for (const [lbl, lo, hi] of [['longshot <35¢', 0, 0.35], ['mid 35-65¢', 0.35, 0.65], ['favorite 65-90¢', 0.65, 0.90]]) {
  const r = roi(nonSport.filter((b) => b.cost >= lo && b.cost < hi));
  if (r.n < 15) { console.log(`  ${lbl.padEnd(16)}: too few (${r.n})`); continue; }
  console.log(`  ${lbl.padEnd(16)}: n=${String(r.n).padStart(4)} · price ${(r.avgP * 100).toFixed(0)}¢ · win ${(r.win * 100).toFixed(0)}% · edge ${((r.win - r.avgP) * 100 >= 0 ? '+' : '') + ((r.win - r.avgP) * 100).toFixed(1)}¢ · ROI ${(r.roi * 100 >= 0 ? '+' : '') + (r.roi * 100).toFixed(1)}%`);
}
console.log('\nKEY: if NON-sports big bets (esp. politics/geo) beat price more than sports,');
console.log('that is the insider signal — focus the tracker there, not on sports.');
