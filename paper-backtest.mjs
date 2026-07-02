// paper-backtest.mjs — REALISTIC capital-constrained paper trade on recent favorites.
// Respects: your bankroll, ≤50% deployed, ≤30%/category, position cap, AND capital
// lockup (money is tied up from entry until the market resolves, then recycles).
// One position per market. This gives the honest $ return on a real bankroll.
//
// Run: node paper-backtest.mjs [--days 120 --bankroll 1000]

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { CONFIG } from './config.mjs';
import { buildWalletBets, categorize } from './src/polymarket.mjs';
import { sparkline } from './src/paper.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const DAYS = arg('days', 120), B0 = arg('bankroll', 1000), SLIP = 0.03, STAKE_FRAC = 0.03;
const cachePath = new URL('./wallet-bets-cache.json', import.meta.url).pathname;

let wb;
if (existsSync(cachePath)) { console.log('Loading cached real bets…'); wb = new Map(JSON.parse(readFileSync(cachePath))); }
else { wb = await buildWalletBets({ sinceISO: '2024-01-01', marketLimit: 2500 }); writeFileSync(cachePath, JSON.stringify([...wb])); }

// one favorite POSITION per market: entry = first time it was a 65-85¢ favorite,
// exit = resolution date, price = median entry, won = outcome
const byMarket = new Map();
for (const b of [...wb.values()].flat()) {
  if (!(b.cost >= 0.65 && b.cost <= 0.85) || !b.time) continue;
  const g = byMarket.get(b.marketId) || { costs: [], entry: Infinity, exit: 0, won: b.won, cat: categorize(b.title || '') };
  g.costs.push(b.cost); g.entry = Math.min(g.entry, b.time); g.exit = Math.max(g.exit, b.resolvedAt || b.time); byMarket.set(b.marketId, g);
}
let positions = [...byMarket.entries()].map(([marketId, g]) => {
  const price = g.costs.sort((a, b) => a - b)[Math.floor(g.costs.length / 2)];
  let exit = g.exit; if (exit <= g.entry) exit = g.entry + 14 * 864e5;   // guard
  return { marketId, cat: g.cat, entry: g.entry, exit, price, won: g.won };
}).sort((a, b) => a.entry - b.entry);

const maxT = positions.reduce((m, p) => Math.max(m, p.entry), 0);
positions = positions.filter((p) => p.entry >= maxT - DAYS * 864e5);

// capital-constrained chronological simulation
let cash = B0, deployed = 0, peak = B0, maxDD = 0, opened = 0, wins = 0, closed = 0;
const catDeployed = new Map(); const open = []; const curve = [];
let concurrentSum = 0, holdSum = 0;

function closeDue(t) {
  for (let i = open.length - 1; i >= 0; i--) {
    if (open[i].exit <= t) {
      const p = open[i];
      cash += p.won ? p.shares : 0;                 // payout $1/share if won
      deployed -= p.stake; catDeployed.set(p.cat, (catDeployed.get(p.cat) || 0) - p.stake);
      if (p.won) wins++; closed++; holdSum += (p.exit - p.entryT);
      open.splice(i, 1);
    }
  }
}

for (const p of positions) {
  closeDue(p.entry);
  const equity = cash + deployed;
  const entry = Math.min(0.95, p.price + SLIP);
  let stake = Math.min(equity * STAKE_FRAC, equity * CONFIG.MAX_BANKROLL_FRAC);
  stake = Math.min(stake, equity * CONFIG.MAX_DEPLOYED_FRAC - deployed);            // deploy cap
  stake = Math.min(stake, equity * CONFIG.MAX_CATEGORY_FRAC - (catDeployed.get(p.cat) || 0)); // category cap
  if (stake < 5 || open.length >= CONFIG.MAX_POSITIONS || stake > cash) { curve.push(cash + deployed); continue; }
  cash -= stake; deployed += stake; catDeployed.set(p.cat, (catDeployed.get(p.cat) || 0) + stake);
  open.push({ stake, shares: stake / entry, exit: p.exit, entryT: p.entry, won: p.won, cat: p.cat });
  opened++; concurrentSum += open.length; curve.push(cash + deployed);
}
// resolve any still open
closeDue(Infinity);

// max drawdown from the equity curve
let pk = B0; for (const e of curve) { pk = Math.max(pk, e); maxDD = Math.min(maxDD, e - pk); }
peak = pk;

const finalEq = cash;
const spanDays = (maxT - positions[0].entry) / 864e5 || DAYS;
const ret = finalEq / B0 - 1;
console.log(`\n──────── REALISTIC PAPER TRADE ($${B0} bankroll, capital-constrained) ────────`);
console.log(`Window: ${(spanDays).toFixed(0)} days · ${opened} positions opened (of ${positions.length} favorites available)`);
console.log(`Avg concurrent positions: ${(concurrentSum / (opened || 1)).toFixed(0)} · avg hold: ${(holdSum / (closed || 1) / 864e5).toFixed(0)} days`);
console.log(`Win rate:      ${(wins / (closed || 1) * 100).toFixed(1)}%`);
console.log(`Bankroll:      $${B0} → $${finalEq.toFixed(0)}   (${(ret * 100 >= 0 ? '+' : '') + (ret * 100).toFixed(1)}%)`);
console.log(`Annualized:    ~${((Math.pow(1 + ret, 365 / spanDays) - 1) * 100).toFixed(0)}%`);
console.log(`Max drawdown:  $${maxDD.toFixed(0)} (${(maxDD / peak * 100 || maxDD / B0 * 100).toFixed(0)}%)`);
console.log(`Equity curve:  ${sparkline(curve)}`);
console.log('\nRealistic: capped at what a $' + B0 + ' bankroll can actually deploy, diversified, with');
console.log('capital locked until each market resolves. THIS is the honest expected return.');
