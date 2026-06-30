// montecarlo.mjs — detailed proof that the scoring algorithm RELIABLY beats naive,
// not just in one lucky run. Simulates N independent worlds (each: specialists +
// lucky wallets, validate on past, score-filter, paper-trade forward) and reports
// the distribution of outcomes + a MIN_SCORE sweep.
//
// Run: node montecarlo.mjs [--runs 60]

import { CONFIG } from './config.mjs';
import { validateWallets } from './src/skill.mjs';
import { scoreFromProfile } from './src/score.mjs';
import { PaperBook } from './src/paper.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const RUNS = arg('runs', 60);
const CATS = ['politics', 'crypto', 'world', 'econ'];

function mul(s) { return () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] || 0; };
const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const quant = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(q * (s.length - 1))]; };
const profileOf = (b) => ({ n: b.length, edgePerBet: b.reduce((s, x) => s + (x.won - x.cost), 0) / b.length, variance: b.reduce((s, x) => s + x.cost * (1 - x.cost), 0), medianSize: median(b.map((x) => x.size)) });

// one independent world → { naiveROI, scoredROI[minScore], naiveDD, scoredDD, validated }
function oneWorld(seed, minScores) {
  const rng = mul(seed);
  const U = (lo, hi) => lo + (hi - lo) * rng();
  const pick = (a) => a[Math.floor(rng() * a.length)];
  const makeWallet = (wallet, n, edge, specialty) => {
    const bets = [];
    for (let i = 0; i < n; i++) {
      const category = rng() < 0.6 ? (specialty || pick(CATS)) : pick(CATS);
      const isEdge = specialty && category === specialty;
      const cost = U(0.2, 0.8);
      const trueProb = Math.min(0.97, Math.max(0.03, cost + (isEdge ? edge : 0)));
      bets.push({ wallet, marketId: `${wallet}-m${i}`, category, time: rng(), cost, won: rng() < trueProb ? 1 : 0, size: isEdge ? U(2000, 9000) : U(100, 800) });
    }
    return bets;
  };

  const pop = new Map();
  for (let i = 0; i < 16; i++) pop.set(`s${i}`, makeWallet(`s${i}`, 1400, 0.06, pick(CATS)));
  for (let i = 0; i < 120; i++) pop.set(`l${i}`, makeWallet(`l${i}`, 1400, 0, null));

  const trainMap = new Map();
  for (const [w, b] of pop) trainMap.set(w, b.filter((x) => x.time < 0.6));
  const gate = validateWallets(trainMap, CONFIG);
  const validated = new Map(gate.validated.map((w) => [w.wallet, trainMap.get(w.wallet)]));

  const profiles = new Map();
  for (const [w, bets] of validated) {
    const cats = {};
    for (const c of CATS) { const cb = bets.filter((b) => b.category === c); if (cb.length) cats[c] = profileOf(cb); }
    profiles.set(w, { overall: profileOf(bets), cats });
  }

  const signals = [];
  for (const [w, b] of pop) { if (!validated.has(w)) continue; for (const x of b) if (x.time >= 0.6) signals.push(x); }
  signals.sort((a, b) => a.time - b.time);

  const scored = signals.map((s) => {
    const p = profiles.get(s.wallet);
    return { s, score: scoreFromProfile({ profile: p.overall, categoryProfile: p.cats[s.category] || null, signal: { size: s.size, marketLiquidity: U(5000, 80000), entryVsWhalePrice: CONFIG.MAX_ENTRY_SLIPPAGE, category: s.category } }).score };
  });

  const play = (filter) => {
    const book = new PaperBook(null, { stake: 100 });
    for (const { s, score } of scored) { if (!filter(score)) continue; const e = Math.min(0.99, s.cost + CONFIG.MAX_ENTRY_SLIPPAGE); book.open({ id: s.marketId, marketId: s.marketId, entry: e }); book.resolve(s.marketId, s.won); }
    return book.report();
  };

  const out = { validated: validated.size, naive: play(() => true) };
  out.byScore = Object.fromEntries(minScores.map((m) => [m, play((sc) => sc >= m)]));
  return out;
}

// ---- run the Monte Carlo ----
const SWEEP = [0, 50, 60, 70, 80];
console.log(`Running ${RUNS} independent worlds…\n`);
const naiveROIs = [], scoredROIs = [], beats = [], naiveDDs = [], scoredDDs = [], validatedCounts = [];
const sweepROIs = Object.fromEntries(SWEEP.map((m) => [m, []]));

for (let i = 0; i < RUNS; i++) {
  const w = oneWorld(1000 + i * 7, SWEEP);
  if (!w.naive.nClosed) continue;
  naiveROIs.push(w.naive.roi);
  validatedCounts.push(w.validated);
  const scored60 = w.byScore[60];
  if (scored60.nClosed) {
    scoredROIs.push(scored60.roi);
    beats.push(scored60.roi > w.naive.roi ? 1 : 0);
    naiveDDs.push(w.naive.maxDrawdown);
    scoredDDs.push(scored60.maxDrawdown);
  }
  for (const m of SWEEP) if (w.byScore[m].nClosed) sweepROIs[m].push(w.byScore[m].roi);
}

const pct = (a) => (mean(a) * 100).toFixed(1);
console.log('──────── MONTE CARLO RESULT ────────');
console.log(`Worlds: ${naiveROIs.length}   avg validated wallets/world: ${mean(validatedCounts).toFixed(1)}`);
console.log(`\nNAIVE  ROI:  mean ${pct(naiveROIs)}%   median ${(quant(naiveROIs,0.5)*100).toFixed(1)}%   [p10 ${(quant(naiveROIs,0.1)*100).toFixed(1)}%, p90 ${(quant(naiveROIs,0.9)*100).toFixed(1)}%]`);
console.log(`SCORED ROI:  mean ${pct(scoredROIs)}%   median ${(quant(scoredROIs,0.5)*100).toFixed(1)}%   [p10 ${(quant(scoredROIs,0.1)*100).toFixed(1)}%, p90 ${(quant(scoredROIs,0.9)*100).toFixed(1)}%]`);
console.log(`\nScored beat naive in ${(mean(beats)*100).toFixed(0)}% of worlds   (sign test — >50% = scoring helps)`);
console.log(`Avg max drawdown:  naive $${mean(naiveDDs).toFixed(0)}   vs   scored $${mean(scoredDDs).toFixed(0)}  (smaller magnitude = better)`);
console.log(`\nMIN_SCORE sweep (mean ROI):`);
for (const m of SWEEP) console.log(`  ≥${String(m).padStart(2)}:  ${(mean(sweepROIs[m])*100>=0?'+':'')}${(mean(sweepROIs[m])*100).toFixed(1)}%   (n worlds ${sweepROIs[m].length})`);
console.log('\nIf scored beats naive in a large majority of worlds and ROI rises with the');
console.log('threshold, the scoring layer is a robust improvement — not one lucky run.');
