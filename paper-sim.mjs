// paper-sim.mjs — fast, no-network forward test of the WHOLE system. Generates a
// population, validates wallets on a PAST period only, then paper-trades the
// validated wallets' FUTURE bets and shows the resulting P&L, win rate, ROI, and
// equity curve. This is the honest "what would live paper-trading have done?".
//
// Run:  node paper-sim.mjs
//       node paper-sim.mjs --skilled 12 --lucky 150 --edge 0.06 --bets 1500 --signals 300
//       node paper-sim.mjs --edge 0      # null world: no edge → ~nothing to trade

import { CONFIG } from './config.mjs';
import { validateWallets } from './src/skill.mjs';
import { PaperBook, sparkline } from './src/paper.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const N_SKILLED = arg('skilled', 12);
const N_LUCKY = arg('lucky', 150);
const EDGE = arg('edge', 0.06);
const N_BETS = arg('bets', 1500);
const MAX_SIGNALS = arg('signals', 300);
const STAKE = arg('stake', 100);
const TRAIN_FRAC = 0.6;            // first 60% of history = validation; rest = forward

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(7);
const U = (lo, hi) => lo + (hi - lo) * rng();

function makeWallet(wallet, nBets, edge) {
  const bets = [];
  for (let i = 0; i < nBets; i++) {
    const cost = U(0.2, 0.8);
    const trueProb = Math.min(0.97, Math.max(0.03, cost + edge));
    bets.push({ wallet, marketId: `${wallet}-m${i}`, time: rng(),
      cost, won: rng() < trueProb ? 1 : 0, size: U(50, 500) });
  }
  return bets;
}

// build population
const pop = new Map();
for (let i = 0; i < N_SKILLED; i++) pop.set(`skill_${i}`, makeWallet(`skill_${i}`, N_BETS, EDGE));
for (let i = 0; i < N_LUCKY; i++) pop.set(`luck_${i}`, makeWallet(`luck_${i}`, N_BETS, 0));

// 1) validate on PAST data only
const trainMap = new Map();
for (const [w, bets] of pop) trainMap.set(w, bets.filter((b) => b.time < TRAIN_FRAC));
const gate = validateWallets(trainMap, CONFIG);
const validated = new Set(gate.validated.map((w) => w.wallet));
console.log(`Validated ${validated.size} wallet(s) on past data (${gate.nScreened} screened, Bonferroni α=${gate.correctedAlpha.toExponential(1)})`);
const skilledHit = gate.validated.filter((w) => w.wallet.startsWith('skill_')).length;
console.log(`   → ${skilledHit} truly-skilled, ${gate.validated.length - skilledHit} false positives`);

// 2) collect FORWARD signals from validated wallets, in time order
const signals = [];
for (const [w, bets] of pop) {
  if (!validated.has(w)) continue;
  for (const b of bets) if (b.time >= TRAIN_FRAC) signals.push(b);
}
signals.sort((a, b) => a.time - b.time);
const traded = signals.slice(0, MAX_SIGNALS);
console.log(`Forward signals from validated wallets: ${signals.length} (paper-trading first ${traded.length})\n`);

// 3) paper-trade them at a realistic (worse) entry, resolve, tally
const book = new PaperBook(null, { stake: STAKE });
for (const s of traded) {
  const entry = Math.min(0.99, s.cost + CONFIG.MAX_ENTRY_SLIPPAGE);
  book.open({ id: s.marketId, wallet: s.wallet, marketId: s.marketId, question: 'sim', side: 'YES',
    entry, resolveTime: s.time });
  book.resolve(s.marketId, s.won);
}

const r = book.report();
console.log('──────── PAPER-TRADING RESULT ────────');
if (!r.nClosed) { console.log('No trades — no validated edge to follow (this is the system protecting you).'); process.exit(0); }
console.log(`Trades:        ${r.nClosed}`);
console.log(`Win rate:      ${(r.winRate * 100).toFixed(1)}%`);
console.log(`Staked:        $${r.staked.toFixed(0)}  ($${STAKE}/trade)`);
console.log(`P&L:           ${r.pnl >= 0 ? '+' : ''}$${r.pnl.toFixed(0)}`);
console.log(`ROI:           ${r.roi * 100 >= 0 ? '+' : ''}${(r.roi * 100).toFixed(1)}%`);
console.log(`Max drawdown:  $${r.maxDrawdown.toFixed(0)}`);
console.log(`Equity curve:  ${sparkline(r.curve)}`);
console.log(`\n(${CONFIG.MAX_ENTRY_SLIPPAGE * 100}¢ follower slippage applied per trade. Edge=${EDGE*100}¢.`);
console.log(' Try --edge 0 to confirm the system trades ~nothing when there is no real edge.)');
