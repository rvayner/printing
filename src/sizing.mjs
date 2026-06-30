// sizing.mjs — fractional-Kelly position sizing. Bet MORE on high-edge, high-
// confidence signals and LESS on marginal ones, to maximize long-run growth while
// capping risk. Uses the CONSERVATIVE edge (CI lower bound) and quarter-Kelly so a
// bad estimate can't blow up the bankroll.

import { CONFIG } from '../config.mjs';

// Full-Kelly fraction for a binary bet bought at `price` with true win prob `q`.
// Net odds b = (1-price)/price; f* = (b·q − (1−q)) / b.
export function kellyFraction(price, edge) {
  const q = Math.max(0.01, Math.min(0.99, price + edge));
  const b = (1 - price) / price;
  const f = (b * q - (1 - q)) / b;
  return Math.max(0, f);
}

// Suggested stake in dollars. Quarter-Kelly, then capped by (a) a hard bankroll
// fraction and (b) the liquidity fill cap — whichever is smallest.
export function kellyStake({ bankroll, price, edgeLo, liquidity }) {
  if (edgeLo <= 0) return 0;                              // no proven edge → no bet
  const f = kellyFraction(price, edgeLo) * CONFIG.KELLY_MULT;
  let stake = Math.min(f, CONFIG.MAX_BANKROLL_FRAC) * bankroll;
  if (liquidity) stake = Math.min(stake, liquidity * CONFIG.MAX_FILL_FRACTION);
  return Math.max(0, stake);
}
