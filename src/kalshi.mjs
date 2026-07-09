// kalshi.mjs — Kalshi public API client (no auth). Kalshi is CFTC-regulated and
// ANONYMOUS at the trader level (no wallets), so:
//   • FAVORITES edge → works (favorite-longshot bias is universal, documented on Kalshi)
//   • INSIDER edge  → limited (no trader identity / fresh-wallet; Kalshi bans insiders)
// Prices are dollar strings (e.g. "0.22"); sizes/volumes are "_fp" floats.

const BASE = 'https://api.elections.kalshi.com/trade-api/v2';

async function kj(path) {
  const r = await fetch(BASE + path, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  return r.json();
}

// Open markets, normalized. Kalshi's open feed is DOMINATED by zero-quote,
// zero-volume multi-leg (MVE) collections — e.g. an MLB division listed as one
// comma-joined market. Those have no two-sided quote, so a strict yes_ask/yes_bid
// filter returns almost nothing within a few pages. Fix: skip MVE collections
// explicitly, require real trading (volume OR liquidity), and fall back to
// last_price when the book is one-sided, so we surface genuinely tradeable binaries.
export async function getKalshiMarkets({ limit = 2000, maxPages = 8, minVolume = 1 } = {}) {
  const out = [];
  let cursor = '', pages = 0;
  while (out.length < limit && pages++ < maxPages) {
    // eslint-disable-next-line no-await-in-loop
    const d = await kj(`/markets?limit=1000&status=open${cursor ? `&cursor=${cursor}` : ''}`);
    for (const m of d.markets || []) {
      if (/mve|multi/i.test(m.market_type || '') || m.mve_collection_ticker) continue; // skip multi-leg collections
      if ((m.title || '').includes(',')) continue;           // comma-joined = collection, not a binary
      const yesAsk = parseFloat(m.yes_ask_dollars), yesBid = parseFloat(m.yes_bid_dollars);
      const last = parseFloat(m.last_price_dollars);
      const vol = parseFloat(m.volume_fp || 0), liq = parseFloat(m.liquidity_dollars || 0);
      if (vol < minVolume && liq <= 0) continue;             // require it to actually trade
      // mid price: prefer a two-sided quote, else fall back to last traded price
      const yes = (yesAsk > 0 && yesBid > 0) ? (yesAsk + yesBid) / 2 : (last > 0 && last < 1 ? last : null);
      if (!(yes > 0 && yes < 1)) continue;
      const favSide = yes >= 0.5 ? 'yes' : 'no';
      out.push({
        venue: 'kalshi', ticker: m.ticker, title: m.title,
        yes, favSide, favPrice: Math.max(yes, 1 - yes),
        favEntry: favSide === 'yes' ? (yesAsk || last) : (parseFloat(m.no_ask_dollars) || 1 - last),
        volume: vol, liquidity: liq,
        closeTime: m.close_time ? Date.parse(m.close_time) : null,
      });
    }
    cursor = d.cursor;
    if (!cursor || !d.markets?.length) break;
  }
  return out.slice(0, limit);
}

// TARGETED fetch via the EVENTS endpoint — the way past the sports-parlay flood.
// The flat /markets feed is saturated with thousands of zero-volume KXMVESPORTS
// parlays; /events exposes a `category` per event, so we pull only real-world
// categories (Elections/Politics/Financials/World/…) with their nested markets
// and keep the ones that actually trade. Returns the same normalized shape.
const REALWORLD_CATS = new Set([
  'Elections', 'Politics', 'Financials', 'World', 'Economics', 'Science and Technology',
]);
export async function getKalshiRealWorldMarkets({ limit = 1500, maxPages = 8, minVolume = 1,
  categories = REALWORLD_CATS } = {}) {
  const out = [];
  let cursor = '', pages = 0;
  while (out.length < limit && pages++ < maxPages) {
    // eslint-disable-next-line no-await-in-loop
    const d = await kj(`/events?limit=200&status=open&with_nested_markets=true${cursor ? `&cursor=${cursor}` : ''}`);
    for (const e of d.events || []) {
      if (!categories.has(e.category)) continue;             // real-world only, no sports/weather
      for (const m of e.markets || []) {
        if ((m.title || '').includes(',')) continue;         // comma-joined = multi-outcome leg
        const yesAsk = parseFloat(m.yes_ask_dollars), yesBid = parseFloat(m.yes_bid_dollars);
        const last = parseFloat(m.last_price_dollars);
        const vol = parseFloat(m.volume_fp || 0), liq = parseFloat(m.liquidity_dollars || 0);
        if (vol < minVolume && liq <= 0) continue;           // must actually trade
        const yes = (yesAsk > 0 && yesBid > 0) ? (yesAsk + yesBid) / 2 : (last > 0 && last < 1 ? last : null);
        if (!(yes > 0 && yes < 1)) continue;
        const favSide = yes >= 0.5 ? 'yes' : 'no';
        out.push({
          venue: 'kalshi', category: e.category, ticker: m.ticker,
          title: m.title || m.yes_sub_title || e.title,
          yes, favSide, favPrice: Math.max(yes, 1 - yes),
          favEntry: favSide === 'yes' ? (yesAsk || last) : (parseFloat(m.no_ask_dollars) || 1 - last),
          volume: vol, liquidity: liq,
          closeTime: m.close_time ? Date.parse(m.close_time) : (e.close_time ? Date.parse(e.close_time) : null),
        });
      }
    }
    cursor = d.cursor;
    if (!cursor || !d.events?.length) break;
  }
  return out.slice(0, limit);
}

// Recent trades (size + price + taker side + block-trade flag). No trader identity.
export async function getKalshiTrades({ limit = 1000 } = {}) {
  const out = [];
  let cursor = '';
  while (out.length < limit) {
    // eslint-disable-next-line no-await-in-loop
    const d = await kj(`/markets/trades?limit=1000${cursor ? `&cursor=${cursor}` : ''}`);
    for (const t of d.trades || []) {
      out.push({
        venue: 'kalshi', ticker: t.ticker, yes: parseFloat(t.yes_price_dollars),
        size: parseFloat(t.count_fp), takerSide: t.taker_side, isBlock: t.is_block_trade === true,
        notional: parseFloat(t.count_fp) * parseFloat(t.yes_price_dollars),
        time: Date.parse(t.created_time),
      });
    }
    cursor = d.cursor;
    if (!cursor || !d.trades?.length) break;
  }
  return out.slice(0, limit);
}
