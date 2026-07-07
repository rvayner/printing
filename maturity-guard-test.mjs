import { insiderScore } from './src/insider.mjs';

const cases = [
  ['Russian-election TRAP (thin+new+far-dated)', { notional:6037, price:0.40, category:'politics', walletTradeCount:99,
     liquidity:2500, hoursToResolve:70*24, marketAgeHours:3 }],
  ['far-dated only (good liq, old, but 90d out)', { notional:6037, price:0.40, category:'politics', walletTradeCount:99,
     liquidity:50000, hoursToResolve:90*24, marketAgeHours:500 }],
  ['thin book only', { notional:6037, price:0.40, category:'politics', walletTradeCount:99,
     liquidity:1200, hoursToResolve:20*24, marketAgeHours:500 }],
  ['freshly-listed only', { notional:6037, price:0.40, category:'politics', walletTradeCount:99,
     liquidity:50000, hoursToResolve:20*24, marketAgeHours:6 }],
  ['CLEAN mature market (should PASS)', { notional:6037, price:0.40, category:'politics', walletTradeCount:99,
     liquidity:50000, hoursToResolve:20*24, marketAgeHours:500 }],
  ['maturity UNKNOWN (fetch failed → lenient PASS)', { notional:6037, price:0.40, category:'politics', walletTradeCount:99 }],
];
for (const [label, f] of cases) {
  const s = insiderScore(f);
  console.log(`${s.actionable ? '✅ PASS' : '⛔ REJECT'} — score ${s.score}/5 · mature=${s.mature} · ${label}`);
  console.log(`         reason: ${s.maturityReason}\n`);
}
