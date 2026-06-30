// persistence.mjs — THE make-or-break test. Skill must persist out-of-sample.
//
// Split each wallet's bets at `splitTime`. Rank wallets by edge in period A (older).
// Then measure whether period-A top performers STILL outperform in period B (newer).
// If they don't, the "skill" was luck and following is futile — no matter how good
// the in-sample numbers looked.

import { evaluateWallet } from './skill.mjs';
import { mean, spearman } from './stats.mjs';

export function persistenceTest(walletBets, splitTime, config) {
  const rows = [];
  for (const [wallet, bets] of walletBets) {
    const a = bets.filter((b) => b.time < splitTime);
    const b = bets.filter((b) => b.time >= splitTime);
    if (a.length < config.MIN_BETS / 2 || b.length < config.MIN_BETS / 2) continue;
    rows.push({ wallet, a: evaluateWallet(a), b: evaluateWallet(b) });
  }
  if (rows.length < 4) {
    return { ok: false, reason: `only ${rows.length} wallets with bets in both periods` };
  }

  // Top quartile by period-A edge → how did they do in period B?
  rows.sort((x, y) => y.a.pnlPerBet - x.a.pnlPerBet);
  const k = Math.max(1, Math.floor(rows.length * config.PERSIST_TOP_FRACTION));
  const topA = rows.slice(0, k);
  const rest = rows.slice(k);

  const topB_edge = mean(topA.map((r) => r.b.pnlPerBet));
  const restB_edge = mean(rest.map((r) => r.b.pnlPerBet));
  const rankCorr = spearman(rows.map((r) => [r.a.pnlPerBet, r.b.pnlPerBet]));

  // Persistence holds if A-winners keep a positive edge in B AND beat the rest,
  // and A→B ranks are positively correlated.
  const persists = topB_edge > 0 && topB_edge > restB_edge && (rankCorr ?? 0) > 0.1;
  return {
    ok: true, nWallets: rows.length, topN: k,
    topA_edge: mean(topA.map((r) => r.a.pnlPerBet)),
    topB_edge, restB_edge, rankCorr, persists,
  };
}
