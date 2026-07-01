// clob.mjs — Polymarket order execution, built for MAXIMUM safety. The risky part
// (signing + posting a real order) is isolated in postOrder(). Everything else —
// reading the live book, simulating the exact fill, pre-flight safety checks — is
// read-only and fully testable with ZERO money at risk. simulateBuy() against the
// REAL live orderbook is the proof that your limit order would actually fill.

import { CONFIG } from '../config.mjs';

const CLOB = 'https://clob.polymarket.com';

async function getJson(url) {
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

// live orderbook for a token (read-only, no auth, no risk)
export async function getOrderBook(tokenId) {
  const b = await getJson(`${CLOB}/book?token_id=${tokenId}`);
  return {
    bids: (b.bids || []).map((x) => ({ price: +x.price, size: +x.size })),
    asks: (b.asks || []).map((x) => ({ price: +x.price, size: +x.size })),
  };
}

// simulate a BUY against the real asks: how many shares fill at ≤ limitPrice for
// up to stakeUsd. Proves the order is executable BEFORE any money moves.
export function simulateBuy(asks, limitPrice, stakeUsd) {
  const sorted = [...asks].sort((a, b) => a.price - b.price);  // cheapest first
  let shares = 0, cost = 0;
  for (const a of sorted) {
    if (a.price > limitPrice) break;
    const canBuy = Math.min(a.size, (stakeUsd - cost) / a.price);
    if (canBuy <= 1e-9) break;
    shares += canBuy; cost += canBuy * a.price;
    if (cost >= stakeUsd - 1e-6) break;
  }
  const liqAtPrice = sorted.filter((a) => a.price <= limitPrice).reduce((s, a) => s + a.size * a.price, 0);
  return { shares, cost, avgPrice: shares ? cost / shares : null, filled: cost >= stakeUsd * 0.98, liqAtPrice };
}

// hard safety pre-flight — refuses anything outside strict caps
export function preflight(order, sim, { totalDeployedUsd = 0 } = {}) {
  const errs = [];
  if (order.stakeUsd > CONFIG.EXEC_MAX_ORDER_USD) errs.push(`order $${order.stakeUsd} > max $${CONFIG.EXEC_MAX_ORDER_USD}`);
  if (totalDeployedUsd + order.stakeUsd > CONFIG.EXEC_MAX_TOTAL_USD) errs.push(`total would exceed $${CONFIG.EXEC_MAX_TOTAL_USD}`);
  if (order.limitPrice <= 0 || order.limitPrice >= 1) errs.push('limit price out of range');
  if (!sim.filled) errs.push(`insufficient liquidity — only $${sim.cost.toFixed(0)} fills at ≤${(order.limitPrice * 100).toFixed(0)}¢`);
  if (sim.avgPrice && sim.avgPrice > order.limitPrice + 1e-6) errs.push('avg fill above limit');
  return { ok: errs.length === 0, errs };
}

// Execute. dry → returns the simulated fill (no order). live → preflight then post.
export async function execute(order, { live = false, totalDeployedUsd = 0 } = {}) {
  const book = await getOrderBook(order.tokenId);
  const sim = simulateBuy(book.asks, order.limitPrice, order.stakeUsd);
  const pf = preflight(order, sim, { totalDeployedUsd });
  if (!live) return { mode: 'dry', sim, preflight: pf };
  if (!pf.ok) return { mode: 'blocked', sim, preflight: pf };
  const receipt = await postOrder(order, sim);
  return { mode: 'live', sim, preflight: pf, receipt };
}

// ─── THE ONLY PART THAT SPENDS REAL MONEY — wire after paper-proving ───
// Needs: funded account, POLYMARKET_PRIVATE_KEY, `npm i @polymarket/clob-client`.
async function postOrder(order, sim) {
  if (!process.env.POLYMARKET_PRIVATE_KEY) throw new Error('No POLYMARKET_PRIVATE_KEY — refusing to post real orders.');
  // const { ClobClient, Side } = await import('@polymarket/clob-client');
  // const { Wallet } = await import('ethers');
  // const wallet = new Wallet(process.env.POLYMARKET_PRIVATE_KEY);
  // const client = new ClobClient('https://clob.polymarket.com', 137, wallet);
  // const creds = await client.createOrDeriveApiKey();  client.setApiCreds(creds);
  // const signed = await client.createOrder({ tokenID: order.tokenId, price: order.limitPrice,
  //   side: Side.BUY, size: Math.floor(sim.shares) });
  // return client.postOrder(signed);  // GTC limit — fills at ≤ your price or rests
  throw new Error('Live posting not wired. Install @polymarket/clob-client and enable the block above AFTER paper-proving.');
}
