// Live whale-flow: biggest real-world-event bets happening now + convergence.
import { getRecentTrades, categorize } from './src/polymarket.mjs';

const EXCLUDE = ['sports', 'crypto'];
const all = await getRecentTrades({ limit: 1000 });
const buys = all.filter(t => t.side === 'BUY' && t.notional >= 100);
const rw = buys.map(t => ({ ...t, cat: categorize(t.title || '') }))
              .filter(t => !EXCLUDE.includes(t.cat));

console.log(`Pulled ${all.length} recent trades → ${buys.length} buys ≥$100 → ${rw.length} real-world (non-sports/crypto).\n`);

console.log('── TOP 15 real-world-event bets right now (by $ size) ──');
rw.sort((a,b)=>b.notional-a.notional).slice(0,15).forEach(t => {
  const mins = ((Date.now()-t.time)/60000).toFixed(0);
  console.log(`$${t.notional.toFixed(0).padStart(6)} @ ${(t.price*100).toFixed(0)}¢ [${t.cat}] ${mins}m ago — "${(t.title||'').slice(0,55)}" → ${t.outcome}`);
});

// Convergence: multiple big buys on the SAME market = the surge signal
const byMkt = new Map();
for (const t of rw) {
  const k = t.conditionId;
  if (!byMkt.has(k)) byMkt.set(k, { title: t.title, cat: t.cat, n: 0, usd: 0, wallets: new Set() });
  const g = byMkt.get(k); g.n++; g.usd += t.notional; g.wallets.add(t.wallet);
}
const surges = [...byMkt.values()].filter(g => g.wallets.size >= 2).sort((a,b)=>b.usd-a.usd);
console.log(`\n── CONVERGENCE (≥2 distinct wallets buying same real-world market) ──`);
if (!surges.length) console.log('  none in this window.');
surges.slice(0,10).forEach(g =>
  console.log(`  ${g.wallets.size} wallets · $${g.usd.toFixed(0)} · [${g.cat}] "${(g.title||'').slice(0,55)}"`));

// mid-price (uncertain) big bets = the insider band specifically
const insider = rw.filter(t => t.price>=0.35 && t.price<=0.70 && t.notional>=1000);
console.log(`\n── INSIDER BAND ($1k+ on 35-70¢ uncertain real-world) ──`);
if (!insider.length) console.log('  none right now (rare — these are the highest-signal bets).');
insider.sort((a,b)=>b.notional-a.notional).forEach(t =>
  console.log(`  $${t.notional.toFixed(0)} @ ${(t.price*100).toFixed(0)}¢ [${t.cat}] "${(t.title||'').slice(0,50)}" → ${t.outcome}`));
