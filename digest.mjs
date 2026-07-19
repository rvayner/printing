// digest.mjs — split scorecard: FAVORITES edge vs INSIDER (smart-money) edge,
// tracked separately so we can see which one — if either — is actually real as
// the real-world markets resolve. Reuses PaperBook.report() for identical math.
//
// Run:  node digest.mjs                 (print)
//       node --env-file=.env digest.mjs --notify   (also push to Telegram)

import { existsSync, readFileSync } from 'node:fs';
import { PaperBook, sparkline } from './src/paper.mjs';
import { categorize } from './src/polymarket.mjs';

const PATH = new URL('./paper-positions.json', import.meta.url).pathname;
const all = existsSync(PATH) ? JSON.parse(readFileSync(PATH)) : [];

// Three tracks: Polymarket favorites (fav-/FAVORITES), Kalshi favorites
// (kfav-/venue=kalshi), and the insider/whale layer (smart-, Polymarket only).
const isInsider = (p) => (p.id || '').startsWith('smart-');
const isKalshi = (p) => p.venue === 'kalshi' || (p.id || '').startsWith('kfav-');
const insider = all.filter(isInsider);
const kalshiFav = all.filter((p) => !isInsider(p) && isKalshi(p));
const favorites = all.filter((p) => !isInsider(p) && !isKalshi(p));

function reportFor(positions) {
  const b = new PaperBook(null);       // no path → won't write
  b.positions = positions;
  return b.report();
}

function fmt(name, positions) {
  const r = reportFor(positions);
  const lines = [];
  lines.push(`━━━━━━ ${name} ━━━━━━`);
  lines.push(`  Open ${r.nOpen} · Closed ${r.nClosed}`);
  if (r.nClosed === 0) {
    lines.push(`  No closed trades yet — nothing to judge.`);
    return { text: lines.join('\n'), r };
  }
  lines.push(`  Win rate  ${(r.winRate * 100).toFixed(1)}%   (${r.wins}/${r.nClosed})`);
  lines.push(`  Staked    $${r.staked.toFixed(0)}`);
  lines.push(`  P&L       $${r.pnl.toFixed(0)}   (ROI ${(r.roi * 100).toFixed(1)}%)`);
  lines.push(`  Max DD    $${r.maxDrawdown.toFixed(0)}`);
  if (r.curve.length) lines.push(`  Equity    ${sparkline(r.curve)}`);
  // category breakdown of closed trades
  const closed = positions.filter((p) => p.status === 'closed' || p.status === 'exited');
  const byCat = new Map();
  for (const p of closed) {
    const c = categorize(p.question || '');
    if (!byCat.has(c)) byCat.set(c, { n: 0, w: 0, pnl: 0 });
    const g = byCat.get(c); g.n++; if (p.pnl > 0) g.w++; g.pnl += p.pnl;
  }
  if (byCat.size) {
    lines.push(`  By category:`);
    for (const [c, g] of [...byCat.entries()].sort((a, b) => b[1].pnl - a[1].pnl)) {
      lines.push(`    ${c.padEnd(12)} ${g.w}/${g.n}  $${g.pnl.toFixed(0)}`);
    }
  }
  return { text: lines.join('\n'), r };
}

const fav = fmt('FAVORITES — Polymarket', favorites);
const kfav = fmt('FAVORITES — Kalshi', kalshiFav);
const ins = fmt('INSIDER edge (smart-money / whale · Polymarket)', insider);
const combined = reportFor(all);

const header = `📊 WHALE-TRACKER WEEKLY DIGEST\n   (paper — no real money · trust only after HUNDREDS of closed trades)`;
const footer = `━━━━━━ COMBINED ━━━━━━\n  ${combined.nClosed} closed · $${combined.pnl.toFixed(0)} P&L · ${(combined.roi * 100).toFixed(1)}% ROI\n`
  + `\nRemember: a small edge LOSES over the first few hundred trades (variance).\n`
  + `Judge each edge on its OWN row above, on volume — not on any single week.`;

const out = [header, '', fav.text, '', kfav.text, '', ins.text, '', footer].join('\n');
console.log(out);

if (process.argv.includes('--notify')) {
  try {
    const { sendAlert, configuredChannels } = await import('./src/notify.mjs');
    if (configuredChannels?.().length) { await sendAlert(out); console.log('\n(pushed to Telegram)'); }
    else console.log('\n(no notify channel configured — set TELEGRAM_* in .env to push)');
  } catch (e) { console.log('\n(notify skipped:', e.message, ')'); }
}
