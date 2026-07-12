// slippage-model.mjs — MEASURE, don't guess, follower slippage. For recent big
// bets in the uncertain band, pull the market's own trade history and see what
// price the NEXT buyers on the same side actually paid. That price minus the
// whale's price is the real slippage a follower eats — the microstructure cost
// our fixed 3c assumption is meant to model. Category-agnostic: slippage is a
// function of order size vs market depth, not the topic.
import { getRecentTrades, getMarketState } from './src/polymarket.mjs';

const DATA = 'https://data-api.polymarket.com';
const mapLimit = async (arr, n, fn) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(...await Promise.all(arr.slice(i, i + n).map(fn))); return out; };

async function marketTrades(cid) {
  try {
    const d = await fetch(`${DATA}/trades?market=${cid}&limit=500`, { headers: { accept: 'application/json' } }).then(r => r.json());
    return (Array.isArray(d) ? d : []).map(t => ({ price: +t.price, size: +t.size, side: t.side, oi: t.outcomeIndex, time: +t.timestamp * 1000 }));
  } catch { return []; }
}

const recent = await getRecentTrades({ limit: 1000 });
const cands = recent.filter(t => t.side === 'BUY' && t.notional >= 300 && t.price >= 0.30 && t.price <= 0.72);
console.log(`${cands.length} big-bet candidates (>=$300, 30-72c) to measure follower slippage on…\n`);

const HORIZONS = [[1, 60e3], [5, 300e3], [30, 1800e3]];
const rows = await mapLimit(cands, 5, async (c) => {
  const tr = await marketTrades(c.conditionId);
  const r = { notional: c.notional, whale: c.price, h: {} };
  for (const [label, win] of HORIZONS) {
    const after = tr.filter(t => t.time > c.time && t.time <= c.time + win && t.oi === c.outcomeIndex && t.side === 'BUY');
    if (after.length) {
      const vol = after.reduce((s, t) => s + t.size, 0);
      const vwap = after.reduce((s, t) => s + t.price * t.size, 0) / vol;
      r.h[label] = vwap - c.price;
    }
  }
  return r;
});

for (const [label] of HORIZONS) {
  const slips = rows.map(r => r.h[label]).filter(v => v != null).sort((a, b) => a - b);
  if (!slips.length) { console.log(`+${label}min: no follow-on data`); continue; }
  const med = slips[Math.floor(slips.length / 2)];
  const mean = slips.reduce((s, v) => s + v, 0) / slips.length;
  const p90 = slips[Math.floor(slips.length * 0.9)];
  console.log(`+${String(label).padStart(2)}min: n=${slips.length} · median ${(med * 100).toFixed(1)}c · mean ${(mean * 100).toFixed(1)}c · p90 ${(p90 * 100).toFixed(1)}c · range ${(slips[0] * 100).toFixed(0)}..${(slips[slips.length - 1] * 100).toFixed(0)}c`);
}
console.log(`\nCurrent assumption: +3.0c fixed. Positive median => followers pay MORE (edge eaten).`);
