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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Resilient GET: retries on 429 / 5xx with exponential backoff so a long bulk
// pull survives transient rate limits and network blips.
async function getJson(url, { retries = 4 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (res.status === 429 || res.status >= 500) throw new Error(`status ${res.status}`);
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return await res.json();
    } catch (e) {
      if (attempt >= retries) throw e;
      await sleep(400 * 2 ** attempt);   // 0.4s, 0.8s, 1.6s, 3.2s
    }
  }
}

// Run async `fn` over `items` with bounded concurrency + progress callback.
async function mapLimit(items, limit, fn, onProgress) {
  let i = 0, done = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { await fn(items[idx], idx); } catch { /* skip one failure */ }
      if (onProgress) onProgress(++done, items.length);
    }
  });
  await Promise.all(workers);
}

// Resolved markets since a date. Prefer slower-resolving markets (politics, macro)
// over fast crypto — that's where a follower's entry can still beat the price.
export async function getResolvedMarkets({ sinceISO, limit = 500 } = {}) {
  const out = [];
  const PAGE = 100;   // Gamma caps page size at 100 regardless of `limit`
  for (let offset = 0; out.length < limit; offset += PAGE) {
    const params = new URLSearchParams({
      closed: 'true', limit: String(PAGE), offset: String(offset), order: 'endDate', ascending: 'false',
    });
    if (sinceISO) params.set('end_date_min', sinceISO);
    let markets;
    try {
      // eslint-disable-next-line no-await-in-loop
      markets = await getJson(`${GAMMA}/markets?${params}`);
    } catch { break; }                 // 422 = hit Gamma's max pagination depth → stop
    if (!markets.length) break;
    pushResolved(markets, out);
    if (markets.length < PAGE) break;
  }
  return out.slice(0, limit);
}

// High-frequency crypto / hourly markets — HFT-bot noise, not informed events.
const HIGH_FREQ = /up or down|\b\d{1,2}(:\d{2})?\s?(am|pm)\b|hourly|every hour|\b(5|10|15)[- ]?min/i;

// Gamma rarely populates `category`, so derive a real one from the question for
// meaningful diversification (correlated bets cluster by topic).
export function categorize(q = '') {
  const s = q.toLowerCase();
  if (/bitcoin|btc|ethereum|\beth\b|crypto|solana|\bsol\b|token|tvl|fdv|aave|defi|stablecoin|airdrop/.test(s)) return 'crypto';
  if (/senate|president|election|nominee|governor|congress|democrat|republican|primary|parliament|prime minister|mayor|vote/.test(s)) return 'politics';
  if (/russia|ukraine|israel|gaza|\bwar\b|capture|ceasefire|nuclear|invade|hostage|troops/.test(s)) return 'geopolitics';
  if (/inflation|\bgdp\b|interest rate|\bfed\b|unemployment|recession|market cap|price.*between|rate cut/.test(s)) return 'econ';
  // Sports LAST, so "Trump win the election" stays political. Dated head-to-head
  // markets — "Will X win on YYYY-MM-DD", "Exact Score: A 3 - 3 B", "X vs Y" — are
  // how Polymarket lists tournament games; they were leaking through as 'other'
  // and polluting the real-world whale signal. NOTE: don't use a bare "\d - \d"
  // score pattern — it collides with ISO dates (2026-07-06). Anchor on literals.
  if (/spread:|handicap|\([-+]\d+(\.\d+)?\)|both teams|to score|corners|reg time|advances|\bfc\b|\bfk\b| vs\.? | o\/u |over|under|goals|wins|match|league|\bcup\b|tournament|nba|\bnfl\b|mlb|nhl|wimbledon|tennis|soccer|football|baseball|series|exact score|win on \d{4}-\d{2}-\d{2}|draw on \d{4}-\d{2}-\d{2}|beat .* on \d{4}-\d{2}-\d{2}/.test(s)) return 'sports';
  return 'other';
}

