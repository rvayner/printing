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
};
