// clob-check.mjs — PROVE execution works, with zero money at risk. Takes real
// current favorites, pulls each one's LIVE orderbook, and simulates the exact fill:
// how many shares you'd get, at what average price, whether it fully fills, and
// whether it passes the hard safety pre-flight. This is the "backtest" of execution
// itself — proof your limit orders are real and fillable before you ever go live.
//
// Run: node clob-check.mjs [--top 6]

import { CONFIG } from './config.mjs';
import { getActiveMarkets, categorize } from './src/polymarket.mjs';
import { getOrderBook, simulateBuy, preflight } from './src/clob.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const TOP = arg('top', 6), LO = 0.65, HI = 0.85, SLIP = CONFIG.MAX_ENTRY_SLIPPAGE;
const HIGH_FREQ = /up or down|\b\d{1,2}(:\d{2})?\s?(am|pm)\b|hourly|every hour|\b(5|10|15)[- ]?min/i;

console.log('Fetching favorites + their LIVE orderbooks (read-only, no money at risk)…\n');
const markets = await getActiveMarkets({ limit: 400 });
const picks = markets.filter((m) => m.favPrice >= LO && m.favPrice <= HI && m.liquidity >= CONFIG.MIN_LIQUIDITY && !HIGH_FREQ.test(m.question || '') && m.tokenIds?.[m.favIndex]).slice(0, TOP);

let fillable = 0, deployed = 0;
for (const m of picks) {
  const tokenId = m.tokenIds[m.favIndex];
  const limitPrice = Math.min(0.98, m.favPrice + SLIP);
  const stakeUsd = Math.min(CONFIG.EXEC_MAX_ORDER_USD, 15);
  let book;
  try { book = await getOrderBook(tokenId); }
  catch (e) { console.log(`  ⚠ "${(m.favName || '').slice(0, 18)}" — book fetch failed: ${e.message}`); continue; }
  const sim = simulateBuy(book.asks, limitPrice, stakeUsd);
  const pf = preflight({ stakeUsd, limitPrice, tokenId }, sim, { totalDeployedUsd: deployed });
  const ok = pf.ok && sim.filled;
  if (ok) { fillable++; deployed += sim.cost; }
  console.log(`  ${ok ? '✅' : '🚫'} "${(m.favName || '').slice(0, 18).padEnd(18)}" @≤${(limitPrice * 100).toFixed(0)}¢ — ` +
    `sim fill ${sim.shares.toFixed(0)} sh @ ${sim.avgPrice ? (sim.avgPrice * 100).toFixed(1) + '¢' : 'n/a'}` +
    ` ($${sim.cost.toFixed(0)}/${stakeUsd}) · book liq $${sim.liqAtPrice.toFixed(0)}${pf.ok ? '' : ' · ' + pf.errs.join(', ')}`);
}

console.log(`\n${fillable}/${picks.length} favorites are LIVE-FILLABLE at your limit within safety caps.`);
console.log('This proves the execution path end-to-end against the real orderbook — the only');
console.log('step not exercised is the final signed POST (gated + capped at $' + CONFIG.EXEC_MAX_ORDER_USD + '/order).');
console.log('\nGo-live canary: once wired, place ONE $1 order, confirm the fill, THEN scale. Never skip that.');
