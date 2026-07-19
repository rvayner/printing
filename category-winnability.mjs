// category-winnability.mjs — which categories are MOST WINNABLE for the favorites
// edge? Re-categorizes from the market TITLE with the CURRENT categorizer (the
// cache's stored category is stale), then per category measures realized win rate
// vs price-implied, the edge, and ROI/unit. Rank to focus where favorites win.
import { readFileSync } from 'node:fs';
import { categorize } from './src/polymarket.mjs';

const cachePath = new URL('./wallet-bets-cache.json', import.meta.url).pathname;
const wb = new Map(JSON.parse(readFileSync(cachePath)));
const bets = [...wb.values()].flat().filter((b) => b.cost >= 0.65 && b.cost <= 0.85 && b.size > 0 && b.won != null);
const withTitle = bets.filter((b) => (b.title || '').length > 3).length;
console.log(`${bets.length.toLocaleString()} favorite bets (65-85c); ${(withTitle / bets.length * 100).toFixed(0)}% have titles to re-categorize.\n`);

const cats = new Map();
for (const b of bets) {
  const c = categorize(b.title || '');                     // CURRENT categorizer, from title
  if (!cats.has(c)) cats.set(c, { n: 0, wins: 0, price: 0, roi: 0 });
  const g = cats.get(c);
  g.n++; g.wins += b.won ? 1 : 0; g.price += b.cost;
  g.roi += (b.won ? (1 - b.cost) : -b.cost) / b.cost;
}

const rows = [...cats.entries()].map(([c, g]) => ({
  cat: c, n: g.n, winRate: g.wins / g.n, implied: g.price / g.n,
  edge: g.wins / g.n - g.price / g.n, roi: g.roi / g.n,
})).filter((r) => r.n >= 200).sort((a, b) => b.roi - a.roi);

console.log('category      n        win%   implied  edge     ROI/unit');
console.log('─'.repeat(62));
for (const r of rows) {
  const mark = r.roi > 0.03 ? '✅' : (r.roi > 0 ? '· ' : '❌');
  console.log(`${mark} ${r.cat.padEnd(11)} ${String(r.n).padStart(7)}   ${(r.winRate * 100).toFixed(1)}%  ${(r.implied * 100).toFixed(1)}%   ${(r.edge * 100 >= 0 ? '+' : '')}${(r.edge * 100).toFixed(1)}c   ${(r.roi * 100 >= 0 ? '+' : '')}${(r.roi * 100).toFixed(1)}%`);
}
console.log('\n✅ ROI>3% (focus) · · marginal · ❌ negative (avoid).');
