// winners.mjs — test the EXACT "biggest winners" idea: rank wallets by REALIZED
// PROFIT in a training period, then follow their bets in a later period. Also
// analyze WHAT the top winners actually do (are they favorite-buyers?).
//
// Run: node winners.mjs

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { buildWalletBets } from './src/polymarket.mjs';

const SLIP = 0.02, MIN_TRAIN = 20, TOPN = 60;
const cachePath = new URL('./wallet-bets-cache.json', import.meta.url).pathname;

let wb;
if (existsSync(cachePath)) { console.log('Loading cached real bets…'); wb = new Map(JSON.parse(readFileSync(cachePath))); }
else { wb = await buildWalletBets({ sinceISO: '2024-01-01', marketLimit: 2500 }); writeFileSync(cachePath, JSON.stringify([...wb])); }

const all = [...wb.values()].flat().filter((b) => b.time && b.cost > 0 && b.cost < 1).sort((a, b) => a.time - b.time);
const split = all[Math.floor(all.length * 0.6)].time;
const profitOf = (b) => (b.won ? b.size * (1 - b.cost) : -b.size * b.cost);

// rank wallets by REALIZED PROFIT in the training period
const train = new Map();
for (const [w, bets] of wb) {
  const tb = bets.filter((b) => b.time < split && b.cost > 0 && b.cost < 1);
  if (tb.length < MIN_TRAIN) continue;
  train.set(w, { profit: tb.reduce((s, b) => s + profitOf(b), 0), n: tb.length, avgCost: tb.reduce((s, b) => s + b.cost, 0) / tb.length, favFrac: tb.filter((b) => b.cost >= 0.65 && b.cost <= 0.9).length / tb.length });
}
const ranked = [...train.entries()].sort((a, b) => b[1].profit - a[1].profit);
const topWinners = ranked.slice(0, TOPN);
console.log(`\nTop ${TOPN} winners by realized training profit:`);
console.log(`  avg training profit $${(topWinners.reduce((s, [, v]) => s + v.profit, 0) / TOPN).toFixed(0)}`);
console.log(`  avg bet price ${(topWinners.reduce((s, [, v]) => s + v.avgCost, 0) / TOPN * 100).toFixed(0)}¢   (high = favorite-buyers)`);
console.log(`  avg % of bets in favorite band (65-90¢): ${(topWinners.reduce((s, [, v]) => s + v.favFrac, 0) / TOPN * 100).toFixed(0)}%`);

// follow their FORWARD (test) bets two ways
function follow(filterFav) {
  let staked = 0, profit = 0, n = 0, wins = 0;
  for (const [w] of topWinners) {
    for (const b of wb.get(w)) {
      if (b.time < split || !(b.cost > 0 && b.cost < 1)) continue;
      if (filterFav && !(b.cost >= 0.65 && b.cost <= 0.85)) continue;
      const entry = Math.min(0.98, b.cost + SLIP);
      staked += entry; profit += b.won ? 1 - entry : -entry; n++; if (b.won) wins++;
    }
  }
  return n ? { n, roi: profit / staked, win: wins / n } : { n: 0 };
}

const allF = follow(false), favF = follow(true);
console.log('\n── Following top winners FORWARD (out-of-sample, after slippage) ──');
console.log(`  ALL their bets:        ${allF.n} follows · win ${(allF.win * 100).toFixed(0)}% · ROI ${(allF.roi * 100 >= 0 ? '+' : '') + (allF.roi * 100).toFixed(1)}%`);
console.log(`  ONLY favorite-band:    ${favF.n} follows · win ${(favF.win * 100).toFixed(0)}% · ROI ${(favF.roi * 100 >= 0 ? '+' : '') + (favF.roi * 100).toFixed(1)}%`);
console.log('\nIf "ALL" loses but "favorite-band" wins, the truth is: the biggest winners win');
console.log('BECAUSE they buy favorites — the edge is the favorite bias, not insider info.');
console.log('You do not need to track anyone; just buy favorites directly.');
