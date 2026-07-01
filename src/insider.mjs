// insider.mjs — the statistically-structured insider score, from the documented
// indicators validated on real data (see insider-signal.mjs):
//   fresh wallet + big size + non-sports EVENT market + uncertain price.
// Higher score = higher validated win rate. The PRIME tier (fresh + very-big) is
// the Bubblemaps insider profile (72% win) but rare — trust the direction.

import { CONFIG } from '../config.mjs';

const VERY_BIG = 4000;

// features: { notional, price, category, walletTradeCount }  (walletTradeCount null = unknown)
export function insiderScore({ notional, price, category, walletTradeCount }) {
  const fresh = walletTradeCount != null && walletTradeCount <= CONFIG.SMART_FRESH_TRADES;
  const big = notional >= CONFIG.SMART_MIN_USD;
  const vbig = notional >= VERY_BIG;
  const event = !CONFIG.SMART_EXCLUDE.includes(category);
  const uncertain = price >= CONFIG.SMART_LO && price <= CONFIG.SMART_HI;
  const score = (fresh ? 1 : 0) + (big ? 1 : 0) + (vbig ? 1 : 0) + (event ? 1 : 0) + (uncertain ? 1 : 0);

  // validated expected win rate + tier (conservative; from the z-tested cohorts)
  let tier, expWin;
  if (fresh && vbig && event && uncertain) { tier = '🔥 PRIME INSIDER'; expWin = 0.70; }
  else if (fresh && big && event && uncertain) { tier = 'STRONG (fresh)'; expWin = 0.66; }
  else if (big && event && uncertain) { tier = 'informed'; expWin = 0.68; }
  else if (big && event) { tier = 'weak'; expWin = Math.max(price, 0.5); }
  else { tier = 'noise'; expWin = price; }

  return { score, tier, expWin, fresh, big, vbig, event, uncertain,
    actionable: big && event && uncertain };   // baseline validated bar (z=3.1)
}
