// consensus.mjs — DEEP TEST of the "weirdly insider" signal: when MULTIPLE proven
// winners pile into the SAME outcome, does it win more than its price implies —
// even controlling for the favorite bias? If yes, winner-consensus is a real
// information edge. If it only works on favorites, it's just the favorite bias.
// Also saves the top-winner roster for the live system.
//
// Run: node consensus.mjs

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { buildWalletBets } from './src/polymarket.mjs';

const SLIP = 0.02, MIN_TRAIN = 20, TOPN = 200, K = 3; // consensus = ≥K winners on same outcome
const cachePath = new URL('./wallet-bets-cache.json', import.meta.url).pathname;
const rosterPath = new URL('./roster.json', import.meta.url).pathname;

let wb;
if (existsSync(cachePath)) { console.log('Loading cached real bets…'); wb = new Map(JSON.parse(readFileSync(cachePath))); }
else { wb = await buildWalletBets({ sinceISO: '2024-01-01', marketLimit: 2500 }); writeFileSync(cachePath, JSON.stringify([...wb])); }

// guard: need outcomeIndex (rebuild cache if old)
const sample = [...wb.values()][0]?.[0];
if (sample && sample.outcomeIndex === undefined) {
  console.log('Cache lacks outcomeIndex — rebuilding…');
  wb = await buildWalletBets({ sinceISO: '2024-01-01', marketLimit: 2500 });
  writeFileSync(cachePath, JSON.stringify([...wb]));
}

const all = [...wb.values()].flat().filter((b) => b.time && b.cost > 0 && b.cost < 1).sort((a, b) => a.time - b.time);
const split = all[Math.floor(all.length * 0.6)].time;
const profitOf = (b) => (b.won ? b.size * (1 - b.cost) : -b.size * b.cost);

// roster: top winners by realized TRAINING profit
const train = new Map();
for (const [w, bets] of wb) {
  const tb = bets.filter((b) => b.time < split && b.cost > 0 && b.cost < 1);
  if (tb.length < MIN_TRAIN) continue;
  train.set(w, tb.reduce((s, b) => s + profitOf(b), 0));
}
const roster = new Set([...train.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOPN).map(([w]) => w));
writeFileSync(rosterPath, JSON.stringify([...roster], null, 2));
console.log(`Roster: top ${roster.size} winners saved → roster.json\n`);

// group roster's TEST-period bets by (market, outcome)
const groups = new Map();
for (const w of roster) {
  for (const b of wb.get(w)) {
    if (b.time < split || !(b.cost > 0 && b.cost < 1)) continue;
    const key = `${b.marketId}:${b.outcomeIndex}`;
    const g = groups.get(key) || { wallets: new Set(), cost: 0, n: 0, won: b.won };
    g.wallets.add(w); g.cost += b.cost; g.n++; groups.set(key, g);
  }
}

function summarize(label, gs) {
  if (!gs.length) { console.log(`  ${label}: none`); return; }
  let staked = 0, profit = 0, wins = 0;
  for (const g of gs) { const p = g.cost / g.n, entry = Math.min(0.98, p + SLIP); staked += entry; profit += g.won ? 1 - entry : -entry; if (g.won) wins++; }
  console.log(`  ${label}: ${gs.length} outcomes · avg price ${(gs.reduce((s, g) => s + g.cost / g.n, 0) / gs.length * 100).toFixed(0)}¢ · win ${(wins / gs.length * 100).toFixed(0)}% · ROI ${(profit / staked * 100 >= 0 ? '+' : '') + (profit / staked * 100).toFixed(1)}%`);
}

const arr = [...groups.values()];
const consensus = arr.filter((g) => g.wallets.size >= K);
const single = arr.filter((g) => g.wallets.size === 1);
const consFav = consensus.filter((g) => { const p = g.cost / g.n; return p >= 0.65 && p <= 0.85; });
const consNonFav = consensus.filter((g) => { const p = g.cost / g.n; return p < 0.65; });

console.log(`── Winner-consensus test (K=${K} winners same outcome, out-of-sample) ──`);
summarize(`CONSENSUS (≥${K} winners)   `, consensus);
summarize('  └ consensus + favorite  ', consFav);
summarize('  └ consensus + NON-fav   ', consNonFav);
summarize('SINGLE winner (baseline)  ', single);
console.log('\nKey question: does "consensus + NON-favorite" win MORE than its ~price? If yes,');
console.log('winner-pile-ins carry genuine info (insider-like) beyond the favorite bias.');
