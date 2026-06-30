// walkforward.mjs — the REAL confirmation. Out-of-sample walk-forward on actual
// Polymarket history: repeatedly validate wallets on the PAST, then follow their
// bets in a FUTURE window they couldn't influence, scored + cost-adjusted. Gives a
// strict PASS/FAIL — designed to be hard to pass and to expose fake edges.
//
//   node --env-file=.env walkforward.mjs --since 2026-01-01 --markets 400
//   node walkforward.mjs --selftest             # synthetic edge → should PASS
//   node walkforward.mjs --selftest --edge 0    # no edge → must FAIL
//
// A PASS = there WAS a real, out-of-sample, cost-aware edge historically. That is
// necessary evidence — still NOT a guarantee of future profit (edges decay, and
// once you trade you add competition). A FAIL = do not deploy real money. Period.

import { CONFIG } from './config.mjs';
import { validateWallets } from './src/skill.mjs';
import { scoreFromProfile } from './src/score.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(`--${k}`);
const FOLDS = Number(arg('folds', 5));
const MINSCORE = Number(arg('minscore', CONFIG.MIN_SCORE));
const SLIP = Number(arg('slippage', CONFIG.MAX_ENTRY_SLIPPAGE));
const SELFTEST = has('selftest');
const SELF_EDGE = Number(arg('edge', 0.06));
const CATS = ['politics', 'crypto', 'world', 'econ'];

const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2)) || 0); };
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] || 0; };
const profileOf = (b) => ({ n: b.length, edgePerBet: mean(b.map((x) => x.won - x.cost)), variance: b.reduce((s, x) => s + x.cost * (1 - x.cost), 0), medianSize: median(b.map((x) => x.size)) });

function buildProfile(bets) {
  const cats = {};
  for (const b of bets) (cats[b.category || 'other'] ??= []).push(b);
  return { overall: profileOf(bets), cats: Object.fromEntries(Object.entries(cats).map(([c, bb]) => [c, profileOf(bb)])) };
}

// ---- data source ----
function synthData() {
  let seed = 99; const rng = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const U = (lo, hi) => lo + (hi - lo) * rng(); const pick = (a) => a[Math.floor(rng() * a.length)];
  const t0 = Date.parse('2026-01-01'); const span = 180 * 864e5;
  const make = (w, n, edge, spec) => { const b = []; for (let i = 0; i < n; i++) { const category = rng() < 0.6 ? (spec || pick(CATS)) : pick(CATS); const isE = spec && category === spec; const cost = U(0.2, 0.8); const tp = Math.min(0.97, Math.max(0.03, cost + (isE ? edge : 0))); b.push({ wallet: w, marketId: `${w}-${i}`, category, time: t0 + rng() * span, cost, won: rng() < tp ? 1 : 0, size: isE ? U(2000, 9000) : U(100, 800) }); } return b; };
  const m = new Map();
  for (let i = 0; i < 16; i++) m.set(`s${i}`, make(`s${i}`, 1600, SELF_EDGE, pick(CATS)));
  for (let i = 0; i < 120; i++) m.set(`l${i}`, make(`l${i}`, 1600, 0, null));
  return m;
}

async function realData() {
  const { buildWalletBets } = await import('./src/polymarket.mjs');
  return buildWalletBets({ sinceISO: arg('since', '2026-01-01'), marketLimit: Number(arg('markets', 400)) });
}

// ---- walk-forward ----
const walletBets = SELFTEST ? synthData() : await realData();
const all = [...walletBets.values()].flat().sort((a, b) => a.time - b.time);
if (all.length < 500) { console.log(`Only ${all.length} resolved bets — not enough to walk-forward. Increase --markets / --since.`); process.exit(0); }
const tMin = all[0].time, tMax = all[all.length - 1].time;
const bounds = Array.from({ length: FOLDS + 2 }, (_, i) => tMin + (i / (FOLDS + 1)) * (tMax - tMin));

console.log(`${SELFTEST ? '[SELF-TEST] ' : ''}Walk-forward: ${walletBets.size} wallets, ${all.length} bets, ${FOLDS} folds\n`);

