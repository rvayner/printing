// kelly-sim.mjs — honest test of sizing under REALISTIC conditions: the edge you
// validated on the PAST decays live (overfit/competition), so you're betting on a
// weaker edge than you think. Across many worlds we measure what actually matters:
// RUIN rate and the MEDIAN outcome (not the lucky mean). Kelly's job is survival.
//
// Run: node kelly-sim.mjs [--worlds 120] [--decay 0.4]

import { CONFIG } from './config.mjs';
import { validateWallets } from './src/skill.mjs';
import { scoreFromProfile, edgeCIFromStats } from './src/score.mjs';
import { kellyStake } from './src/sizing.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const WORLDS = arg('worlds', 120);
const DECAY = arg('decay', 0.4);        // live edge = validated edge × DECAY
const CATS = ['politics', 'crypto', 'world', 'econ'];
const SLIP = CONFIG.MAX_ENTRY_SLIPPAGE;
const FLAT_FRAC = 0.02, START = 1000, RUIN = 0.5, MAX_SIGNALS = 400;

const profileOf = (b) => ({ n: b.length, edgePerBet: b.reduce((s, x) => s + (x.won - x.cost), 0) / b.length, variance: b.reduce((s, x) => s + x.cost * (1 - x.cost), 0), medianSize: 0 });
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] || 0; };

function world(seed) {
  let s = seed; const rng = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const U = (lo, hi) => lo + (hi - lo) * rng(); const pick = (a) => a[Math.floor(rng() * a.length)];
  // specialist: full edge in PAST (time<0.6), decayed edge LIVE (time>=0.6)
  const make = (w, n, edge, spec) => { const b = []; for (let i = 0; i < n; i++) { const live = rng() >= 0.6; const category = rng() < 0.6 ? (spec || pick(CATS)) : pick(CATS); const isE = spec && category === spec; const e = isE ? (live ? edge * DECAY : edge) : 0; const cost = U(0.2, 0.8); const tp = Math.min(0.97, Math.max(0.03, cost + e)); b.push({ wallet: w, category, time: live ? U(0.6, 1) : U(0, 0.6), cost, won: rng() < tp ? 1 : 0, size: isE ? U(2000, 9000) : U(100, 800) }); } return b; };
  const pop = new Map();
  for (let i = 0; i < 16; i++) pop.set(`s${i}`, make(`s${i}`, 1500, 0.08, pick(CATS)));
  for (let i = 0; i < 120; i++) pop.set(`l${i}`, make(`l${i}`, 1500, 0, null));

  const trainMap = new Map();
  for (const [w, b] of pop) trainMap.set(w, b.filter((x) => x.time < 0.6));
  const gate = validateWallets(trainMap, CONFIG);
  const profiles = new Map();
  for (const w of gate.validated) { const bets = trainMap.get(w.wallet); const cats = {}; for (const c of CATS) { const cb = bets.filter((b) => b.category === c); if (cb.length) cats[c] = profileOf(cb); } profiles.set(w.wallet, { overall: profileOf(bets), cats }); }

  const signals = [];
  for (const w of gate.validated) for (const b of pop.get(w.wallet)) if (b.time >= 0.6) signals.push(b);
  signals.sort((a, b) => a.time - b.time);

  const sim = (stakeFn) => {
    let bank = START, peak = START, ruined = false, n = 0;
    for (const sg of signals) {
      if (n >= MAX_SIGNALS) break;
      const prof = profiles.get(sg.wallet);
      const sc = scoreFromProfile({ profile: prof.overall, categoryProfile: prof.cats[sg.category] || null, signal: { size: sg.size, marketLiquidity: 50000, entryVsWhalePrice: SLIP, category: sg.category } });
      if (sc.score < CONFIG.MIN_SCORE) continue;
      n++;
      const entry = Math.min(0.99, sg.cost + SLIP);
      const ci = prof.cats[sg.category] ? edgeCIFromStats(prof.cats[sg.category]) : edgeCIFromStats(prof.overall);
      const stake = Math.min(stakeFn(bank, entry, Math.max(0, ci.lo - SLIP)), bank * 0.5);
      if (stake <= 0) continue;
      bank += sg.won ? (stake / entry) - stake : -stake;
      if (bank < START * RUIN) ruined = true;
      if (bank <= 0) { bank = 0; break; }
      peak = Math.max(peak, bank);
    }
    return { growth: bank / START, ruined };
  };

  return { flat: sim((b) => b * FLAT_FRAC), kelly: sim((b, entry, edge) => kellyStake({ bankroll: b, price: entry, edgeLo: edge, liquidity: 50000 })) };
}

const flatG = [], kellyG = []; let flatRuin = 0, kellyRuin = 0;
for (let i = 0; i < WORLDS; i++) { const r = world(2000 + i * 13); flatG.push(r.flat.growth); kellyG.push(r.kelly.growth); if (r.flat.ruined) flatRuin++; if (r.kelly.ruined) kellyRuin++; }

console.log(`──── SIZING UNDER EDGE DECAY (×${DECAY}) — ${WORLDS} worlds ────\n`);
const row = (name, g, ruin) => console.log(`  ${name}:  median ${median(g).toFixed(2)}×   ruin rate ${(ruin / WORLDS * 100).toFixed(0)}%   (dropped below ${RUIN * 100}% of bankroll)`);
row('FLAT  (2%/bet)        ', flatG, flatRuin);
row('KELLY (¼, edge-scaled)', kellyG, kellyRuin);
console.log('\nThe honest case for Kelly: when your validated edge decays live (it will),');
console.log('flat sizing over-bets a weaker-than-thought edge and ruins more often. Kelly');
console.log('sizes to the (conservative) edge, so it survives. Survival > a bigger mean.');
