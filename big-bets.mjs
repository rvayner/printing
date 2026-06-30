// big-bets.mjs — test the EXACT claim: do BIG, confident bets carry insider info?
// Bucket every real bet by DOLLAR size × price band, and check if large bets win
// MORE than their price implies — especially on NON-favorites (where genuine
// private info would show up, vs the favorite bias that's already known).
//
// Run: node big-bets.mjs

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { buildWalletBets } from './src/polymarket.mjs';

const cachePath = new URL('./wallet-bets-cache.json', import.meta.url).pathname;
let wb;
if (existsSync(cachePath)) { console.log('Loading cached real bets…'); wb = new Map(JSON.parse(readFileSync(cachePath))); }
else { wb = await buildWalletBets({ sinceISO: '2024-01-01', marketLimit: 2500 }); writeFileSync(cachePath, JSON.stringify([...wb])); }

const bets = [...wb.values()].flat().filter((b) => b.cost > 0 && b.cost < 1 && b.size > 0);
console.log(`${bets.length.toLocaleString()} real bets.\n`);

const sizeBuckets = [
  ['<$100', 0, 100], ['$100-1k', 100, 1000], ['$1k-10k', 1000, 10000], ['>$10k (whales)', 10000, Infinity],
];
const priceBands = [
  ['longshot <40¢', 0, 0.40], ['mid 40-65¢', 0.40, 0.65], ['favorite 65-90¢', 0.65, 0.90],
];

console.log('Does bet SIZE predict winning beyond price? (edge = actual win − price paid)\n');
for (const [pl, plo, phi] of priceBands) {
  console.log(`── ${pl} ──`);
  for (const [sl, slo, shi] of sizeBuckets) {
    const rows = bets.filter((b) => { const $ = b.size * b.cost; return $ >= slo && $ < shi && b.cost >= plo && b.cost < phi; });
    if (rows.length < 30) { console.log(`  ${sl.padEnd(16)}: too few (${rows.length})`); continue; }
    const avgP = rows.reduce((s, b) => s + b.cost, 0) / rows.length;
    const wr = rows.reduce((s, b) => s + b.won, 0) / rows.length;
    const edge = wr - avgP;
    console.log(`  ${sl.padEnd(16)}: n=${String(rows.length).padStart(6)}  price ${(avgP * 100).toFixed(0)}¢  win ${(wr * 100).toFixed(0)}%  edge ${(edge * 100 >= 0 ? '+' : '') + (edge * 100).toFixed(1)}¢${edge > 0.02 ? ' ✅' : edge < -0.02 ? ' 🔻' : ''}`);
  }
  console.log('');
}
console.log('KEY: if "whales" on longshot/mid show +edge, big confident bets ARE informed.');
console.log('If whale bets on non-favorites have ~0 or −edge, "big bet = insider" is false.');
