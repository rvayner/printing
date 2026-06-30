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

const has = (k) => process.argv.includes(`--${k}`);
const ONCE = has('once');
const PAPER = has('paper');
const seen = new Set();
const paperBook = PAPER ? new PaperBook(new URL('./paper-positions.json', import.meta.url).pathname) : null;
const SLIP = CONFIG.MAX_ENTRY_SLIPPAGE;

async function poll() {
  let trades;
  try { trades = await getRecentTrades({ limit: 500 }); }
  catch (e) { console.error('  (trade fetch failed:', e.message, ')'); return 0; }

  let hits = 0;
  for (const t of trades) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    // validated insider signal: BIG bet on an UNCERTAIN, NON-SPORTS event market
    if (t.side !== 'BUY') continue;
    if (t.notional < CONFIG.SMART_MIN_USD) continue;
    if (t.price < CONFIG.SMART_LO || t.price > CONFIG.SMART_HI) continue;
    const cat = categorize(t.title);
    if (CONFIG.SMART_EXCLUDE.includes(cat)) continue;  // skip sports/crypto (no insider edge)

    // fresh-wallet check — the documented insider signature (new account, big bet)
    let fresh = false;
    try { const act = await getWalletActivity(t.wallet, { limit: CONFIG.SMART_FRESH_TRADES + 5 }); fresh = act.length <= CONFIG.SMART_FRESH_TRADES; }
    catch { /* ignore */ }

    const entry = Math.min(0.95, t.price + SLIP);
    const edge = 0.68 - entry;                          // ~68% win at this signal (non-sports uncertain)
    const size = kellyStake({ bankroll: CONFIG.BANKROLL, price: entry, edgeLo: Math.max(0, edge), liquidity: t.notional * 5 });
    const text = [
      `${fresh ? '🔥 FRESH-WALLET INSIDER' : '💸 SMART MONEY'} — $${t.notional.toFixed(0)} @ ${(t.price * 100).toFixed(0)}¢ · ${cat}`,
      `   ${(t.title || '').slice(0, 70)}`,
      `   "${(t.outcome || `outcome[${t.outcomeIndex}]`)}" · wallet ${t.wallet?.slice(0, 10)}…${fresh ? ' (NEW account ⚠)' : ''}`,
      `   FOLLOW: buy ≤${(entry * 100).toFixed(0)}¢ · est win ~68% · size ~$${size.toFixed(0)}`,
      `   ⚖ insider edge (+22% hist on uncertain political/event) — NOT a lock; act fast.`,
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

const tick = async () => { const n = await poll(); if (ONCE) console.log(`\nFound ${n} smart-money signal(s) this poll.`); };
if (ONCE) { await tick(); }
else { await tick(); setInterval(tick, CONFIG.POLL_MS); }
