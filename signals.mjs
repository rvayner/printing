// signals.mjs — watch validated wallets live; alert when one opens a new bet you
// can STILL follow (open market, liquid, ask not already past your entry cap).
//
// Reads validated-wallets.json (written by run.mjs). Refuses to run unless that
// file says the evidence actually supports following — no validated edge, no signals.
//
// Run:  node signals.mjs            # live loop (needs Polymarket network)
//       node signals.mjs --once     # single poll, then exit
//       node signals.mjs --demo     # inject a fake signal to see the alert fire
// Optional: WEBHOOK_URL=<discord/slack/telegram> for push alerts.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { CONFIG } from './config.mjs';
import { getWalletActivity, getMarketState, getTokenBestAsk } from './src/polymarket.mjs';
import { PaperBook } from './src/paper.mjs';
import { sendAlert, configuredChannels } from './src/notify.mjs';
import { scoreFromProfile } from './src/score.mjs';
import { SurgeTracker } from './src/surge.mjs';

const DEMO = process.argv.includes('--demo');
const PAPER = process.argv.includes('--paper');
const ONCE = process.argv.includes('--once') || DEMO;
const PAPER_PATH = new URL('./paper-positions.json', import.meta.url).pathname;
const paperBook = PAPER ? new PaperBook(DEMO ? null : PAPER_PATH) : null;
const VALID_PATH = new URL('./validated-wallets.json', import.meta.url).pathname;
const SEEN_PATH = new URL('./seen-trades.json', import.meta.url).pathname;

const loadSeen = () => (existsSync(SEEN_PATH) ? new Set(JSON.parse(readFileSync(SEEN_PATH))) : new Set());
const saveSeen = (s) => writeFileSync(SEEN_PATH, JSON.stringify([...s]));

const notify = (text) => sendAlert(text);

// Decide whether a fresh whale BUY is still worth following, and why/why not.
async function evaluateSignal(trade, getState, getAsk) {
  if (trade.side !== 'BUY') return { follow: false, reason: 'not an opening buy' };
  const m = await getState(trade.conditionId);
  if (!m || !m.open) return { follow: false, reason: 'market closed' };
  const hoursLeft = m.endDate ? (m.endDate - Date.now()) / 3600e3 : Infinity;
  if (hoursLeft < CONFIG.MIN_MARKET_HOURS_LEFT) return { follow: false, reason: `only ${hoursLeft.toFixed(1)}h left` };
  if (m.liquidity < CONFIG.MIN_LIQUIDITY) return { follow: false, reason: `illiquid ($${m.liquidity.toFixed(0)})` };

  const maxEntry = Math.min(0.99, trade.price + CONFIG.MAX_ENTRY_SLIPPAGE);
  const tokenId = m.tokenIds?.[trade.outcomeIndex];
  const ask = tokenId ? await getAsk(tokenId) : null;
  if (ask == null) return { follow: false, reason: 'no live ask' };
  if (ask > maxEntry) return { follow: false, reason: `ask ${(ask*100).toFixed(0)}¢ already past cap ${(maxEntry*100).toFixed(0)}¢` };
  return { follow: true, market: m, hoursLeft, maxEntry, ask };
}

function formatAlert(trade, ev, sc, surge) {
  const ci = sc.edgeCI;
  const lines = [
    `${surge?.surge ? '🚨 SURGE' : '🐋 FOLLOW'} SIGNAL — score ${sc.score}/100 (${sc.verdict})`,
    `   ${ev.market.question}`,
    `   wallet ${trade.wallet.slice(0, 10)}…  BUY outcome[${trade.outcomeIndex}] @ ${(trade.price*100).toFixed(0)}¢  size $${trade.size.toFixed(0)}`,
    `   wallet edge ${(ci.edgePerBet*100).toFixed(1)}¢  95% CI [${(ci.lo*100).toFixed(1)}, ${(ci.hi*100).toFixed(1)}]¢ (n=${ci.n})`,
    `   live ask ${(ev.ask*100).toFixed(0)}¢  →  place LIMIT BUY ≤ ${(ev.maxEntry*100).toFixed(0)}¢`,
    `   liquidity $${ev.market.liquidity.toFixed(0)}  ·  ${ev.market.category}  ·  ${ev.hoursLeft.toFixed(1)}h to resolve`,
  ];
  if (surge?.surge) lines.push(`   ⚡ ${surge.count} validated wallets converging on this outcome`);
  return lines.join('\n');
}

