// mc-sizing.mjs — Monte Carlo of YOUR bankroll to answer: what unit size per
// position? Simulates $BANKROLL over ~1 year (diversified cycles) across many random
// paths drawn from the REAL favorites outcomes, at several unit sizes. Reports the
// full distribution: median, downside (5th pct), upside (95th pct), P(profit),
// P(down >20%). Finds the sweet spot — return worth it without ruinous drawdown.
//
// Run: node mc-sizing.mjs [--bankroll 2000 --cycles 6 --paths 20000]

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { buildWalletBets } from './src/polymarket.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const BANK = arg('bankroll', 2000), CYCLES = arg('cycles', 6), PATHS = arg('paths', 20000), DEPLOY = 0.5, SLIP = 0.03;
const cachePath = new URL('./wallet-bets-cache.json', import.meta.url).pathname;

let wb;
if (existsSync(cachePath)) { console.log('Loading cached real bets…'); wb = new Map(JSON.parse(readFileSync(cachePath))); }
else { wb = await buildWalletBets({ sinceISO: '2024-01-01', marketLimit: 2500 }); writeFileSync(cachePath, JSON.stringify([...wb])); }

// real favorites draw pool: entry price + actual outcome
const pool = [...wb.values()].flat().filter((b) => b.cost >= 0.65 && b.cost <= 0.85)
  .map((b) => ({ entry: Math.min(0.95, b.cost + SLIP), won: b.won }));
console.log(`Draw pool: ${pool.length.toLocaleString()} real favorites · $${BANK} bankroll · ${CYCLES} cycles/yr · ${DEPLOY * 100}% deployed\n`);

const pick = () => pool[(Math.random() * pool.length) | 0];
const pct = (arr, q) => arr[Math.floor(q * (arr.length - 1))];

// one path: N positions/cycle, each perPos = DEPLOY/N of current bankroll, compound
function simPath(N) {
  let bank = BANK, peak = BANK, maxDD = 0;
  for (let c = 0; c < CYCLES; c++) {
    const deploy = bank * DEPLOY, perPos = deploy / N;
    let batch = 0;
    for (let i = 0; i < N; i++) { const b = pick(); batch += b.won ? perPos * (1 - b.entry) / b.entry : -perPos; }
    bank += batch; peak = Math.max(peak, bank); maxDD = Math.min(maxDD, (bank - peak) / peak);
  }
  return { ret: bank / BANK - 1, maxDD };
}

console.log('per-pos unit | median | downside(5%) | upside(95%) | P(profit) | P(down>20%)');
console.log('-------------|--------|--------------|-------------|-----------|------------');
for (const N of [4, 8, 12, 20, 40]) {
  const unit = DEPLOY / N;
  const rets = [], dds = []; let prof = 0, bad = 0;
  for (let p = 0; p < PATHS; p++) { const r = simPath(N); rets.push(r.ret); dds.push(r.maxDD); if (r.ret > 0) prof++; if (r.maxDD < -0.20) bad++; }
  rets.sort((a, b) => a - b);
  const dollars = (BANK * unit).toFixed(0);
  console.log(`${N} pos ($${dollars})`.padEnd(13) + `| ${(pct(rets, 0.5) * 100 >= 0 ? '+' : '') + (pct(rets, 0.5) * 100).toFixed(0)}%`.padEnd(7) +
    `| ${(pct(rets, 0.05) * 100 >= 0 ? '+' : '') + (pct(rets, 0.05) * 100).toFixed(0)}%`.padEnd(13) +
    `| +${(pct(rets, 0.95) * 100).toFixed(0)}%`.padEnd(12) + `| ${(prof / PATHS * 100).toFixed(0)}%`.padEnd(10) + `| ${(bad / PATHS * 100).toFixed(0)}%`);
}
console.log(`\nEach row: split ${DEPLOY * 100}% of a $${BANK} bankroll across N favorites (unit = $ per position).`);
console.log('More positions = smaller units = tighter outcomes (less downside, less upside).');
console.log('Sweet spot = highest median with downside you can stomach + low P(big drawdown).');
