// recent-test.mjs — prove the edge is STILL LIVE, right now. Runs both strategies on
// only the MOST RECENTLY RESOLVED markets (last N days) and compares to the full
// history. If the edge held on the freshest data, it hasn't decayed / been competed
// away. This is the fastest honest "is it working now" test (no weeks of waiting).
//
// Run: node recent-test.mjs [--days 60]

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { buildWalletBets, categorize } from './src/polymarket.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const DAYS = arg('days', 60), SLIP = 0.03;
const cachePath = new URL('./wallet-bets-cache.json', import.meta.url).pathname;

let wb;
if (existsSync(cachePath)) { console.log('Loading cached real bets…'); wb = new Map(JSON.parse(readFileSync(cachePath))); }
else { wb = await buildWalletBets({ sinceISO: '2024-01-01', marketLimit: 2500 }); writeFileSync(cachePath, JSON.stringify([...wb])); }
if ([...wb.values()][0]?.[0]?.resolvedAt === undefined) { console.log('Rebuilding (need resolvedAt)…'); wb = await buildWalletBets({ sinceISO: '2024-01-01', marketLimit: 2500 }); writeFileSync(cachePath, JSON.stringify([...wb])); }

const normCdf = (x) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)); const d = 0.3989423 * Math.exp(-x * x / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
const all = [...wb.values()].flat().filter((b) => b.cost > 0 && b.cost < 1 && b.title && b.resolvedAt).map((b) => ({ ...b, cat: categorize(b.title), usd: b.size * b.cost }));

// recency by TRADE time (when the bet was actually placed) — cleaner than endDate
const maxT = all.reduce((m, b) => (b.time > m ? b.time : m), 0);
const cut = maxT - DAYS * 864e5;
const recentDate = new Date(maxT).toISOString().slice(0, 10);
console.log(`\nLatest bet ${recentDate}. Comparing FULL history vs LAST ${DAYS} DAYS of betting.\n`);

function report(label, rows) {
  if (rows.length < 20) { console.log(`  ${label.padEnd(22)}: too few (${rows.length})`); return; }
  const exp = rows.reduce((s, b) => s + b.cost, 0), act = rows.reduce((s, b) => s + b.won, 0);
  const z = (act - exp) / Math.sqrt(rows.reduce((s, b) => s + b.cost * (1 - b.cost), 0));
  let st = 0, pnl = 0; for (const b of rows) { const e = Math.min(0.95, b.cost + SLIP); st += e; pnl += b.won ? 1 - e : -e; }
  console.log(`  ${label.padEnd(22)}: n=${String(rows.length).padStart(5)} · win ${(act / rows.length * 100).toFixed(0)}% · z=${z.toFixed(1)} · p=${(1 - normCdf(z)) < 1e-4 ? '<0.0001' : (1 - normCdf(z)).toFixed(3)} · ROI ${(pnl / st * 100 >= 0 ? '+' : '') + (pnl / st * 100).toFixed(1)}%`);
}

const fav = (rows) => rows.filter((b) => b.cost >= 0.65 && b.cost <= 0.85);
const inf = (rows) => rows.filter((b) => b.usd >= 1000 && b.cost >= 0.35 && b.cost <= 0.70 && !['sports', 'crypto'].includes(b.cat));
const recent = all.filter((b) => b.time >= cut);

console.log('── FAVORITES ──');
report('full history', fav(all));
report(`last ${DAYS} days`, fav(recent));
console.log('\n── INFORMED MONEY ──');
report('full history', inf(all));
report(`last ${DAYS} days`, inf(recent));
console.log('\nIf the LAST-60-DAYS numbers are still positive/significant, the edge is LIVE — not');
console.log('decayed. If they collapsed vs full history, the edge is being competed away.');
