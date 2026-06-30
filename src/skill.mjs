// skill.mjs — does a wallet beat the market's OWN prices by more than luck?
//
// Normalized bet shape (produced by polymarket.mjs or simulate.mjs):
//   { wallet, marketId, time, cost, won, size }
//     cost: 0..1   price the wallet paid for the side it took (= its implied prob)
//     won:  0|1    whether that side actually resolved true
//
// A wallet's entry prices are its predictions. If it wins MORE than Σcost implies,
// by a z-score too large to be chance, it has real edge.

import { sum, pValueOneSided } from './stats.mjs';

export function evaluateWallet(bets) {
  const n = bets.length;
  if (n === 0) return { n: 0 };
  const wins = sum(bets.map((b) => b.won));
  const expWins = sum(bets.map((b) => b.cost));            // what the market priced
  const variance = sum(bets.map((b) => b.cost * (1 - b.cost))) || 1e-9;
  const excess = wins - expWins;                           // beat the market by this many wins
  const z = excess / Math.sqrt(variance);                  // calibration z-score
  const pnlPerBet = bets.reduce((s, b) => s + (b.won - b.cost), 0) / n; // realized edge/bet
  const roi = bets.reduce((s, b) => s + (b.won - b.cost) * b.size, 0)
            / (bets.reduce((s, b) => s + b.cost * b.size, 0) || 1);
  return { n, wins, expWins, excess, z, p: pValueOneSided(z), pnlPerBet, roi };
}

// Gate a population of wallets, correcting for the fact that screening many wallets
// produces false "skill" by chance (Bonferroni on ALPHA).
export function validateWallets(walletBets, config) {
  const candidates = [...walletBets.entries()]
    .map(([wallet, bets]) => ({ wallet, ...evaluateWallet(bets) }))
    .filter((w) => w.n >= config.MIN_BETS);

  const nTests = Math.max(candidates.length, 1);
  const correctedAlpha = config.ALPHA / nTests;            // Bonferroni

  const validated = candidates.filter(
    (w) => w.p <= correctedAlpha && w.pnlPerBet >= config.MIN_EDGE_PER_BET,
  );
  return {
    nScreened: candidates.length,
    correctedAlpha,
    validated: validated.sort((a, b) => b.z - a.z),
    all: candidates.sort((a, b) => b.z - a.z),
  };
}
