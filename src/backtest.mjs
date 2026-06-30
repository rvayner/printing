// backtest.mjs — the only question that matters: would following validated wallets'
// NEW bets, entering at a realistic worse price, have made money OUT-OF-SAMPLE?
//
// Walk bets chronologically. At each new bet, decide whether to follow using ONLY
// information available before that moment (no look-ahead): the wallet must already
// be "validated" on its PAST resolved bets. Enter at cost + slippage, hold to
// resolution, realize P&L. This is the honest verdict.

import { evaluateWallet } from './skill.mjs';

export function followBacktest(allBets, config) {
  const chrono = [...allBets].sort((a, b) => a.time - b.time);
  const pastByWallet = new Map();     // wallet -> resolved bets seen so far
  const follows = [];

  // cache validation so we don't recompute every bet
  const validatedAsOf = new Map();    // wallet -> {checkedAt, isValid}

  for (const bet of chrono) {
    const past = pastByWallet.get(bet.wallet) ?? [];

    // Is this wallet validated using only its past (already-resolved) bets?
    let v = validatedAsOf.get(bet.wallet);
    if (!v || past.length !== v.checkedAt) {
      const ev = past.length >= config.MIN_BETS ? evaluateWallet(past) : { p: 1, pnlPerBet: -1 };
      // single-wallet check here; the population Bonferroni gate is applied upstream
      const isValid = past.length >= config.MIN_BETS
        && ev.p <= config.ALPHA && ev.pnlPerBet >= config.MIN_EDGE_PER_BET;
      v = { checkedAt: past.length, isValid };
      validatedAsOf.set(bet.wallet, v);
    }

    if (v.isValid) {
      const entry = Math.min(0.99, bet.cost + config.MAX_ENTRY_SLIPPAGE);
      follows.push({ wallet: bet.wallet, marketId: bet.marketId, entry, won: bet.won,
        pnl: bet.won - entry });
    }

    // now that we've "seen" it, add to the wallet's history (resolved bets only)
    pastByWallet.set(bet.wallet, [...past, bet]);
  }

  if (!follows.length) return { follows: 0 };
  const pnl = follows.reduce((s, f) => s + f.pnl, 0);
  const wins = follows.filter((f) => f.pnl > 0).length;
  return {
    follows: follows.length,
    winRate: wins / follows.length,
    totalPnl: pnl,
    avgPnlPerFollow: pnl / follows.length,
  };
}
