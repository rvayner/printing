// executor.mjs — the auto-trader, built SAFELY. Turns the proven favorites edge into
// exact limit orders with full risk management (Kelly size + diversification caps).
//
// DRY-RUN by default: only PRINTS the orders it would place. Real execution requires
// (a) --live, (b) --i-understand-the-risk, (c) POLYMARKET_PRIVATE_KEY, AND the CLOB
// client wired in placeOrder(). Deliberately gated so it can NEVER trade real money by
// accident. There is NO "100% certain" — it trades the proven EDGE with strict limits.
//
// Run:  node executor.mjs                 # dry run — see the orders
//       node --env-file=.env executor.mjs --live --i-understand-the-risk   # (after wiring CLOB)

import { CONFIG } from './config.mjs';
import { getActiveMarkets, categorize } from './src/polymarket.mjs';
import { kellyStake } from './src/sizing.mjs';
import { diversify } from './src/diversify.mjs';

const has = (k) => process.argv.includes(`--${k}`);
const LIVE = has('live') && has('i-understand-the-risk');
const LO = 0.65, HI = 0.85, SLIP = CONFIG.MAX_ENTRY_SLIPPAGE;
const HIGH_FREQ = /up or down|\b\d{1,2}(:\d{2})?\s?(am|pm)\b|hourly|every hour|\b(5|10|15)[- ]?min/i;
const calibWinRate = (p) => { let w = p; for (const [lo, x] of [[0.60, 0.70], [0.65, 0.76], [0.70, 0.84], [0.75, 0.89], [0.80, 0.92], [0.85, 0.96]]) if (p >= lo) w = x; return w; };

console.log(`${LIVE ? '🔴 LIVE MODE — REAL ORDERS' : '🟡 DRY-RUN (no real orders)'}\nScanning favorites…`);
const markets = await getActiveMarkets({ limit: 800 });
const picks = [];
for (const m of markets) {
  if (m.favPrice < LO || m.favPrice > HI || m.liquidity < CONFIG.MIN_LIQUIDITY || HIGH_FREQ.test(m.question || '')) continue;
  const entry = Math.min(0.98, m.favPrice + SLIP);
  const edge = calibWinRate(m.favPrice) - entry;
  if (edge <= 0) continue;
  const size = kellyStake({ bankroll: CONFIG.BANKROLL, price: entry, edgeLo: edge, liquidity: m.liquidity });
  picks.push({ ...m, category: categorize(m.question), entry, edge, size });
}
picks.sort((a, b) => b.edge - a.edge);
const { selected, deployed } = diversify(picks);

console.log(`\n${selected.length} risk-checked orders (deploy $${deployed.toFixed(0)}/${CONFIG.BANKROLL}, ≤1/event, ≤30%/category):\n`);
let placed = 0;
for (const p of selected) {
  const shares = Math.floor(p.stake / p.entry);
  if (shares < 1) continue;
  console.log(`  LIMIT BUY ${shares} × "${(p.favName || '').slice(0, 20)}" @ ≤${(p.entry * 100).toFixed(0)}¢ = $${(shares * p.entry).toFixed(0)}  [${p.category}] — ${(p.question || '').slice(0, 44)}`);
  if (LIVE) { await placeOrder(p, shares); placed++; }
}
console.log(LIVE ? `\n🔴 placed ${placed} live orders.` : `\n🟡 dry run — 0 real orders. Re-run with --live --i-understand-the-risk (after wiring CLOB + credentials) to trade.`);

// ─────────────────────────────────────────────────────────────────────────────
// REAL EXECUTION — wire this ONLY after paper-trading proves the live edge.
// Needs: funded Polymarket account, POLYMARKET_PRIVATE_KEY, @polymarket/clob-client.
async function placeOrder(p, shares) {
  if (!process.env.POLYMARKET_PRIVATE_KEY) throw new Error('No POLYMARKET_PRIVATE_KEY — refusing to place real orders.');
  // import { ClobClient, Side } from '@polymarket/clob-client';
  // const client = new ClobClient(HOST, 137, wallet, creds);
  // const order = await client.createOrder({ tokenID: p.tokenIds[p.favIndex],
  //   price: p.entry, side: Side.BUY, size: shares });
  // return client.postOrder(order);
  throw new Error('Live execution not wired yet — plug in @polymarket/clob-client in placeOrder(). Paper-prove first.');
}
