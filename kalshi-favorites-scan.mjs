// kalshi-favorites-scan.mjs — the SAME favorite-longshot edge, on Kalshi. The bias
// is documented as universal across venues, so we paper-trade Kalshi favorites in
// parallel with Polymarket to test whether the edge holds on both. Kalshi is
// anonymous (no insider layer) — favorites only. Uses VOLUME as the depth signal
// (Kalshi's liquidity_dollars field is unpopulated / always 0).
//
// Run: node kalshi-favorites-scan.mjs [--paper] [--top 20]
import { CONFIG } from './config.mjs';
import { getKalshiRealWorldMarkets } from './src/kalshi.mjs';
import { kellyStake } from './src/sizing.mjs';
import { PaperBook } from './src/paper.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const has = (k) => process.argv.includes(`--${k}`);
const LO = arg('lo', 0.65), HI = arg('hi', 0.85), TOP = arg('top', 20);
const MIN_VOLUME = arg('minvol', 2000);          // Kalshi depth proxy (contracts traded)
const SLIP = CONFIG.MAX_ENTRY_SLIPPAGE;

function calibWinRate(p) {
  const t = [[0.60, 0.70], [0.65, 0.76], [0.70, 0.84], [0.75, 0.89], [0.80, 0.92], [0.85, 0.96], [0.90, 0.98]];
  let wr = p; for (const [lo, w] of t) if (p >= lo) wr = w; return wr;
}

console.log('Scanning Kalshi real-world markets for favorites…');
const markets = await getKalshiRealWorldMarkets({ limit: 1500, maxPages: 8 });
const picks = [];
for (const m of markets) {
  if (m.favPrice < LO || m.favPrice > HI) continue;
  if (m.volume < MIN_VOLUME) continue;                             // real trading only
  if (CONFIG.FAV_EXCLUDE.includes(m.category?.toLowerCase?.() || '')) continue;
  const entry = Math.min(0.98, m.favEntry || (m.favPrice + SLIP));
  const winRate = calibWinRate(m.favPrice);
  const edge = winRate - entry;
  if (edge <= 0) continue;
  const qWeight = CONFIG.FAV_CATEGORY_RANK[(m.category || '').toLowerCase()] ?? 1.0;
  const size = Math.min(kellyStake({ bankroll: CONFIG.BANKROLL, price: entry, edgeLo: edge, liquidity: m.volume }), CONFIG.MAX_BANKROLL_FRAC * CONFIG.BANKROLL);
  picks.push({ ...m, entry, winRate, edge, size, qWeight, rank: edge * qWeight });
}
picks.sort((a, b) => b.rank - a.rank);

// simple diversification: ≤1 per event-ish (by ticker root) and a category cap
const seenRoot = new Set(); const catUsd = {}; const selected = [];
for (const p of picks) {
  const root = (p.ticker || '').split('-')[0];
  if (seenRoot.has(root)) continue;
  if ((catUsd[p.category] || 0) + p.size > CONFIG.MAX_CATEGORY_FRAC * CONFIG.BANKROLL) continue;
  seenRoot.add(root); catUsd[p.category] = (catUsd[p.category] || 0) + p.size;
  selected.push(p);
}
const top = selected.slice(0, TOP);
console.log(`  ${markets.length} markets · ${picks.length} favorites (${LO*100}-${HI*100}c, vol≥${MIN_VOLUME}) · ${selected.length} pass diversification\n`);
for (const p of top) {
  console.log(`[${p.category}] ${(p.favPrice*100).toFixed(0)}c ${p.favSide} — ${(p.title||'').slice(0,52)}`);
  console.log(`   buy ≤${(p.entry*100).toFixed(0)}c · est win ${(p.winRate*100).toFixed(0)}% · edge +${(p.edge*100).toFixed(1)}c · size ~$${p.size.toFixed(0)} · vol ${p.volume.toFixed(0)}\n`);
}

if (has('paper') && selected.length) {
  const book = new PaperBook(new URL('./paper-positions.json', import.meta.url).pathname);
  let opened = 0;
  for (const p of selected) {
    const oi = p.favSide === 'yes' ? 0 : 1;                        // matches getKalshiResolution
    if (book.open({ id: `kfav-${p.ticker}`, wallet: 'KALSHI_FAV', marketId: p.ticker, venue: 'kalshi',
      question: p.title, side: p.favSide, outcomeIndex: oi, entry: p.entry, resolveTime: p.closeTime, stake: Math.max(10, p.size) })) opened++;
  }
  console.log(`📝 opened ${opened} new Kalshi paper positions (venue=kalshi).`);
}
