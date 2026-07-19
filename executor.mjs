// executor.mjs — the auto-trader, built SAFELY. Turns the proven favorites edge into
// exact limit orders with full risk management (Kelly size + diversification caps +
// winnability weighting), and HARD-ENFORCES the EXEC_MAX_* safety caps.
//
// DRY-RUN by default: only PRINTS the orders it would place. Real execution requires
// (a) --live, (b) --i-understand-the-risk, (c) POLYMARKET_PRIVATE_KEY, AND the CLOB
// client wired in placeOrder(). Deliberately gated so it can NEVER trade real money by
// accident. There is NO "100% certain" — it trades the proven EDGE with strict limits,
// ONLY the winnable real-world categories, and never exceeds the hard caps.
//
// Run:  node executor.mjs                 # dry run — see the orders
//       node --env-file=.env executor.mjs --live --i-understand-the-risk   # (after wiring CLOB)

import { CONFIG } from './config.mjs';
import { getActiveMarkets } from './src/polymarket.mjs';
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
  if (m.favPrice < LO || m.favPrice > HI) continue;
  if (m.liquidity < CONFIG.FAV_MIN_LIQUIDITY) continue;              // real depth only ($10k), same as favorites-scan
  if (CONFIG.FAV_EXCLUDE.includes(m.category)) continue;            // winnable real-world only — no weather/sports/crypto
  if (HIGH_FREQ.test(m.question || '')) continue;
  const entry = Math.min(0.98, m.favPrice + SLIP);
  const edge = calibWinRate(m.favPrice) - entry;
  if (edge <= 0) continue;
  const size = kellyStake({ bankroll: CONFIG.BANKROLL, price: entry, edgeLo: edge, liquidity: m.liquidity });
  const qWeight = CONFIG.FAV_CATEGORY_RANK[m.category] ?? 1.0;      // bias to winnable categories
  picks.push({ ...m, entry, edge, size, qWeight, rank: edge * qWeight });
}
picks.sort((a, b) => b.rank - a.rank);
const { selected, deployed } = diversify(picks);

console.log(`\n${selected.length} risk-checked candidates (deploy $${deployed.toFixed(0)}/${CONFIG.BANKROLL}, ≤1/event, ≤30%/category).`);
console.log(`HARD CAPS: ≤$${CONFIG.EXEC_MAX_ORDER_USD}/order · ≤$${CONFIG.EXEC_MAX_TOTAL_USD} total · ≤${CONFIG.EXEC_MAX_ORDERS} orders.\n`);

let placed = 0, spent = 0;
for (const p of selected) {
  if (placed >= CONFIG.EXEC_MAX_ORDERS) { console.log(`  (order cap ${CONFIG.EXEC_MAX_ORDERS} reached — stopping)`); break; }
  // ENFORCE the hard caps: clamp this order's $ to EXEC_MAX_ORDER_USD and to the
  // remaining total budget. This is the safety net the old executor was missing.
  const orderUsd = Math.min(p.stake, CONFIG.EXEC_MAX_ORDER_USD, CONFIG.EXEC_MAX_TOTAL_USD - spent);
  if (orderUsd < 1) { console.log(`  (total cap $${CONFIG.EXEC_MAX_TOTAL_USD} reached — stopping)`); break; }
  const shares = Math.floor(orderUsd / p.entry);
  if (shares < 1) continue;
  const usd = shares * p.entry;
  spent += usd; placed++;
  console.log(`  LIMIT BUY ${shares} × "${(p.favName || '').slice(0, 20)}" @ ≤${(p.entry * 100).toFixed(0)}¢ = $${usd.toFixed(0)}  [${p.category}] — ${(p.question || '').slice(0, 42)}`);
  if (LIVE) await placeOrder(p, shares);
}
console.log(LIVE
  ? `\n🔴 placed ${placed} live orders, $${spent.toFixed(0)} deployed (within caps).`
  : `\n🟡 dry run — 0 real orders, would deploy $${spent.toFixed(0)} across ${placed} orders (all within caps).\n   Re-run with --live --i-understand-the-risk (after wiring CLOB + credentials) to trade.`);

// ─────────────────────────────────────────────────────────────────────────────
// REAL EXECUTION — wire this ONLY after paper-trading proves the live edge
// (monitor.mjs at n≥30, calibration z holding). Needs: funded Polymarket account,
// POLYMARKET_PRIVATE_KEY, @polymarket/clob-client.
async function placeOrder(p, shares) {
  if (!process.env.POLYMARKET_PRIVATE_KEY) throw new Error('No POLYMARKET_PRIVATE_KEY — refusing to place real orders.');
  // import { ClobClient, Side } from '@polymarket/clob-client';
  // const client = new ClobClient(HOST, 137, wallet, creds);
  // const order = await client.createOrder({ tokenID: p.tokenIds[p.favIndex],
  //   price: p.entry, side: Side.BUY, size: shares });
  // return client.postOrder(order);
  throw new Error('Live execution not wired yet — plug in @polymarket/clob-client in placeOrder(). Paper-prove first.');
}
