// simulate.mjs — prove the machinery distinguishes SKILL from LUCK before it ever
// risks money. Generates skilled wallets (true edge) + many lucky ones (zero edge),
// then checks: do the gates validate the skilled and reject the lucky? Does
// persistence hold for real skill and fail for luck?
//
// Run: node simulate.mjs

import { CONFIG } from './config.mjs';
import { validateWallets } from './src/skill.mjs';
import { persistenceTest } from './src/persistence.mjs';
import { followBacktest } from './src/backtest.mjs';

// seeded RNG so results are reproducible
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(42);
const U = (lo, hi) => lo + (hi - lo) * rng();

// Make a wallet's resolved bets. edge=0 → pure luck (wins exactly as priced).
function makeWallet(wallet, nBets, edge) {
  const bets = [];
  for (let i = 0; i < nBets; i++) {
    const cost = U(0.2, 0.8);                       // its entry price = its prediction
    const trueProb = Math.min(0.97, Math.max(0.03, cost + edge));
    const won = rng() < trueProb ? 1 : 0;
    bets.push({ wallet, marketId: `m${i}`, time: rng(), cost, won, size: U(50, 500) });
  }
  return bets;
}

function buildPopulation({ nSkilled, nLucky, edge, nBets }) {
  const map = new Map();
  for (let i = 0; i < nSkilled; i++) map.set(`skill_${i}`, makeWallet(`skill_${i}`, nBets, edge));
  for (let i = 0; i < nLucky; i++) map.set(`luck_${i}`, makeWallet(`luck_${i}`, nBets, 0));
  return map;
}

function report(title, pop) {
  console.log(`\n════ ${title} ════`);
  const gate = validateWallets(pop, CONFIG);
  const v = gate.validated;
  const skilledValidated = v.filter((w) => w.wallet.startsWith('skill_')).length;
  const luckyValidated = v.filter((w) => w.wallet.startsWith('luck_')).length;
  console.log(`Screened: ${gate.nScreened} wallets | Bonferroni α = ${gate.correctedAlpha.toExponential(1)}`);
  console.log(`Validated: ${v.length}  →  ${skilledValidated} skilled, ${luckyValidated} lucky (false positives)`);

  const persist = persistenceTest(pop, 0.5, CONFIG);
  if (persist.ok) {
    console.log(`Persistence: top-quartile edge  A=${(persist.topA_edge*100).toFixed(1)}¢  →  B=${(persist.topB_edge*100).toFixed(1)}¢` +
      `  (rest in B=${(persist.restB_edge*100).toFixed(1)}¢, rankCorr=${persist.rankCorr?.toFixed(2)})  →  ${persist.persists ? 'PERSISTS ✅' : 'does NOT persist ❌'}`);
  } else { console.log(`Persistence: ${persist.reason}`); }

  const bt = followBacktest([...pop.values()].flat(), CONFIG);
  if (bt.follows) {
    console.log(`Follow backtest (out-of-sample): ${bt.follows} follows, win ${(bt.winRate*100).toFixed(0)}%, avg ${(bt.avgPnlPerFollow*100>=0?'+':'')}${(bt.avgPnlPerFollow*100).toFixed(1)}¢/follow`);
  } else { console.log('Follow backtest: no wallet ever cleared the bar (good — no luck chased).'); }
}

// Scenario A: real skill exists, hidden among lots of luck.
report('A: 15 skilled (5¢ edge) + 200 lucky', buildPopulation({ nSkilled: 15, nLucky: 200, edge: 0.05, nBets: 80 }));

// Scenario B: NOBODY is skilled — pure luck. The system must NOT hallucinate edge.
report('B: 0 skilled + 215 lucky (null world)', buildPopulation({ nSkilled: 0, nLucky: 215, edge: 0, nBets: 80 }));

// Scenario C: same 6¢ edge, but 1200 resolved bets/wallet. Shows the gate DOES
// fire when there's enough data — and reveals how much data that takes.
report('C: 15 skilled (6¢ edge, 1200 bets) + 100 lucky', buildPopulation({ nSkilled: 15, nLucky: 100, edge: 0.06, nBets: 1200 }));

console.log('\nIf A validates skilled wallets + persists + profits, and B validates ~nobody');
console.log('+ does NOT persist, the gates work: they find real edge and refuse to invent it.');
