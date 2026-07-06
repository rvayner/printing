// config.mjs — tunable thresholds for the skill gates. Conservative by default;
// loosening these is how copy-traders fool themselves.
export const CONFIG = {
  MIN_BETS: 40,          // wallets with fewer resolved bets are mostly noise
  ALPHA: 0.05,           // significance level BEFORE multiple-testing correction
  MIN_EDGE_PER_BET: 0.02, // require ≥2¢ realized edge/bet on top of significance
  // Following filters — a signal is only actionable if you can still get in:
  MAX_ENTRY_SLIPPAGE: 0.03, // assume you enter this much worse than the whale
  MIN_MARKET_HOURS_LEFT: 6,  // skip near-expiry markets (price already settled)
  // Persistence test:
  PERSIST_TOP_FRACTION: 0.25, // "top wallets" = top quartile of period A
  // Real-time watcher (signals.mjs):
  POLL_MS: 30000,            // how often to poll each validated wallet
  MIN_LIQUIDITY: 1000,       // skip illiquid markets you can't actually fill
  WEBHOOK_URL: process.env.WEBHOOK_URL || null, // optional Discord/Slack/Telegram
  // Signal scoring + surge:
  MIN_SCORE: 60,             // only alert/paper-trade signals scoring ≥ this (0-100)
  SURGE_WINDOW_MS: 6 * 3600 * 1000, // window to detect converging validated wallets
  SURGE_MIN_WALLETS: 2,      // distinct validated wallets on same outcome = surge
  // Urgency + niche:
  FRESH_MINS: 60,            // a whale bet placed within this is "fresh" → act fast
  SOON_HOURS: 12,            // market resolving within this is time-sensitive
  NICHE_LIQUIDITY: 15000,    // below this = niche/obscure (informed-likely but thin)
  MAX_FILL_FRACTION: 0.05,   // never try to fill more than this share of liquidity
  // Circuit breaker: pause live alerts unless a fresh walk-forward PASS exists.
  WALKFORWARD_MAX_AGE_DAYS: 7, // verdict older than this = stale → pause until re-run
  // Position sizing (fractional Kelly):
  BANKROLL: 2000,            // your bankroll, for suggested bet sizes in alerts
  KELLY_MULT: 0.25,          // quarter-Kelly — safety margin against bad estimates
  MAX_BANKROLL_FRAC: 0.05,   // never stake more than 5% of bankroll on one bet
  // Smart-money / insider tracker (validated: big bets on uncertain NON-SPORTS
  // political/event markets are informed → +22% ROI):
  SMART_MIN_USD: 1000,       // a bet ≥ this $ on an uncertain event market = signal
  SMART_LO: 0.35, SMART_HI: 0.70, // uncertain band where insider info shows
  SMART_EXCLUDE: ['sports', 'crypto'], // no insider edge here (sharp bettors, not insiders)
  SMART_FRESH_TRADES: 25,    // a wallet with ≤ this many trades = FRESH (insider signature)
  // Diversification guard (favorites have negative skew → correlation is the risk):
  MAX_PER_EVENT: 1,          // at most this many positions per Polymarket event
  MAX_CATEGORY_FRAC: 0.30,   // ≤30% of bankroll in any one category
  MAX_DEPLOYED_FRAC: 0.50,   // deploy ≤50% of bankroll at once (keep dry powder)
  MAX_POSITIONS: 40,         // total concurrent positions cap
  // Favorites: trade real-world EVENT markets only. Sports = unpredictable + weak
  // edge (+1%) + intra-game correlation; crypto = price speculation, not events.
  FAV_EXCLUDE: ['sports', 'crypto'],   // → politics, geopolitics, econ, world/other
  // Live-execution hard safety caps (executor cannot exceed these, ever):
  EXEC_MAX_ORDER_USD: 25,    // no single real order larger than this
  EXEC_MAX_TOTAL_USD: 250,   // no more than this total across a run
  EXEC_MAX_ORDERS: 20,       // no more than this many orders per run
};