const follows = [];
const foldROI = [];
for (let f = 1; f <= FOLDS; f++) {
  const foldStart = bounds[f], foldEnd = bounds[f + 1];
  const trainMap = new Map();
  for (const [w, b] of walletBets) trainMap.set(w, b.filter((x) => x.time < foldStart));
  const gate = validateWallets(trainMap, CONFIG);
  const profiles = new Map(gate.validated.map((w) => [w.wallet, buildProfile(trainMap.get(w.wallet))]));

  const fff = [];
  for (const w of gate.validated) {
    const prof = profiles.get(w.wallet);
    for (const b of walletBets.get(w.wallet)) {
      if (b.time < foldStart || b.time >= foldEnd) continue;       // OUT-OF-SAMPLE window
      const sc = scoreFromProfile({ profile: prof.overall, categoryProfile: prof.cats[b.category] || null,
        signal: { size: b.size, marketLiquidity: 50000, entryVsWhalePrice: SLIP, category: b.category } });
      if (sc.score < MINSCORE) continue;
      const entry = Math.min(0.99, b.cost + SLIP);
      fff.push({ fold: f, pnl: b.won - entry, won: b.won, entry });
    }
  }
  const staked = fff.length * 1; const pnl = fff.reduce((s, x) => s + x.pnl, 0);
  foldROI.push(fff.length ? pnl / fff.length : 0);
  follows.push(...fff);
  console.log(`  fold ${f}: ${gate.validated.length} validated, ${fff.length} OOS follows, ROI ${fff.length ? (pnl / fff.length * 100).toFixed(1) : '—'}%`);
}

// ---- aggregate + strict verdict ----
console.log('\n──────── OUT-OF-SAMPLE RESULT ────────');
if (!follows.length) { console.log('No out-of-sample follows. Cannot confirm anything. (Likely no validated wallets — that itself is a FAIL for deployment.)'); process.exit(0); }

const pnls = follows.map((f) => f.pnl);
const totalPnl = pnls.reduce((s, x) => s + x, 0);
const roi = totalPnl / follows.length;            // per $1 staked
const wins = follows.filter((f) => f.pnl > 0).length;
const edgeMean = mean(pnls), edgeSE = sd(pnls) / Math.sqrt(pnls.length);
const ciLo = edgeMean - 1.96 * edgeSE, ciHi = edgeMean + 1.96 * edgeSE;
// concentration: does the edge survive removing the top 1% of winners?
const sorted = [...pnls].sort((a, b) => b - a);
const cut = Math.max(1, Math.floor(pnls.length * 0.01));
const robustPnl = sorted.slice(cut).reduce((s, x) => s + x, 0);
const foldsPositive = foldROI.filter((r) => r > 0).length;

console.log(`Follows (OOS):     ${follows.length}`);
console.log(`Win rate:          ${(wins / follows.length * 100).toFixed(1)}%`);
console.log(`ROI:               ${roi * 100 >= 0 ? '+' : ''}${(roi * 100).toFixed(2)}%   (per $1, after ${SLIP * 100}¢ slippage)`);
console.log(`Edge/follow:       ${(edgeMean * 100).toFixed(2)}¢   95% CI [${(ciLo * 100).toFixed(2)}, ${(ciHi * 100).toFixed(2)}]¢`);
console.log(`Robust (drop top 1% winners): ${robustPnl >= 0 ? '+' : ''}$${robustPnl.toFixed(0)} total`);
console.log(`Folds positive:    ${foldsPositive}/${FOLDS}`);

const gates = {
  'enough OOS follows (≥150)': follows.length >= 150,
  'ROI positive': roi > 0,
  'edge CI lower bound > 0': ciLo > 0,
  'edge survives dropping top 1% winners': robustPnl > 0,
  'positive in majority of folds': foldsPositive / FOLDS >= 0.6,
};
console.log('\nGates:');
for (const [k, v] of Object.entries(gates)) console.log(`  ${v ? '✅' : '❌'} ${k}`);
const PASS = Object.values(gates).every(Boolean);
console.log(`\n${PASS ? '✅ PASS' : '❌ FAIL'} — ${PASS
  ? 'a real out-of-sample edge existed historically. Necessary evidence — still not a guarantee. Paper-trade live, then risk small.'
  : 'no trustworthy out-of-sample edge. DO NOT deploy real money.'}`);
