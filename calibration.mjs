// calibration.mjs — test the FAVORITE-LONGSHOT bias on real Polymarket data.
// Bucket every real BUY by price, then compare ACTUAL win rate to the price paid.
// If high-price (favorite) buckets win MORE than priced → buying favorites has a
// real, structural edge (unlike whale-following, which we proved loses).
//
// Run: node calibration.mjs [--markets 2500]

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { buildWalletBets } from './src/polymarket.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const cachePath = new URL('./wallet-bets-cache.json', import.meta.url).pathname;

let wb;
if (existsSync(cachePath)) {
  console.log('Loading cached real bets…');
  wb = new Map(JSON.parse(readFileSync(cachePath)));
} else {
  wb = await buildWalletBets({ sinceISO: '2024-01-01', marketLimit: arg('markets', 2500) });
  writeFileSync(cachePath, JSON.stringify([...wb]));
}
const bets = [...wb.values()].flat();
console.log(`\nCalibration on ${bets.length.toLocaleString()} real BUY trades:\n`);

// 5¢ buckets
const B = Array.from({ length: 20 }, (_, i) => ({ lo: i * 5, hi: i * 5 + 5, n: 0, wins: 0, sumP: 0 }));
for (const b of bets) {
  const c = b.cost;
  if (!(c > 0 && c < 1)) continue;
  const bk = B[Math.min(19, Math.floor(c * 20))];
  bk.n++; bk.wins += b.won; bk.sumP += c;
}

console.log('price band | trades | avg price | actual win | edge | return-if-bought');
console.log('-----------|--------|-----------|------------|------|-----------------');
let favEdge = 0, favN = 0, longLoss = 0, longN = 0;
for (const bk of B) {
  if (bk.n < 50) continue;
  const avgP = bk.sumP / bk.n, wr = bk.wins / bk.n, edge = wr - avgP, ret = wr / avgP - 1;
  const flag = edge > 0.01 ? ' ✅' : edge < -0.01 ? ' 🔻' : '';
  console.log(`${String(bk.lo).padStart(2)}-${String(bk.hi).padStart(2)}¢   | ${String(bk.n).padStart(6)} | ${(avgP * 100).toFixed(1).padStart(7)}¢ | ${(wr * 100).toFixed(1).padStart(8)}% | ${(edge * 100 >= 0 ? '+' : '') + (edge * 100).toFixed(1)}¢ | ${(ret * 100 >= 0 ? '+' : '') + (ret * 100).toFixed(0)}%${flag}`);
  if (bk.lo >= 75) { favEdge += (wr - avgP) * bk.n; favN += bk.n; }
  if (bk.hi <= 25) { longLoss += (wr - avgP) * bk.n; longN += bk.n; }
}
console.log(`\nFAVORITES (≥75¢): avg edge ${favN ? (favEdge / favN * 100).toFixed(2) : '—'}¢/contract over ${favN.toLocaleString()} trades`);
console.log(`LONGSHOTS (≤25¢): avg edge ${longN ? (longLoss / longN * 100).toFixed(2) : '—'}¢/contract over ${longN.toLocaleString()} trades`);
console.log('\nIf favorites show +edge and longshots show −edge, the bias is real and tradeable');
console.log('(buy favorites / fade longshots). Net of ~1-2¢ slippage to know if it survives.');
