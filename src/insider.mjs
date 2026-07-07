// insider.mjs — the statistically-structured insider score, from the documented
// indicators validated on real data (see insider-signal.mjs):
//   fresh wallet + big size + non-sports EVENT market + uncertain price.
// Higher score = higher validated win rate. The PRIME tier (fresh + very-big) is
// the Bubblemaps insider profile (72% win) but rare — trust the direction.

import { CONFIG } from '../config.mjs';

const VERY_BIG = 4000;

// features: { notional, price, category, walletTradeCount, liquidity, hoursToResolve, marketAgeHours }
//   walletTradeCount / liquidity / hoursToResolve / marketAgeHours = null → unknown.
// Maturity features are OPTIONAL: when a value is unknown we do NOT block on it
// (a metadata-fetch hiccup must never silently zero the whole signal — "never
// hard-fail"), but we flag maturityUnknown so the caller can be cautious.
export function insiderScore({ notional, price, category, walletTradeCount,
  liquidity = null, hoursToResolve = null, marketAgeHours = null }) {
  const fresh = walletTradeCount != null && walletTradeCount <= CONFIG.SMART_FRESH_TRADES;
  const big = notional >= CONFIG.SMART_MIN_USD;
  const vbig = notional >= VERY_BIG;
  const event = !CONFIG.SMART_EXCLUDE.includes(category);
  const uncertain = price >= CONFIG.SMART_LO && price <= CONFIG.SMART_HI;
  const score = (fresh ? 1 : 0) + (big ? 1 : 0) + (vbig ? 1 : 0) + (event ? 1 : 0) + (uncertain ? 1 : 0);

  // Market-maturity guard: a big bet is only trustworthy on a settled, liquid,
  // reasonably-dated market. Each check passes when its data is unknown (lenient
  // on missing metadata) but FAILS a known-bad value.
  const liqOk = liquidity == null || liquidity >= CONFIG.SMART_MIN_MATURITY_LIQ;
  const horizonOk = hoursToResolve == null
    || (hoursToResolve >= CONFIG.MIN_MARKET_HOURS_LEFT && hoursToResolve <= CONFIG.SMART_MAX_DAYS_TO_RESOLVE * 24);
  const ageOk = marketAgeHours == null || marketAgeHours >= CONFIG.SMART_MIN_MARKET_AGE_HOURS;
  const mature = liqOk && horizonOk && ageOk;
  const maturityUnknown = liquidity == null && hoursToResolve == null && marketAgeHours == null;
  const maturityReason = [
    liqOk ? null : `thin book ($${Math.round(liquidity)} < $${CONFIG.SMART_MIN_MATURITY_LIQ})`,
    horizonOk ? null : (hoursToResolve > CONFIG.SMART_MAX_DAYS_TO_RESOLVE * 24
      ? `far-dated (${Math.round(hoursToResolve / 24)}d > ${CONFIG.SMART_MAX_DAYS_TO_RESOLVE}d)`
      : `near-expiry (${Math.round(hoursToResolve)}h left)`),
    ageOk ? null : `freshly-listed (${Math.round(marketAgeHours)}h old < ${CONFIG.SMART_MIN_MARKET_AGE_HOURS}h)`,
  ].filter(Boolean).join(', ') || (maturityUnknown ? 'maturity unknown' : 'mature');

  // validated expected win rate + tier (conservative; from the z-tested cohorts)
  let tier, expWin;
  if (fresh && vbig && event && uncertain) { tier = '🔥 PRIME INSIDER'; expWin = 0.70; }
  else if (fresh && big && event && uncertain) { tier = 'STRONG (fresh)'; expWin = 0.66; }
  else if (big && event && uncertain) { tier = 'informed'; expWin = 0.68; }
  else if (big && event) { tier = 'weak'; expWin = Math.max(price, 0.5); }
  else { tier = 'noise'; expWin = price; }

  return { score, tier, expWin, fresh, big, vbig, event, uncertain,
    mature, maturityUnknown, maturityReason,
    // baseline validated bar (z=3.1) AND the market must clear the maturity guard
    actionable: big && event && uncertain && mature };
}
