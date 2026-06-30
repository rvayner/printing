// favorites-scan.mjs — the LIVE tradeable signal from our validated edge. Scans
// open Polymarket markets for favorites in the 65-85¢ sweet spot, sizes each by
// Kelly using the calibration win-rates, and lists/alerts them. This is the
// proven +9% strategy turned into an actionable feed.
//
// Run: node favorites-scan.mjs            [--lo 0.65 --hi 0.85 --top 25]
//      node --env-file=.env favorites-scan.mjs --notify   (Telegram)

import { CONFIG } from './config.mjs';
import { getActiveMarkets } from './src/polymarket.mjs';
import { kellyStake } from './src/sizing.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const has = (k) => process.argv.includes(`--${k}`);
const LO = arg('lo', 0.65), HI = arg('hi', 0.85), TOP = arg('top', 25), SLIP = CONFIG.MAX_ENTRY_SLIPPAGE;
const HIGH_FREQ = /up or down|\b\d{1,2}(:\d{2})?\s?(am|pm)\b|hourly|every hour|\b(5|10|15)[- ]?min/i;

// Empirical win rate by price band, measured on 567k real bets (calibration.mjs).
function calibWinRate(p) {
  const table = [[0.60, 0.70], [0.65, 0.76], [0.70, 0.84], [0.75, 0.89], [0.80, 0.92], [0.85, 0.96], [0.90, 0.98]];
  let wr = p;
  for (const [lo, w] of table) if (p >= lo) wr = w;
  return wr;
}

console.log('Scanning open Polymarket markets for favorites…');
const markets = await getActiveMarkets({ limit: 800 });
console.log(`  ${markets.length} open markets fetched\n`);

const picks = [];
for (const m of markets) {
  if (m.favPrice < LO || m.favPrice > HI) continue;
  if (m.liquidity < CONFIG.MIN_LIQUIDITY) continue;
  if (HIGH_FREQ.test(m.question || '')) continue;       // skip crypto HFT churn
  const entry = Math.min(0.98, m.favPrice + SLIP);
  const winRate = calibWinRate(m.favPrice);
  const edge = winRate - entry;                          // expected edge after slippage
  if (edge <= 0) continue;
  const size = kellyStake({ bankroll: CONFIG.BANKROLL, price: entry, edgeLo: edge, liquidity: m.liquidity });
  const hoursLeft = m.endDate ? (m.endDate - Date.now()) / 3600e3 : null;
  picks.push({ ...m, entry, winRate, edge, size, hoursLeft, expRet: edge / entry });
}

picks.sort((a, b) => b.edge - a.edge);
const top = picks.slice(0, TOP);

console.log(`── ${picks.length} favorites in ${(LO * 100).toFixed(0)}-${(HI * 100).toFixed(0)}¢ band (top ${top.length}) ──\n`);
const lines = [];
for (const p of top) {
  const l = `${(p.favPrice * 100).toFixed(0)}¢ "${(p.favName || '').slice(0, 24)}" — ${p.question.slice(0, 60)}`
    + `\n   buy ≤${(p.entry * 100).toFixed(0)}¢ · est win ${(p.winRate * 100).toFixed(0)}% · edge +${(p.edge * 100).toFixed(1)}¢ (~+${(p.expRet * 100).toFixed(0)}%) · size ~$${p.size.toFixed(0)} · liq $${p.liquidity.toFixed(0)}${p.hoursLeft ? ` · ${p.hoursLeft.toFixed(0)}h` : ''}`;
  console.log(l + '\n');
  lines.push(l);
}

console.log('Strategy: buy these favorites, hold to resolution, diversify across MANY (negative');
console.log('skew → spread risk). Edge is +9% historically; size with Kelly; never all-in on one.');

if (has('notify') && top.length) {
  const { sendAlert } = await import('./src/notify.mjs');
  await sendAlert(`⭐ FAVORITES (${(LO*100).toFixed(0)}-${(HI*100).toFixed(0)}¢) — top ${Math.min(8, top.length)} of ${picks.length}:\n\n` + lines.slice(0, 8).join('\n\n'));
  console.log('\nPushed top picks to Telegram.');
}