// Currently OPEN markets with their favorite (highest-priced) outcome — for the
// live favorites scanner. Ranked by volume so the liquid ones come first.
export async function getActiveMarkets({ limit = 800 } = {}) {
  const out = [];
  const PAGE = 100;
  for (let offset = 0; out.length < limit; offset += PAGE) {
    const params = new URLSearchParams({
      active: 'true', closed: 'false', limit: String(PAGE), offset: String(offset),
      order: 'volume', ascending: 'false',
    });
    let ms;
    try { ms = await getJson(`${GAMMA}/markets?${params}`); } catch { break; }
    if (!ms.length) break;
    for (const m of ms) {
      if (!m.conditionId) continue;
      let prices = [], outcomes = [];
      try { prices = JSON.parse(m.outcomePrices || '[]').map(Number); } catch { continue; }
      try { outcomes = JSON.parse(m.outcomes || '[]'); } catch { /* ignore */ }
      if (prices.length < 2) continue;
      const favIndex = prices.indexOf(Math.max(...prices));
      out.push({
        conditionId: m.conditionId, question: m.question, category: categorize(m.question),
        // Group by the underlying GAME, not the prop — Polymarket splits one match
        // into many "events" (corners/totals/goals), which slips past ≤1-per-event
        // and stacks correlated bets on a single game. Collapse to the dated prefix.
        eventSlug: (() => {
          const raw = m.eventSlug || (Array.isArray(m.events) && m.events[0]?.slug) || m.conditionId;
          const g = String(raw).match(/^(.*?\d{4}-\d{2}-\d{2})/);   // e.g. fifwc-mex-eng-2026-07-05
          return g ? g[1] : raw;
        })(),
        favIndex, favPrice: prices[favIndex], favName: outcomes[favIndex] || `outcome[${favIndex}]`,
        liquidity: Number(m.liquidity || m.liquidityNum || 0),
        endDate: m.endDate ? Date.parse(m.endDate) : null,
        tokenIds: (() => { try { return JSON.parse(m.clobTokenIds || '[]'); } catch { return []; } })(),
      });
    }
    if (ms.length < PAGE) break;
  }
  return out.slice(0, limit);
}

function pushResolved(markets, out) {
  for (const m of markets) {
    if (!m.conditionId) continue;
    if (HIGH_FREQ.test(m.question || '')) continue;   // skip 15-min crypto churn
    let prices = [];
    try { prices = JSON.parse(m.outcomePrices || '[]').map(Number); } catch { /* not resolved */ }
    if (prices.length < 2 || !prices.some((p) => p >= 0.99)) continue;  // must be resolved
    out.push({
      conditionId: m.conditionId,
      question: m.question,
      endDate: m.endDate,
      category: m.category || 'other',
      tokenIds: (() => { try { return JSON.parse(m.clobTokenIds || '[]'); } catch { return []; } })(),
      winningTokenIndex: prices.indexOf(Math.max(...prices)),  // 0 or 1
      liquidity: Number(m.liquidity || 0),
    });
  }
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
      outcomeIndex: t.tokenIndex,         // which side — needed to detect consensus
      time: t.time,
      cost: t.price,                      // their implied prob = price paid
      won,
      size: t.size,
      title: market.question,             // to categorize (sports vs political/event)
      category: market.category,
      resolvedAt: market.endDate ? Date.parse(market.endDate) : t.time,  // recency
    });
  }
  return out;
}

const CLOB = 'https://clob.polymarket.com';

// Recent GLOBAL trades (live) — for detecting big informed bets in real time.
export async function getRecentTrades({ limit = 500 } = {}) {
  const rows = await getJson(`${DATA}/trades?limit=${limit}`);
  return rows.map((t) => ({
    id: t.transactionHash || `${t.conditionId}-${t.timestamp}`,
    wallet: t.proxyWallet,
    conditionId: t.conditionId,
    outcomeIndex: t.outcomeIndex,
    side: t.side,
    price: Number(t.price),
    size: Number(t.size),
    notional: Number(t.size) * Number(t.price),
    title: t.title,
    outcome: t.outcome,
    time: Number(t.timestamp) * 1000,
  }));
}

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
    // createdAt / startDate let us reject freshly-listed markets whose prices
    // haven't settled yet (a "big bet" on a 2-hour-old book is noise, not signal).
    createdAt: m.createdAt ? Date.parse(m.createdAt) : (m.startDate ? Date.parse(m.startDate) : null),
    liquidity: Number(m.liquidity || m.liquidityNum || 0),
    volume: Number(m.volume || m.volumeNum || 0),
    tokenIds: JSON.parse(m.clobTokenIds || '[]'),
  };
}

