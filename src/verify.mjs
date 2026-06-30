// verify.mjs — flag signals that look like price-SWINGING / manipulation rather
// than genuine informed conviction. Heuristics on public on-chain behavior. NOT
// foolproof (a sophisticated actor splits across wallets) — but it catches the
// obvious swings: round-tripping, price-impact pumps, and uncorroborated thin-market
// bets. Anything HIGH risk is suppressed by default.

import { CONFIG } from '../config.mjs';

// walletRecentTrades: this wallet's recent activity (BUY/SELL across markets)
export function verifySignal({ walletRecentTrades = [], marketId, betSize, marketLiquidity, surgeCount = 1 }) {
  const sameMarket = walletRecentTrades.filter((t) => t.conditionId === marketId);
  const bought = sameMarket.some((t) => t.side === 'BUY');
  const sold = sameMarket.some((t) => t.side === 'SELL');
  const roundTrip = bought && sold;                       // bought AND sold same market = not held conviction

  const impactFrac = marketLiquidity ? betSize / marketLiquidity : 1;
  const highImpact = impactFrac > CONFIG.MAX_FILL_FRACTION * 3; // bet itself likely moved the price
  const isolated = surgeCount < 2;                        // no corroborating validated wallets

  const flags = [];
  if (roundTrip) flags.push('round-trip: bought AND sold this market (not held conviction)');
  if (highImpact) flags.push(`price impact: bet ≈ ${(impactFrac * 100).toFixed(0)}% of liquidity (moved the price itself)`);
  if (isolated && (roundTrip || highImpact)) flags.push('single wallet, uncorroborated');

  let risk = 'LOW';
  if (roundTrip || highImpact) risk = isolated ? 'HIGH' : 'MEDIUM';

  return { risk, flags, roundTrip, highImpact, impactFrac };
}
