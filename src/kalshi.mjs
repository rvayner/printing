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

// Open markets, normalized. Excludes multi-leg parlays (MVE) — plain binaries only.
export async function getKalshiMarkets({ limit = 2000, maxPages = 4 } = {}) {
  const out = [];
  let cursor = '', pages = 0;
  while (out.length < limit && pages++ < maxPages) {
    // eslint-disable-next-line no-await-in-loop
    const d = await kj(`/markets?limit=1000&status=open${cursor ? `&cursor=${cursor}` : ''}`);
    for (const m of d.markets || []) {
      if (/mve|multi/i.test(m.market_type || '')) continue; // skip explicit multi-leg
      const yesAsk = parseFloat(m.yes_ask_dollars), yesBid = parseFloat(m.yes_bid_dollars);
      if (!(yesAsk > 0 && yesBid > 0)) continue;             // require an active two-sided quote
      const yes = (yesAsk + yesBid) / 2;
      if (!(yes > 0 && yes < 1)) continue;
      const favSide = yes >= 0.5 ? 'yes' : 'no';
      out.push({
        venue: 'kalshi', ticker: m.ticker, title: m.title,
        yes, favSide, favPrice: Math.max(yes, 1 - yes),
        favEntry: favSide === 'yes' ? yesAsk : parseFloat(m.no_ask_dollars),
        volume: parseFloat(m.volume_fp || 0), liquidity: parseFloat(m.liquidity_dollars || 0),
        closeTime: m.close_time ? Date.parse(m.close_time) : null,
      });
    }
    cursor = d.cursor;
    if (!cursor || !d.markets?.length) break;
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
