// stress-test.mjs — the honest tail risk. The clean Monte Carlo drew favorites
// INDEPENDENTLY, but real favorites correlate (same event/day fail together). This
// draws temporally-CLUSTERED batches (worst case: your positions are correlated) and
// compares the drawdown distribution to independent draws. Also finds the worst
// realized stretch in the actual data.
//
// Run: node stress-test.mjs [--bankroll 2000]

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { buildWalletBets } from './src/polymarket.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const BANK = arg('bankroll', 2000), N = 10, CYCLES = 6, DEPLOY = 0.5, SLIP = 0.03, PATHS = 20000;
const cachePath = new URL('./wallet-bets-cache.json', import.meta.url).pathname;
let wb;
if (existsSync(cachePath)) { console.log('Loading cached real bets…'); wb = new Map(JSON.parse(readFileSync(cachePath))); }
else { wb = await buildWalletBets({ sinceISO: '2024-01-01', marketLimit: 2500 }); writeFileSync(cachePath, JSON.stringify([...wb])); }

const pool = [...wb.values()].flat().filter((b) => b.cost >= 0.65 && b.cost <= 0.85 && b.time)
  .map((b) => ({ entry: Math.min(0.95, b.cost + SLIP), won: b.won, time: b.time })).sort((a, b) => a.time - b.time);
const pct = (a, q) => a[Math.floor(q * (a.length - 1))];

// one path: CYCLES batches of N favorites. clustered=true → N consecutive (correlated);
// false → N independent random.
function path(clustered) {
  let bank = BANK, peak = BANK, maxDD = 0;
  for (let c = 0; c < CYCLES; c++) {
    const perPos = bank * DEPLOY / N;
    let start = clustered ? (Math.random() * (pool.length - N)) | 0 : 0;
    let batch = 0;
    for (let i = 0; i < N; i++) { const b = clustered ? pool[start + i] : pool[(Math.random() * pool.length) | 0]; batch += b.won ? perPos * (1 - b.entry) / b.entry : -perPos; }
    bank += batch; peak = Math.max(peak, bank); maxDD = Math.min(maxDD, (bank - peak) / peak);
  }
  return { ret: bank / BANK - 1, dd: maxDD };
}

function run(clustered) {
  const rets = [], dds = []; for (let p = 0; p < PATHS; p++) { const r = path(clustered); rets.push(r.ret); dds.push(r.dd); }
  rets.sort((a, b) => a - b); dds.sort((a, b) => a - b);
  return { medRet: pct(rets, 0.5), p5ret: pct(rets, 0.05), worstDD: dds[0], p5dd: pct(dds, 0.05), p1dd: pct(dds, 0.01) };
}

console.log(`\n$${BANK} bankroll · ${N} positions/cycle · ${CYCLES} cycles · ${DEPLOY * 100}% deployed\n`);
const ind = run(false), clu = run(true);
console.log('scenario            | median ret | bad-case ret(5%) | worst drawdown | 1%-worst DD');
console.log('--------------------|------------|------------------|----------------|------------');
const row = (l, r) => console.log(`${l.padEnd(20)}| ${(r.medRet * 100 >= 0 ? '+' : '') + (r.medRet * 100).toFixed(0)}%`.padEnd(13) + `| ${(r.p5ret * 100 >= 0 ? '+' : '') + (r.p5ret * 100).toFixed(0)}%`.padEnd(19) + `| ${(r.worstDD * 100).toFixed(0)}%`.padEnd(17) + `| ${(r.p1dd * 100).toFixed(0)}%`);
row('independent draws', ind);
row('CORRELATED batches', clu);

// worst realized stretch of 50 consecutive favorites in the actual data
let worst = 0; for (let i = 0; i + 50 <= pool.length; i += 10) { const s = pool.slice(i, i + 50); const r = s.reduce((a, b) => a + (b.won ? (1 - b.entry) / b.entry : -1), 0) / 50; worst = Math.min(worst, r); }
console.log(`\nWorst realized 50-favorite stretch in the data: ${(worst * 100).toFixed(1)}% ROI (this actually happened).`);
console.log('If CORRELATED drawdown is much worse than independent, correlation is the real risk →');
console.log('the ≤1-per-event / ≤30%-per-category diversification guard is what protects you.');
