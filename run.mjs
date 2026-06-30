// run.mjs — the real pipeline against live Polymarket data.
//   pull resolved-market trades → build wallet track records → skill gate →
//   persistence test → out-of-sample follow backtest → emit follow signals.
//
// Needs live network access to Polymarket (sandbox: use simulate.mjs instead).
// Usage: node run.mjs --since 2026-01-01 --markets 300

import { writeFileSync } from 'node:fs';
import { CONFIG } from './config.mjs';
import { buildWalletBets } from './src/polymarket.mjs';
import { validateWallets } from './src/skill.mjs';
import { persistenceTest } from './src/persistence.mjs';
import { followBacktest } from './src/backtest.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const sinceISO = arg('since', '2026-01-01');
const marketLimit = Number(arg('markets', 300));

console.log(`Pulling Polymarket resolved-market trades since ${sinceISO} (≤${marketLimit} markets)…`);
let walletBets;
try {
  walletBets = await buildWalletBets({ sinceISO, marketLimit });
} catch (err) {
  console.error(`\nCould not reach Polymarket: ${err.message}`);
  console.error('This pipeline needs live network access. To prove the logic works, run: node simulate.mjs');
  process.exit(1);
}

const allBets = [...walletBets.values()].flat();
console.log(`Built ${walletBets.size} wallets, ${allBets.length} resolved bets.\n`);

// 1. Skill gate (Bonferroni-corrected)
const gate = validateWallets(walletBets, CONFIG);
console.log(`Skill gate: screened ${gate.nScreened} wallets (≥${CONFIG.MIN_BETS} bets), corrected α=${gate.correctedAlpha.toExponential(1)}`);
console.log(`→ ${gate.validated.length} statistically-skilled wallet(s)`);
for (const w of gate.validated.slice(0, 20)) {
  console.log(`   ${w.wallet}  n=${w.n}  z=${w.z.toFixed(1)}  edge=${(w.pnlPerBet*100).toFixed(1)}¢/bet  ROI=${(w.roi*100).toFixed(0)}%`);
}

// 2. Persistence — does past skill predict future skill here?
const times = allBets.map((b) => b.time).sort((a, b) => a - b);
const splitTime = times[Math.floor(times.length / 2)];
const persist = persistenceTest(walletBets, splitTime, CONFIG);
console.log('\nPersistence:', persist.ok
  ? `top-quartile edge A=${(persist.topA_edge*100).toFixed(1)}¢ → B=${(persist.topB_edge*100).toFixed(1)}¢ (rest ${(persist.restB_edge*100).toFixed(1)}¢, corr ${persist.rankCorr?.toFixed(2)}) → ${persist.persists ? 'PERSISTS ✅' : 'does NOT persist ❌'}`
  : persist.reason);

// 3. Out-of-sample follow backtest — the verdict
const bt = followBacktest(allBets, CONFIG);
console.log('\nFollow backtest (out-of-sample):', bt.follows
  ? `${bt.follows} follows, win ${(bt.winRate*100).toFixed(0)}%, avg ${(bt.avgPnlPerFollow*100>=0?'+':'')}${(bt.avgPnlPerFollow*100).toFixed(1)}¢/follow`
  : 'no wallet ever cleared the bar (no validated edge to follow).');

// Build scoring profiles (overall + per-category + median size) for signals.mjs.
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] || 0; };
const profileOf = (bets) => ({
  n: bets.length,
  edgePerBet: bets.reduce((s, b) => s + (b.won - b.cost), 0) / bets.length,
  variance: bets.reduce((s, b) => s + b.cost * (1 - b.cost), 0),
  medianSize: median(bets.map((b) => b.size || 0)),
});
function buildProfile(wallet) {
  const bets = walletBets.get(wallet) || [];
  const cats = {};
  for (const b of bets) (cats[b.category || 'other'] ??= []).push(b);
  return { overall: profileOf(bets), cats: Object.fromEntries(Object.entries(cats).map(([c, bb]) => [c, profileOf(bb)])) };
}

// Persist validated wallets ONLY if the evidence actually supports following.
const safeToFollow = gate.validated.length > 0 && persist.ok && persist.persists
  && bt.follows > 0 && bt.avgPnlPerFollow > 0;
const outPath = new URL('./validated-wallets.json', import.meta.url).pathname;
writeFileSync(outPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  safeToFollow,
  persistence: persist,
  backtest: bt,
  wallets: gate.validated.map((w) => ({
    wallet: w.wallet, n: w.n, z: w.z, edgePerBet: w.pnlPerBet, roi: w.roi,
    profile: buildProfile(w.wallet),
  })),
}, null, 2));

console.log(`\nSaved ${gate.validated.length} validated wallet(s) → ${outPath}`);
console.log(safeToFollow
  ? '✅ Evidence supports following. Run: node signals.mjs   (watches these wallets live)'
  : '⛔ Evidence does NOT support following (no validation / no persistence / negative backtest). Do NOT follow.');
console.log('\nDECISION RULE: only follow if (validated wallets exist) AND (persistence holds)');
console.log('AND (out-of-sample follow P&L is positive after slippage). Anything less = luck.');
