// arb-scan.mjs — the ONLY true "wins every time" arbitrage: the Dutch book on a
// genuinely mutually-exclusive event (negRisk=true — exactly one outcome resolves
// YES). If the sum of all outcomes' YES prices < $1 minus fees, buying one share of
// each locks a guaranteed profit. Non-negRisk events (overlapping thresholds) are
// EXCLUDED — summing them is meaningless and produces false arbs.
const G = "https://gamma-api.polymarket.com";
const FEE = 0.02;   // realistic round-trip friction; below this an apparent gap is not real arb.

let events = [], offset = 0;
while (offset < 1500) {
  const batch = await fetch(`${G}/events?closed=false&limit=100&offset=${offset}&order=volume&ascending=false`, { headers: { accept: "application/json" } }).then(r => r.json()).catch(() => []);
  if (!batch.length) break;
  events.push(...batch); offset += 100;
}
console.log(`Scanned ${events.length} open events.`);

const mx = events.filter(e => e.negRisk === true && (e.markets || []).length >= 2);
console.log(`${mx.length} are genuinely mutually-exclusive (negRisk=true) — where Dutch-book arb CAN exist.\n`);

const sums = [], arbs = [];
for (const e of mx) {
  let s = 0, ok = true;
  for (const m of e.markets) {
    try { const p = JSON.parse(m.outcomePrices || "[]").map(Number); if (p.length < 2) { ok = false; break; } s += p[0]; }
    catch { ok = false; break; }
  }
  if (!ok) continue;
  sums.push(s);
  if (s < 1 - FEE) arbs.push({ title: e.title, n: e.markets.length, sum: s, profit: (1 - s) });
}
sums.sort((a, b) => a - b);
const med = sums[Math.floor(sums.length / 2)] || 0;
console.log(`ΣYES across mutually-exclusive events:  min ${sums[0]?.toFixed(3)} · median ${med.toFixed(3)} · max ${sums[sums.length-1]?.toFixed(3)}`);
console.log(`(A real buy-all-YES arb needs ΣYES < ${(1 - FEE).toFixed(2)} after fees.)\n`);
if (!arbs.length) {
  console.log(`✅ ARBS FOUND: 0.  Every mutually-exclusive market is priced at ~$1.00 — no free money.`);
  console.log(`   This is the honest reality: true Dutch-book arb is arbed away in milliseconds by bots.`);
} else {
  console.log(`⚠ ${arbs.length} apparent arb(s) — VERIFY on the live order book (these use mid, not ask):`);
  for (const a of arbs.sort((x, y) => y.profit - x.profit).slice(0, 10))
    console.log(`   +${(a.profit * 100).toFixed(1)}¢/$1 · ΣYES ${a.sum.toFixed(3)} · ${a.n} outcomes — "${a.title.slice(0, 45)}"`);
}
