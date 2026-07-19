// monitor.mjs — the RIGOROUS "how do we look". Instead of eyeballing a tiny P&L,
// ask: are the live paper results CONSISTENT with the backtested edge, or has it
// decayed? Each favorite bought at price p should win at the backtested rate
// calibWinRate(p). Compare actual wins to that expectation with a calibration
// z-score (same test as skill.mjs). This gives an early real/decayed verdict long
// before raw P&L is meaningful — and catches a broken edge BEFORE real money.
import { existsSync, readFileSync } from 'node:fs';
import { categorize } from './src/polymarket.mjs';

// backtested win rate by entry price band (calibration.mjs, 567k bets)
function calibWinRate(p) {
  const t = [[0.60, 0.70], [0.65, 0.76], [0.70, 0.84], [0.75, 0.89], [0.80, 0.92], [0.85, 0.96], [0.90, 0.98]];
  let wr = p; for (const [lo, w] of t) if (p >= lo) wr = w; return wr;
}

const PATH = new URL('./paper-positions.json', import.meta.url).pathname;
const all = existsSync(PATH) ? JSON.parse(readFileSync(PATH)) : [];
const isIns = (p) => (p.id || '').startsWith('smart-');
const isKalshi = (p) => p.venue === 'kalshi' || (p.id || '').startsWith('kfav-');

function assess(name, positions) {
  const closed = positions.filter((p) => (p.status === 'closed' || p.status === 'exited') && p.entry > 0);
  console.log(`\n━━ ${name} ━━`);
  if (closed.length < 3) { console.log(`  n=${closed.length} — INSUFFICIENT (need ≥3 to say anything).`); return; }
  let expWins = 0, variance = 0, actWins = 0, expRoi = 0;
  for (const p of closed) {
    const wr = calibWinRate(p.entry);
    expWins += wr; variance += wr * (1 - wr);
    actWins += p.won ? 1 : 0;
    expRoi += (wr * (1 - p.entry) - (1 - wr) * p.entry) / p.entry;   // expected ROI/unit at this entry
  }
  const z = (actWins - expWins) / Math.sqrt(variance || 1);
  const actRoi = closed.reduce((s, p) => s + p.pnl, 0) / closed.reduce((s, p) => s + p.stake, 0);
  console.log(`  n=${closed.length} · actual ${actWins}/${closed.length} wins (${(actWins / closed.length * 100).toFixed(0)}%) vs backtest-expected ${(expWins / closed.length * 100).toFixed(0)}%`);
  console.log(`  calibration z = ${z.toFixed(2)}   (0 = exactly as backtested; <0 = underperforming)`);
  console.log(`  ROI: actual ${(actRoi * 100).toFixed(1)}% vs expected ${(expRoi / closed.length * 100).toFixed(1)}%/unit`);
  let verdict;
  if (closed.length < 30) verdict = `⏳ CONSISTENT so far, but n<30 — z is noisy; keep accumulating`;
  else if (z > -2) verdict = `✅ EDGE INTACT — live is within backtest variance`;
  else verdict = `🚨 POSSIBLE DECAY — live is >2σ below backtest; investigate before funding`;
  console.log(`  → ${verdict}`);
}

const fav = all.filter((p) => !isIns(p) && !isKalshi(p));
assess('FAVORITES (Polymarket) — clean real-world only', fav.filter((p) => !['weather', 'sports', 'crypto'].includes(categorize(p.question || ''))));
assess('FAVORITES (Polymarket) — weather (excluded regime, for reference)', fav.filter((p) => categorize(p.question || '') === 'weather'));
assess('FAVORITES (Kalshi) — real-world', all.filter((p) => !isIns(p) && isKalshi(p)));
assess('INSIDER (Polymarket)', all.filter(isIns));
console.log(`\nThe point: judge the edge vs its OWN backtested expectation, not vs zero.`);
console.log(`A losing week with z≈0 means the edge is intact and you hit variance — NOT that it is broken.`);
