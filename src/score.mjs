// score.mjs — rate a live whale signal 0-100 in real time: how PROVEN is the
// wallet, how CONVICTED is this specific bet, and can you still get in. Includes
// a statistical confidence interval on the wallet's true edge.
//
// Honest framing: a high score means "a statistically-proven wallet is making a
// high-conviction bet you can still enter" — NOT "this bet will win". Any single
// bet is still mostly variance; the edge only shows over many scored follows.

import { evaluateWallet } from './skill.mjs';

const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));

// 95% confidence interval on the wallet's true edge per bet (wins above what its
// own entry prices implied). If the LOWER bound > 0, the edge is statistically
// real, not luck.
export function walletEdgeCI(bets, zCrit = 1.96) {
  const ev = evaluateWallet(bets);
  if (!ev.n) return { n: 0, edgePerBet: 0, lo: 0, hi: 0, significant: false };
  const variance = bets.reduce((s, b) => s + b.cost * (1 - b.cost), 0);
  const sePerBet = Math.sqrt(variance) / ev.n;
  return {
    n: ev.n, z: ev.z, edgePerBet: ev.pnlPerBet,
    lo: ev.pnlPerBet - zCrit * sePerBet,
    hi: ev.pnlPerBet + zCrit * sePerBet,
    significant: ev.pnlPerBet - zCrit * sePerBet > 0,
  };
}

// Score a live signal. Inputs:
//   bets            all of the wallet's resolved bets (for overall edge CI)
//   categoryBets    its bets in THIS market category (politics/crypto/…), or []
//   signal: { size, marketLiquidity, walletMedianSize, entryVsWhalePrice }
export function scoreSignal({ bets, categoryBets = [], signal }) {
  const overall = walletEdgeCI(bets);
  const category = categoryBets.length >= 20 ? walletEdgeCI(categoryBets) : null;

  // 1) Proven edge — use the LOWER CI bound (conservative). 5¢ floor = full marks.
  const edgeScore = clamp(overall.lo / 0.05);
  // 2) Category fit — does the wallet have a proven edge in THIS kind of market?
  const catScore = category ? clamp(category.lo / 0.05) : 0.3; // unknown → modest
  // 3) Conviction — bet size vs the wallet's own median AND vs market depth.
  const vsSelf = clamp((signal.size / (signal.walletMedianSize || signal.size)) / 3);
  const vsMkt = clamp(signal.size / ((signal.marketLiquidity || signal.size) * 0.1));
  const conviction = (vsSelf + vsMkt) / 2;
  // 4) Entry quality — can you still get in near the whale's price?
  const entryScore = clamp(1 - (signal.entryVsWhalePrice || 0) / 0.05);

  return composite(overall, category, signal);
}

// Edge CI from precomputed stats (so signals.mjs can score without raw bets).
export function edgeCIFromStats({ n, edgePerBet, variance }, zCrit = 1.96) {
  if (!n) return { n: 0, edgePerBet: 0, lo: 0, hi: 0, significant: false };
  const sePerBet = Math.sqrt(variance) / n;
  return { n, edgePerBet, lo: edgePerBet - zCrit * sePerBet, hi: edgePerBet + zCrit * sePerBet,
    significant: edgePerBet - zCrit * sePerBet > 0 };
}

// Score a signal from a persisted wallet PROFILE (built by run.mjs):
//   profile         { n, edgePerBet, variance, medianSize }
//   categoryProfile { n, edgePerBet, variance } for this market's category, or null
export function scoreFromProfile({ profile, categoryProfile = null, signal }) {
  const overall = edgeCIFromStats(profile);
  const category = categoryProfile && categoryProfile.n >= 20 ? edgeCIFromStats(categoryProfile) : null;
  return composite(overall, category, { ...signal, walletMedianSize: signal.walletMedianSize ?? profile.medianSize });
}

function composite(overall, category, signal) {
  const edgeScore = clamp(overall.lo / 0.05);
  const catScore = category ? clamp(category.lo / 0.05) : 0.3;
  const vsSelf = clamp((signal.size / (signal.walletMedianSize || signal.size)) / 3);
  const vsMkt = clamp(signal.size / ((signal.marketLiquidity || signal.size) * 0.1));
  const conviction = (vsSelf + vsMkt) / 2;
  const entryScore = clamp(1 - (signal.entryVsWhalePrice || 0) / 0.05);
  const score = Math.round(100 * (0.40 * edgeScore + 0.20 * catScore + 0.20 * conviction + 0.20 * entryScore));
  return {
    score, breakdown: { edgeScore, catScore, conviction, entryScore },
    edgeCI: overall, categoryCI: category,
    verdict: score >= 70 ? 'STRONG' : score >= 50 ? 'fair' : 'weak — likely skip',
  };
}
