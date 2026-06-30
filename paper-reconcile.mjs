// paper-reconcile.mjs — close paper positions whose markets have resolved, then
// print the standing paper-trading scorecard. Run periodically (cron/launchd).
//
// Run: node paper-reconcile.mjs
//      node paper-reconcile.mjs --report   # just show the scorecard, don't fetch

import { PaperBook, sparkline } from './src/paper.mjs';
import { getMarketResolution } from './src/polymarket.mjs';

const PAPER_PATH = new URL('./paper-positions.json', import.meta.url).pathname;
const REPORT_ONLY = process.argv.includes('--report');
const book = new PaperBook(PAPER_PATH);

if (!REPORT_ONLY) {
  const openMarkets = [...new Set(book.positions.filter((p) => p.status === 'open').map((p) => p.marketId))];
  console.log(`Reconciling ${openMarkets.length} open market(s)…`);
  let closed = 0;
  for (const marketId of openMarkets) {
    let winningIndex;
    try { winningIndex = await getMarketResolution(marketId); }
    catch (e) { console.error(`  (resolution fetch failed for ${marketId}: ${e.message})`); continue; }
    if (winningIndex == null) continue;            // not resolved yet
    closed += book.resolveOutcome(marketId, winningIndex);
  }
  console.log(`Closed ${closed} position(s).\n`);
}

const r = book.report();
console.log('──────── PAPER SCORECARD ────────');
console.log(`Open:          ${r.nOpen}   Closed: ${r.nClosed}`);
if (r.nClosed) {
  console.log(`Win rate:      ${(r.winRate * 100).toFixed(1)}%`);
  console.log(`Staked:        $${r.staked.toFixed(0)}`);
  console.log(`P&L:           ${r.pnl >= 0 ? '+' : ''}$${r.pnl.toFixed(0)}   (ROI ${r.roi*100>=0?'+':''}${(r.roi*100).toFixed(1)}%)`);
  console.log(`Max drawdown:  $${r.maxDrawdown.toFixed(0)}`);
  console.log(`Equity:        ${sparkline(r.curve)}`);
  console.log('\nReminder: trust this only after HUNDREDS–THOUSANDS of closed trades.');
  console.log('A few dozen wins mean nothing — the edge is small and the variance is large.');
} else {
  console.log('No closed positions yet. Let signals.mjs --paper run and reconcile over time.');
}
