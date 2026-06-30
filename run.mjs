// run.mjs — the real pipeline against live Polymarket data.
//   pull resolved-market trades → build wallet track records → skill gate →
//   persistence test → out-of-sample follow backtest → emit follow signals.
//
// Needs live network access to Polymarket (sandbox: use simulate.mjs instead).
// Usage: node run.mjs --since 2026-01-01 --markets 300

import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { CONFIG } from './config.mjs';
import { buildWalletBets } from './src/polymarket.mjs';
import { validateWallets } from './src/skill.mjs';
import { persistenceTest } from './src/persistence.mjs';
import { followBacktest } from './src/backtest.mjs';
import { categoryLeaderboards, formatLeaderboards } from './src/leaderboard.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(`--${k}`);
const sinceISO = arg('since', '2026-01-01');
const marketLimit = Number(arg('markets', 300));
const SELFTEST = has('selftest');

// Synthetic data so the whole pipeline (+ daily digest) runs without network.
function synthData() {
  let seed = 123; const rng = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const U = (lo, hi) => lo + (hi - lo) * rng(); const CATS = ['politics', 'crypto', 'world', 'econ']; const pick = (a) => a[Math.floor(rng() * a.length)];
  const t0 = Date.parse('2026-01-01'); const span = 180 * 864e5;
  const make = (w, n, edge, spec) => { const b = []; for (let i = 0; i < n; i++) { const category = rng() < 0.6 ? (spec || pick(CATS)) : pick(CATS); const isE = spec && category === spec; const cost = U(0.2, 0.8); const tp = Math.min(0.97, Math.max(0.03, cost + (isE ? edge : 0))); b.push({ wallet: w, marketId: `${w}-${i}`, category, time: t0 + rng() * span, cost, won: rng() < tp ? 1 : 0, size: isE ? U(2000, 9000) : U(100, 800) }); } return b; };
  const m = new Map();
  for (let i = 0; i < 16; i++) m.set(`skill_${i}`, make(`skill_${i}`, 1600, 0.08, pick(CATS)));
  for (let i = 0; i < 120; i++) m.set(`luck_${i}`, make(`luck_${i}`, 1600, 0, null));
  return m;
}

let walletBets;
if (SELFTEST) {
  console.log('[SELF-TEST] synthetic wallets (no network) — verifies the full pipeline + digest.');
  walletBets = synthData();
} else {
  console.log(`Pulling Polymarket resolved-market trades since ${sinceISO} (≤${marketLimit} markets)…`);
  try {
    walletBets = await buildWalletBets({ sinceISO, marketLimit });
  } catch (err) {
    console.error(`\nCould not reach Polymarket: ${err.message}`);
    console.error('This pipeline needs live network access. To prove the logic works, run: node run.mjs --selftest');
    process.exit(1);
  }
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
const walletsWithProfiles = gate.validated.map((w) => ({
  wallet: w.wallet, n: w.n, z: w.z, edgePerBet: w.pnlPerBet, roi: w.roi,
  profile: buildProfile(w.wallet),
}));

// Per-category specialist leaderboards
const boards = categoryLeaderboards(walletsWithProfiles);
console.log('\n──── Category specialists (ranked by proven edge) ────');
console.log(formatLeaderboards(boards));

const outPath = new URL('./validated-wallets.json', import.meta.url).pathname;

// Read the PREVIOUS run first (for change detection) before overwriting.
let prev = null;
if (existsSync(outPath)) { try { prev = JSON.parse(readFileSync(outPath)); } catch { /* ignore */ } }
const prevSet = new Set((prev?.wallets || []).map((w) => w.wallet));
const nowSet = new Set(walletsWithProfiles.map((w) => w.wallet));
const entered = [...nowSet].filter((w) => !prevSet.has(w));
const dropped = [...prevSet].filter((w) => !nowSet.has(w));
const statusChanged = prev != null && prev.safeToFollow !== safeToFollow;

writeFileSync(outPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  safeToFollow,
  persistence: persist,
  backtest: bt,
  leaderboards: boards,
  wallets: walletsWithProfiles,
}, null, 2));

console.log(`\nSaved ${gate.validated.length} validated wallet(s) → ${outPath}`);
console.log(safeToFollow
  ? '✅ Evidence supports following. Run: node signals.mjs   (watches these wallets live)'
  : '⛔ Evidence does NOT support following (no validation / no persistence / negative backtest). Do NOT follow.');

// ---- daily briefing (saved/pushable) ----
if (has('notify') || has('report')) {
  const topPerCat = Object.entries(boards)
    .map(([c, rows]) => rows[0] ? `${c}: ${rows[0].wallet.slice(0, 10)}… ${(rows[0].edge * 100).toFixed(1)}¢ (n=${rows[0].n})` : null)
    .filter(Boolean).join('\n');
  const digest = [
    `📅 whale-tracker — ${new Date().toISOString().slice(0, 10)}`,
    `${safeToFollow ? '✅ FOLLOW OK' : '⛔ DO NOT follow'}${statusChanged ? '  ⚠️ STATUS CHANGED' : ''}`,
    `${walletsWithProfiles.length} validated wallet(s)  (+${entered.length} new, -${dropped.length} dropped)`,
    entered.length ? `🆕 ${entered.map((w) => w.slice(0, 10) + '…').join(', ')}` : '',
    dropped.length ? `❌ dropped: ${dropped.map((w) => w.slice(0, 10) + '…').join(', ')}` : '',
    topPerCat ? `\nTop specialists:\n${topPerCat}` : '',
    `\nReminder: go-live still needs a walk-forward PASS + months of paper.`,
  ].filter(Boolean).join('\n');
  if (has('report')) writeFileSync(new URL('./run-report.txt', import.meta.url).pathname, digest);
  console.log('\n' + digest);
  if (has('notify')) { const { sendAlert } = await import('./src/notify.mjs'); await sendAlert(digest); console.log('\nPushed daily briefing to configured channels.'); }
}

console.log('\nDECISION RULE: only follow if (validated wallets exist) AND (persistence holds)');
console.log('AND (out-of-sample follow P&L is positive after slippage). Anything less = luck.');
