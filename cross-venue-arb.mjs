// cross-venue-arb.mjs — the HONEST arb: find the SAME event priced differently on
// Polymarket vs Kalshi. Not latency arb (impossible retail) — price-discrepancy arb,
// minutes-latency. Uses the TARGETED Kalshi events fetch (real-world categories only,
// past the sports-parlay flood). Matches by significant-keyword overlap, shows the
// implied-prob gap and what survives realistic round-trip costs. A surviving gap is
// a CANDIDATE, not proven arb — the two contracts must be verified to resolve on
// identical criteria/timing before trusting it.
import { getActiveMarkets } from './src/polymarket.mjs';
import { getKalshiRealWorldMarkets } from './src/kalshi.mjs';

const STOP = new Set('will the be to of in on by a an and or is are at for with more most than between win wins next 2026 2027 have has who what when'.split(' '));
const toks = (s = '') => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w)));
const jaccard = (a, b) => { const i = [...a].filter((x) => b.has(x)).length; return i / (a.size + b.size - i || 1); };

// High-accuracy guards — a shared keyword is NOT a shared event. Two markets only
// describe the same contract if their DISTINGUISHING entities align: same year,
// same district code, same state, same person. And "Democrats win X" on one venue
// is the SAME market as "Republicans win X" on the other — inverted, not a gap.
const STATES = 'alabama alaska arizona arkansas california colorado connecticut delaware florida georgia hawaii idaho illinois indiana iowa kansas kentucky louisiana maine maryland massachusetts michigan minnesota mississippi missouri montana nebraska nevada hampshire jersey mexico york carolina dakota ohio oklahoma oregon pennsylvania rhode tennessee texas utah vermont virginia washington wisconsin wyoming'.split(' ');
const yearsOf = (s) => (s.match(/20\d\d/g) || []);
const districtsOf = (s) => (s.match(/\b[a-z]{2}-\d{1,2}\b/gi) || []).map((x) => x.toLowerCase());
const statesOf = (s) => STATES.filter((st) => s.toLowerCase().includes(st));
const partyOf = (s) => (/\brepublican|\bgop\b/i.test(s) ? 'R' : (/\bdemocrat/i.test(s) ? 'D' : null));
const shareOrEmpty = (a, b) => { if (!a.length || !b.length) return true; return a.some((x) => b.includes(x)); };  // if both specify, must overlap
const bothSpecifyAndDiffer = (a, b) => a.length && b.length && !a.some((x) => b.includes(x));

const COST = 0.04; // realistic round-trip: ~fee each side + spread. Below this = not real arb.
const SIM = Number(process.argv[process.argv.indexOf('--sim') + 1]) || 0.5;

console.log('Pulling both venues (Kalshi: real-world categories only)…');
const [poly, kalshi] = await Promise.all([
  getActiveMarkets({ limit: 800 }).catch((e) => { console.error('poly err', e.message); return []; }),
  getKalshiRealWorldMarkets({ limit: 1500, maxPages: 8 }).catch((e) => { console.error('kalshi err', e.message); return []; }),
]);
console.log(`  Polymarket: ${poly.length} · Kalshi real-world: ${kalshi.length}\n`);

const kIdx = kalshi.map((k) => ({ ...k, tok: toks(k.title) })).filter((k) => k.tok.size >= 2);
const matches = [];
for (const p of poly) {
  if (!(p.favPrice > 0 && p.favPrice < 1)) continue;
  if (['sports', 'crypto', 'weather'].includes(p.category)) continue;   // our excluded set
  const pt = toks(p.question); if (pt.size < 2) continue;
  let best = null, bestSim = 0;
  for (const k of kIdx) {
    const s = jaccard(pt, k.tok); if (s <= bestSim) continue;
    // distinguishing-entity gates: reject if the two markets clearly describe
    // different years / districts / states.
    if (bothSpecifyAndDiffer(yearsOf(p.question), yearsOf(k.title))) continue;
    if (bothSpecifyAndDiffer(districtsOf(p.question), districtsOf(k.title))) continue;
    if (bothSpecifyAndDiffer(statesOf(p.question), statesOf(k.title))) continue;
    // if one is district-specific and the other isn't, they're not the same contract
    if (districtsOf(p.question).length !== districtsOf(k.title).length) continue;
    bestSim = s; best = k;
  }
  if (!best || bestSim < SIM) continue;
  let pYes = p.favIndex === 0 ? p.favPrice : 1 - p.favPrice;     // Polymarket implied YES
  let kYes = best.yes, inverted = false;
  // party-side normalization: "Democrats win X" == "Republicans win X" inverted
  const pParty = partyOf(p.question), kParty = partyOf(best.title);
  if (pParty && kParty && pParty !== kParty) { kYes = 1 - kYes; inverted = true; }
  const gap = Math.abs(pYes - kYes);
  matches.push({ sim: bestSim, gap, pYes, kYes, inverted, arb: gap > COST, q: p.question, kq: best.title, kcat: best.category });
}
matches.sort((a, b) => b.gap - a.gap);

const arbs = matches.filter((m) => m.arb);
console.log(`── ${matches.length} cross-venue matches (sim ≥ ${(SIM * 100).toFixed(0)}%) · ${arbs.length} exceed the ${(COST * 100).toFixed(0)}¢ after-cost floor ──\n`);
if (!matches.length) console.log('  No confident same-event matches across venues right now.');
for (const m of matches.slice(0, 15)) {
  console.log(`  ${m.arb ? '⚠ GAP' : '  ok '} ${(m.gap * 100).toFixed(0)}¢ | Poly ${(m.pYes * 100).toFixed(0)}¢ vs Kalshi ${(m.kYes * 100).toFixed(0)}¢${m.inverted ? ' (side-inv)' : ''} [${m.kcat}] | sim ${(m.sim * 100).toFixed(0)}%`);
  console.log(`     P: "${m.q.slice(0, 62)}"`);
  console.log(`     K: "${m.kq.slice(0, 62)}"`);
}
console.log(`\n${arbs.length ? '⚠ Candidate gaps found — but VERIFY identical resolution criteria/timing before trusting.' : 'No gap survives realistic costs — the honest usual answer. Cross-venue arb is thin.'}`);
console.log('This is minutes-latency price-discrepancy detection, NOT sub-30ms execution arb.');
