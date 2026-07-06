// smart-money.mjs — the whale tracker, REBORN on the validated signal. Watches
// live Polymarket trades for LARGE bets on MID-PRICED (uncertain) markets — the
// informed-money pattern we proved returns +11% (95% CI [4.8,17.7], 5/6 folds).
// Alerts + paper-trades, follows the big bettor's side at a realistic entry.
//
// Run:  node smart-money.mjs            (live loop)
//       node smart-money.mjs --once     (single poll)
//       node --env-file=.env smart-money.mjs --paper --notify
//
// NOT favorites (that's favorites-scan). This is the genuine insider signal:
// someone betting big on something the market still thinks is a coin flip.

import { CONFIG } from './config.mjs';
import { getRecentTrades, getWalletActivity, categorize } from './src/polymarket.mjs';
import { kellyStake } from './src/sizing.mjs';
import { PaperBook } from './src/paper.mjs';
import { sendAlert, configuredChannels } from './src/notify.mjs';
import { insiderScore } from './src/insider.mjs';

const has = (k) => process.argv.includes(`--${k}`);
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const ONCE = has('once');
const PAPER = has('paper');
const FRESH_ONLY = has('fresh-only');   // hard filter: only new-account insiders
const MIN_SCORE = arg('min-score', 3);
const seen = new Set();
const paperBook = PAPER ? new PaperBook(new URL('./paper-positions.json', import.meta.url).pathname) : null;
const SLIP = CONFIG.MAX_ENTRY_SLIPPAGE;

async function poll() {
  let trades;
  // Pull 1000, not 500: on busy days (a match day + a freshly-listed election
  // market) real actionable signals scoring 3-4/5 fall OUTSIDE a 500-trade window
  // and get silently missed. Verified live 2026-07-06 — three score-3+ bets sat in
  // the 500-1000 recency band and the old limit never saw them.
  try { trades = await getRecentTrades({ limit: 1000 }); }
  catch (e) { console.error('  (trade fetch failed:', e.message, ')'); return 0; }

  let hits = 0;
  for (const t of trades) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    // cheap pre-filters before the (costlier) wallet-freshness lookup
    if (t.side !== 'BUY' || t.notional < CONFIG.SMART_MIN_USD) continue;
    if (t.price < CONFIG.SMART_LO || t.price > CONFIG.SMART_HI) continue;
    const cat = categorize(t.title);
    if (CONFIG.SMART_EXCLUDE.includes(cat)) continue;  // no insider edge in sports/crypto

    // wallet freshness — the documented insider signature (new account)
    let walletTradeCount = null;
    try { walletTradeCount = (await getWalletActivity(t.wallet, { limit: CONFIG.SMART_FRESH_TRADES + 5 })).length; }
    catch { /* unknown */ }

    const sig = insiderScore({ notional: t.notional, price: t.price, category: cat, walletTradeCount });
    if (!sig.actionable || sig.score < MIN_SCORE) continue;   // must clear the z=3.1 bar
    if (FRESH_ONLY && !sig.fresh) continue;                    // hard filter: new accounts only

    const entry = Math.min(0.95, t.price + SLIP);
    const size = kellyStake({ bankroll: CONFIG.BANKROLL, price: entry, edgeLo: Math.max(0, sig.expWin - entry), liquidity: t.notional * 5 });
    const text = [
      `${sig.tier} — score ${sig.score}/5 · $${t.notional.toFixed(0)} @ ${(t.price * 100).toFixed(0)}¢ · ${cat}`,
      `   ${(t.title || '').slice(0, 70)}`,
      `   "${(t.outcome || `outcome[${t.outcomeIndex}]`)}" · wallet ${t.wallet?.slice(0, 10)}…${sig.fresh ? ` (FRESH: ${walletTradeCount} trades ⚠)` : ''}`,
      `   FOLLOW: buy ≤${(entry * 100).toFixed(0)}¢ · est win ${(sig.expWin * 100).toFixed(0)}% · size ~$${size.toFixed(0)}`,
      `   ⚖ statistically-validated insider signal — NOT a lock; act fast, price moves.`,
    ].join('\n');
    await sendAlert(text);
    if (paperBook) {
      paperBook.open({ id: `smart-${t.id}`, wallet: t.wallet, marketId: t.conditionId,
        question: t.title, side: `outcome[${t.outcomeIndex}]`, outcomeIndex: t.outcomeIndex,
        entry, resolveTime: null, stake: Math.max(10, size) });
    }
    hits++;
  }
  return hits;
}

const channels = configuredChannels();
console.log(`Smart-money tracker — big bets (≥$${CONFIG.SMART_MIN_USD}) on ${CONFIG.SMART_LO * 100}-${CONFIG.SMART_HI * 100}¢ markets.`);
console.log(channels.length ? `Alerts → console + ${channels.join(' + ')}.` : 'Alerts → console (set Telegram for push).');

const INTERVAL = arg('interval', 8) * 1000;   // near-real-time by default (8s)
const tick = async () => { const n = await poll(); if (ONCE) console.log(`\nFound ${n} smart-money signal(s) this poll.`); };
if (ONCE) { await tick(); }
else { console.log(`Polling every ${INTERVAL / 1000}s.`); await tick(); setInterval(tick, INTERVAL); }
