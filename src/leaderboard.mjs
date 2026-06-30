// leaderboard.mjs — rank validated wallets per CATEGORY by proven edge (lower
// bound of the 95% CI). A wallet great at politics ≠ great at crypto, so we want
// the best specialist for each domain, not one global list.

import { edgeCIFromStats } from './score.mjs';

// wallets: [{ wallet, profile: { overall, cats } }]
export function categoryLeaderboards(wallets, { minBets = 20, topN = 8 } = {}) {
  const byCat = {};
  for (const w of wallets) {
    for (const [cat, prof] of Object.entries(w.profile?.cats || {})) {
      if (prof.n < minBets) continue;
      const ci = edgeCIFromStats(prof);
      (byCat[cat] ??= []).push({
        wallet: w.wallet, n: prof.n, edge: prof.edgePerBet, lo: ci.lo, significant: ci.significant,
      });
    }
  }
  for (const cat of Object.keys(byCat)) {
    byCat[cat].sort((a, b) => b.lo - a.lo);
    byCat[cat] = byCat[cat].slice(0, topN);
  }
  return byCat;
}

export function formatLeaderboards(byCat) {
  const cats = Object.keys(byCat).sort();
  if (!cats.length) return 'No category specialists with enough bets yet.';
  const lines = [];
  for (const cat of cats) {
    lines.push(`\n📊 ${cat.toUpperCase()}`);
    for (const r of byCat[cat]) {
      lines.push(`   ${r.wallet.slice(0, 12)}…  edge ${(r.edge * 100).toFixed(1)}¢  CI-low ${(r.lo * 100).toFixed(1)}¢  (n=${r.n})${r.significant ? ' ✅' : ''}`);
    }
  }
  return lines.join('\n');
}