// Resolution of a (possibly settled) market: winning outcome index, or null if
// not resolved yet. Used by paper-reconcile to close paper positions.
export async function getMarketResolution(conditionId) {
  // MUST include closed=true — Gamma's default condition_ids query returns only
  // OPEN markets, so a market vanishes from it the moment it resolves (the exact
  // moment we need to settle it).
  const arr = await getJson(`${GAMMA}/markets?closed=true&condition_ids=${conditionId}`);
  const m = Array.isArray(arr) ? arr[0] : arr;
  if (!m || m.closed !== true) return null;
  let prices = [];
  try { prices = JSON.parse(m.outcomePrices || '[]').map(Number); } catch { return null; }
  if (prices.length < 2 || !prices.some((p) => p >= 0.99)) return null;
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

// Resolved-market info (winning side + category), cached across wallets.
const _marketInfo = new Map();
export async function getMarketInfo(conditionId) {
  if (_marketInfo.has(conditionId)) return _marketInfo.get(conditionId);
  let info = null;
  try {
    const arr = await getJson(`${GAMMA}/markets?condition_ids=${conditionId}`);
    const m = Array.isArray(arr) ? arr[0] : arr;
    if (m && m.closed === true) {
      let prices = [];
      try { prices = JSON.parse(m.outcomePrices || '[]').map(Number); } catch { /* unresolved */ }
      if (prices.length >= 2 && prices.some((p) => p >= 0.99)) {
        info = { winningIndex: prices.indexOf(Math.max(...prices)), category: m.category || 'other' };
      }
    }
  } catch { /* ignore */ }
  _marketInfo.set(conditionId, info);
  return info;
}

// WALLET-CENTRIC pull: discover active wallets, then fetch each one's COMPLETE
// trade history → full track records (the market-centric pull only saw partial
// histories). This is what makes a conclusive walk-forward possible.
export async function buildWalletBetsDeep({ marketLimit = 150, maxWallets = 80, activityLimit = 500, throttleMs = 60 } = {}) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // 1) discover active wallets via a quick market-centric pass
  console.log(`Discovering active wallets from ${marketLimit} markets…`);
  const shallow = await buildWalletBets({ marketLimit, throttleMs });
  const candidates = [...shallow.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, maxWallets).map(([w]) => w);
  console.log(`Enriching ${candidates.length} wallets with full trade history…`);

  // 2) pull each candidate's complete history and resolve every market
  const out = new Map();
  let done = 0;
  for (const wallet of candidates) {
    let acts;
    try { acts = await getWalletActivity(wallet, { limit: activityLimit }); }
    catch { continue; }
    const bets = [];
    for (const a of acts) {
      if (a.side !== 'BUY') continue;
      // eslint-disable-next-line no-await-in-loop
      const info = await getMarketInfo(a.conditionId);
      if (!info) continue;                                  // unresolved → skip
      bets.push({ wallet, marketId: a.conditionId, time: a.time, cost: a.price,
        won: a.outcomeIndex === info.winningIndex ? 1 : 0, size: a.size, category: info.category });
    }
    if (bets.length) out.set(wallet, bets);
    if (++done % 10 === 0) console.log(`  …${done}/${candidates.length} wallets`);
    await sleep(throttleMs);
  }
  return out;
}

// High-level: build the wallet→bets map across many resolved markets.
export async function buildWalletBets({ sinceISO, marketLimit = 300, concurrency = 6 } = {}) {
  const t0 = Date.now();
  console.log(`Fetching resolved markets (up to ${marketLimit})…`);
  const markets = await getResolvedMarkets({ sinceISO, limit: marketLimit });
  console.log(`  ${markets.length} resolved markets — pulling trades (${concurrency}-way concurrent)…`);

  const walletBets = new Map();
  await mapLimit(markets, concurrency, async (m) => {
    const trades = await getMarketTrades(m.conditionId).catch(() => []);
    for (const bet of toBets(trades, m)) {
      const arr = walletBets.get(bet.wallet) ?? [];   // sync get→set → safe under concurrency
      arr.push(bet);
      walletBets.set(bet.wallet, arr);
    }
  }, (done, total) => {
    if (done % 100 === 0 || done === total) {
      const elapsed = (Date.now() - t0) / 1000;
      const eta = (total - done) / (done / elapsed || 1);
      console.log(`  …${done}/${total} markets · ${walletBets.size} wallets · ${elapsed.toFixed(0)}s · ~${eta.toFixed(0)}s left`);
    }
  });
  return walletBets;
}