async function pollOnce(wallets, seen, fetchers) {
  let alerts = 0;
  for (const w of wallets) {
    let trades;
    try { trades = await fetchers.activity(w.wallet); }
    catch (e) { console.error(`  (activity fetch failed for ${w.wallet}: ${e.message})`); continue; }
    for (const t of trades) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      // eslint-disable-next-line no-await-in-loop
      const ev = await evaluateSignal(t, fetchers.state, fetchers.ask);
      if (!ev.follow) continue;

      const prof = profileByWallet.get(t.wallet) || { overall: { n: 0, edgePerBet: 0, variance: 0, medianSize: 0 }, cats: {} };
      const sc = scoreFromProfile({
        profile: prof.overall,
        categoryProfile: prof.cats?.[ev.market.category] || null,
        signal: { size: t.size, marketLiquidity: ev.market.liquidity,
          entryVsWhalePrice: Math.max(0, ev.ask - t.price), category: ev.market.category },
      });
      if (sc.score < CONFIG.MIN_SCORE) continue;        // too weak — skip

      const surge = surgeTracker.add({ marketId: t.conditionId, outcomeIndex: t.outcomeIndex, wallet: t.wallet });
      await notify(formatAlert(t, ev, sc, surge));
      if (paperBook) {
        paperBook.open({ id: t.id, wallet: t.wallet, marketId: t.conditionId,
          question: ev.market.question, side: `outcome[${t.outcomeIndex}]`, outcomeIndex: t.outcomeIndex,
          entry: ev.maxEntry, resolveTime: ev.market.endDate });
        console.log('   📝 paper position opened');
      }
      alerts++;
    }
  }
  saveSeen(seen);
  return alerts;
}

// ---- demo wiring: synthetic wallet + injected fresh whale buy, no network ----
function demoFetchers() {
  const future = Date.now() + 48 * 3600e3;
  return {
    activity: async () => ([{
      id: `demo-${Date.now()}`, wallet: '0xDEMOwhale000000', conditionId: '0xDEMOmarket',
      title: 'Will X happen by Q4?', outcomeIndex: 0, side: 'BUY', price: 0.41, size: 5200, time: Date.now(),
    }]),
    state: async () => ({ conditionId: '0xDEMOmarket', question: 'Will X happen by Q4 2026?',
      category: 'politics', open: true, endDate: future, liquidity: 48000, tokenIds: ['tokenYES', 'tokenNO'] }),
    ask: async () => 0.42, // within the 41¢ + 3¢ cap → actionable
  };
}

// demo profile: a proven politics specialist so the score clears the threshold
const DEMO_PROFILE = {
  overall: { n: 1300, edgePerBet: 0.065, variance: 230, medianSize: 1500 },
  cats: { politics: { n: 800, edgePerBet: 0.075, variance: 130, medianSize: 1800 } },
};

// ---- main ----
if (!DEMO && !existsSync(VALID_PATH)) {
  console.error(`No ${VALID_PATH}. Run: node run.mjs  first (it produces the validated wallets).`);
  process.exit(1);
}
const meta = DEMO
  ? { safeToFollow: true, wallets: [{ wallet: '0xDEMOwhale000000', n: 1200, z: 4.1, edgePerBet: 0.04, profile: DEMO_PROFILE }] }
  : JSON.parse(readFileSync(VALID_PATH));

if (!meta.safeToFollow || !meta.wallets?.length) {
  console.error('⛔ validated-wallets.json says the evidence does NOT support following. Not watching.');
  console.error('   (No statistically-validated, persistent, backtest-positive wallets.) This is the system working.');
  process.exit(1);
}

// wallet → scoring profile, + surge tracker for converging validated wallets
const profileByWallet = new Map(meta.wallets.map((w) => [w.wallet, w.profile || { overall: { n: 0, edgePerBet: 0, variance: 0, medianSize: 0 }, cats: {} }]));
const surgeTracker = new SurgeTracker({ windowMs: CONFIG.SURGE_WINDOW_MS, minWallets: CONFIG.SURGE_MIN_WALLETS });

const fetchers = DEMO
  ? demoFetchers()
  : { activity: getWalletActivity, state: getMarketState, ask: getTokenBestAsk };
const seen = DEMO ? new Set() : loadSeen();

const channels = configuredChannels();
console.log(`Watching ${meta.wallets.length} validated wallet(s)${DEMO ? ' [DEMO]' : ''}, polling every ${CONFIG.POLL_MS/1000}s.`);
console.log(channels.length ? `Alerts → console + ${channels.join(' + ')}.` : 'Alerts → console (set TELEGRAM_BOT_TOKEN/CHAT_ID or DISCORD_WEBHOOK_URL for push).');

const tick = async () => {
  const n = await pollOnce(meta.wallets, seen, fetchers);
  if (DEMO) console.log(`\nDemo poll complete: ${n} actionable signal(s) fired above.`);
};

if (ONCE) { await tick(); }
else { await tick(); setInterval(tick, CONFIG.POLL_MS); }
