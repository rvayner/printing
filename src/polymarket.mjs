// polymarket.mjs — pull real wallet-level trade history from Polymarket's free
// public APIs and normalize it into the `bet` shape the skill gates consume.
//
// Polymarket is on-chain, so every trade carries the trader's proxyWallet — this
// is the ONLY venue where individual-trader following is possible (Kalshi is
// anonymous). Needs live network access to Polymarket; in a sandbox use simulate.mjs.
//
// Endpoints (all free, no key):
//   Gamma   https://gamma-api.polymarket.com/markets   — market metadata + resolution
//   Data    https://data-api.polymarket.com/trades     — trades w/ proxyWallet

const GAMMA = 'https://gamma-api.polymarket.com';
const DATA = 'https://data-api.polymarket.com';

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

// Resolved markets since a date. Prefer slower-resolving markets (politics, macro)
// over fast crypto — that's where a follower's entry can still beat the price.
export async function getResolvedMarkets({ sinceISO, limit = 500 } = {}) {
  const params = new URLSearchParams({
    closed: 'true', limit: String(limit), order: 'endDate', ascending: 'false',
  });
  if (sinceISO) params.set('end_date_min', sinceISO);
  const markets = await getJson(`${GAMMA}/markets?${params}`);
  return markets
    .filter((m) => m.conditionId && Array.isArray(m.outcomePrices))
    .map((m) => {
      // winning outcome index: the resolved price closest to 1
      const prices = m.outcomePrices.map(Number);
      const winIdx = prices.indexOf(Math.max(...prices));
      return {
        conditionId: m.conditionId,
        question: m.question,
        endDate: m.endDate,
        category: m.category || 'other',
        tokenIds: JSON.parse(m.clobTokenIds || '[]'),
        winningTokenIndex: winIdx,         // 0 or 1 (Yes/No order from `outcomes`)
        liquidity: Number(m.liquidity || 0),
      };
    });
}

// All trades in a market, with the trader wallet on each.
export async function getMarketTrades(conditionId, { limit = 1000 } = {}) {
  const trades = await getJson(`${DATA}/trades?market=${conditionId}&limit=${limit}`);
  return trades.map((t) => ({
    wallet: t.proxyWallet,
    tokenIndex: t.outcomeIndex,           // which side they traded (0/1)
    side: t.side,                         // BUY / SELL
    price: Number(t.price),               // price of that token, 0..1
    size: Number(t.size),
    time: Number(t.timestamp) * 1000,
  }));
}

// Normalize raw trades for a resolved market into per-wallet `bet`s.
// We only model BUYs (opening a position); a BUY of the winning token → won=1.
export function toBets(trades, market) {
  const out = [];
  for (const t of trades) {
    if (t.side !== 'BUY') continue;       // opening exposure; SELLs are exits/MM
    const won = t.tokenIndex === market.winningTokenIndex ? 1 : 0;
    out.push({
      wallet: t.wallet,
      marketId: market.conditionId,
      time: t.time,
      cost: t.price,                      // their implied prob = price paid
      won,
      size: t.size,
      category: market.category,
    });
  }
  return out;
}

const CLOB = 'https://clob.polymarket.com';

// A wallet's most recent trades (live) — used by the real-time watcher.
export async function getWalletActivity(wallet, { limit = 50 } = {}) {
  const items = await getJson(`${DATA}/activity?user=${wallet}&type=TRADE&limit=${limit}`);
  return items.map((a) => ({
    id: a.transactionHash || `${a.market}-${a.timestamp}`,
    wallet,
    conditionId: a.market || a.conditionId,
    title: a.title,
    outcomeIndex: a.outcomeIndex,
    side: a.side,                          // BUY / SELL
    price: Number(a.price),
    size: Number(a.size),
    time: Number(a.timestamp) * 1000,
  }));
}

// Live market state — is it still open, liquid, and far enough from expiry?
export async function getMarketState(conditionId) {
  const arr = await getJson(`${GAMMA}/markets?condition_ids=${conditionId}`);
  const m = Array.isArray(arr) ? arr[0] : arr;
  if (!m) return null;
  return {
    conditionId,
    question: m.question,
    category: m.category || 'other',
    open: m.active === true && m.closed !== true,
    endDate: m.endDate ? Date.parse(m.endDate) : null,
    liquidity: Number(m.liquidity || m.liquidityNum || 0),
    tokenIds: JSON.parse(m.clobTokenIds || '[]'),
  };
}

// Resolution of a (possibly settled) market: winning outcome index, or null if
// not resolved yet. Used by paper-reconcile to close paper positions.
export async function getMarketResolution(conditionId) {
  const arr = await getJson(`${GAMMA}/markets?condition_ids=${conditionId}`);
  const m = Array.isArray(arr) ? arr[0] : arr;
  if (!m || m.closed !== true || !Array.isArray(m.outcomePrices)) return null;
  const prices = m.outcomePrices.map(Number);
  return prices.indexOf(Math.max(...prices));   // 0/1 winning index
}

// Live best ask for a specific token — confirms you can still enter near the
// whale's price (if the ask already blew past your cap, the edge is gone).
export async function getTokenBestAsk(tokenId) {
  try {
    const book = await getJson(`${CLOB}/book?token_id=${tokenId}`);
    const asks = (book.asks || []).map((a) => Number(a.price)).filter((x) => x > 0);
    return asks.length ? Math.min(...asks) : null;
  } catch { return null; }
}

// High-level: build the wallet→bets map across many resolved markets.
export async function buildWalletBets({ sinceISO, marketLimit = 300, throttleMs = 250 } = {}) {
  const markets = await getResolvedMarkets({ sinceISO, limit: marketLimit });
  const walletBets = new Map();
  for (const m of markets) {
    let trades;
    try { trades = await getMarketTrades(m.conditionId); }
    catch { continue; }
    for (const bet of toBets(trades, m)) {
      const arr = walletBets.get(bet.wallet) ?? [];
      arr.push(bet);
      walletBets.set(bet.wallet, arr);
    }
    await new Promise((r) => setTimeout(r, throttleMs));
  }
  return walletBets;
}
