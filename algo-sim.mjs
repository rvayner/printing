// algo-sim.mjs — prove the FULL algorithm (validate → score-filter → follow) beats
// naive "follow every validated wallet". Realistic world: skilled wallets are
// CATEGORY SPECIALISTS (edge only in their domain) and bet BIGGER with conviction.
// The scorer should concentrate capital on specialty + high-conviction bets and
// drop the zero-edge off-specialty noise — producing higher, steadier returns.
//
// Run: node algo-sim.mjs   [--signals 4000] [--minscore 60]

import { CONFIG } from './config.mjs';
import { validateWallets } from './src/skill.mjs';
import { scoreFromProfile } from './src/score.mjs';
import { PaperBook, sparkline } from './src/paper.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const MAX_SIGNALS = arg('signals', 4000);
const MIN_SCORE = arg('minscore', CONFIG.MIN_SCORE);
const CATS = ['politics', 'crypto', 'world', 'econ'];

function mul(s) { return () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rng = mul(11);
const U = (lo, hi) => lo + (hi - lo) * rng();
const pick = (a) => a[Math.floor(rng() * a.length)];

// A specialist wins (edge) only in `specialty`, and bets BIG there; elsewhere zero edge, small.
function makeWallet(wallet, nBets, edge, specialty) {
  const bets = [];
  for (let i = 0; i < nBets; i++) {
    const category = rng() < 0.6 ? (specialty || pick(CATS)) : pick(CATS);
    const isEdge = specialty && category === specialty;
    const cost = U(0.2, 0.8);
    const trueProb = Math.min(0.97, Math.max(0.03, cost + (isEdge ? edge : 0)));
    const size = isEdge ? U(2000, 9000) : U(100, 800);   // conviction shows in size
    bets.push({ wallet, marketId: `${wallet}-m${i}`, category, time: rng(),
      cost, won: rng() < trueProb ? 1 : 0, size });
  }
  return bets;
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] || 0; };
function profileOf(bets) {
  const n = bets.length;
  const edgePerBet = bets.reduce((s, b) => s + (b.won - b.cost), 0) / n;
  const variance = bets.reduce((s, b) => s + b.cost * (1 - b.cost), 0);
  return { n, edgePerBet, variance, medianSize: median(bets.map((b) => b.size)) };
}

// build population: 16 specialists (6¢) + 120 lucky
const pop = new Map();
for (let i = 0; i < 16; i++) pop.set(`skill_${i}`, makeWallet(`skill_${i}`, 1400, 0.06, pick(CATS)));
for (let i = 0; i < 120; i++) pop.set(`luck_${i}`, makeWallet(`luck_${i}`, 1400, 0, null));

// 1) validate on PAST (time < 0.6)
const trainMap = new Map();
for (const [w, b] of pop) trainMap.set(w, b.filter((x) => x.time < 0.6));
const gate = validateWallets(trainMap, CONFIG);
const validated = new Map(gate.validated.map((w) => [w.wallet, trainMap.get(w.wallet)]));
console.log(`Validated ${validated.size} wallet(s) on past data (Bonferroni α=${gate.correctedAlpha.toExponential(1)})`);

// 2) build scoring profiles (overall + per-category + median size) from PAST bets
const profiles = new Map();
for (const [w, bets] of validated) {
  const cats = {};
  for (const c of CATS) { const cb = bets.filter((b) => b.category === c); if (cb.length) cats[c] = profileOf(cb); }
  profiles.set(w, { overall: profileOf(bets), cats });
}

// 3) forward signals (time ≥ 0.6) from validated wallets, scored
const signals = [];
for (const [w, bets] of pop) {
  if (!validated.has(w)) continue;
  for (const b of bets) if (b.time >= 0.6) signals.push(b);
}
signals.sort((a, b) => a.time - b.time);
const slice = signals.slice(0, MAX_SIGNALS);

function runStrategy(label, filterFn) {
  const book = new PaperBook(null, { stake: 100 });
  let scoreSum = 0, scored = 0;
  for (const s of slice) {
    const prof = profiles.get(s.wallet);
    const sc = scoreFromProfile({ profile: prof.overall, categoryProfile: prof.cats[s.category] || null,
      signal: { size: s.size, marketLiquidity: U(5000, 80000), entryVsWhalePrice: CONFIG.MAX_ENTRY_SLIPPAGE, category: s.category } });
    scoreSum += sc.score; scored++;
    if (!filterFn(sc)) continue;
    const entry = Math.min(0.99, s.cost + CONFIG.MAX_ENTRY_SLIPPAGE);
    book.open({ id: s.marketId, wallet: s.wallet, marketId: s.marketId, side: 'YES', entry, resolveTime: s.time });
    book.resolve(s.marketId, s.won);
  }
  const r = book.report();
  console.log(`\n${label}`);
  console.log(`  trades ${r.nClosed}  win ${(r.winRate*100).toFixed(1)}%  ROI ${r.roi*100>=0?'+':''}${(r.roi*100).toFixed(1)}%  P&L ${r.pnl>=0?'+':''}$${r.pnl.toFixed(0)}  maxDD $${r.maxDrawdown.toFixed(0)}`);
  console.log(`  equity ${sparkline(r.curve)}`);
  return r;
}

console.log(`\nForward signals: ${slice.length} (avg score shown per strategy)\n──────── ALGORITHM vs NAIVE ────────`);
runStrategy(`NAIVE  (follow every validated signal)`, () => true);
runStrategy(`SCORED (only score ≥ ${MIN_SCORE})`, (sc) => sc.score >= MIN_SCORE);
console.log(`\nIf SCORED shows higher ROI + smaller drawdown than NAIVE, the scoring layer`);
console.log('is concentrating capital on real-edge, high-conviction, in-domain bets.');
