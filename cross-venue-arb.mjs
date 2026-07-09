// cross-venue-arb.mjs — the HONEST arb: find the SAME event priced differently on
// Polymarket vs Kalshi. Not latency arb (impossible retail) — price-discrepancy arb.
// Matches markets by significant-keyword overlap, shows the implied-prob gap and
// what's left AFTER realistic costs (fees + spread + the fact contracts rarely
// resolve on identical criteria).
import { getActiveMarkets } from './src/polymarket.mjs';
import { getKalshiMarkets } from './src/kalshi.mjs';

const STOP = new Set('will the be to of in on by a an and or is are at for with more most than between win wins next 2026 2027 have has'.split(' '));
const toks = (s='') => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(w=>w.length>3 && !STOP.has(w)));
const jaccard = (a,b) => { const i=[...a].filter(x=>b.has(x)).length; return i/(a.size+b.size-i || 1); };

console.log('Pulling both venues…');
const [poly, kalshi] = await Promise.all([
  getActiveMarkets({ limit: 800 }).catch(()=>[]),
  getKalshiMarkets({ limit: 2000, maxPages: 3 }).catch(()=>[]),
]);
console.log(`  Polymarket: ${poly.length} · Kalshi: ${kalshi.length}\n`);

const kIdx = kalshi.map(k => ({ ...k, tok: toks(k.title) })).filter(k => k.tok.size >= 2);
const COST = 0.04; // realistic round-trip: ~2% fee each side + spread. Below this = not real arb.
const hits = [];
for (const p of poly) {
  if (!(p.favPrice > 0 && p.favPrice < 1)) continue;
  const pt = toks(p.question); if (pt.size < 2) continue;
  let best=null, bestSim=0;
  for (const k of kIdx) { const s=jaccard(pt,k.tok); if (s>bestSim){bestSim=s;best=k;} }
  if (!best || bestSim < 0.5) continue;                   // require strong title overlap
  const pYes = p.favIndex===0 ? p.favPrice : 1-p.favPrice; // Polymarket implied YES
  const gap = Math.abs(pYes - best.yes);
  if (gap > COST) hits.push({ sim:bestSim, gap, pYes, kYes:best.yes, q:p.question, kq:best.title });
}
hits.sort((a,b)=>b.gap-a.gap);
console.log(`── Candidate cross-venue gaps > ${(COST*100).toFixed(0)}¢ (after-cost floor) ──`);
if (!hits.length) console.log('  NONE. No same-event gap survives realistic costs right now — which is the honest usual answer.');
hits.slice(0,12).forEach(h => {
  console.log(`  gap ${(h.gap*100).toFixed(0)}¢ | Poly ${(h.pYes*100).toFixed(0)}¢ vs Kalshi ${(h.kYes*100).toFixed(0)}¢ | sim ${(h.sim*100).toFixed(0)}%`);
  console.log(`     P: "${h.q.slice(0,60)}"`);
  console.log(`     K: "${h.kq.slice(0,60)}"`);
});
console.log(`\nNote: even a surviving gap is usually NOT arb — the two contracts rarely`);
console.log(`resolve on identical criteria/timing. Verify before trusting any match.`);
