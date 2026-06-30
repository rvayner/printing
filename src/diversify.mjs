// diversify.mjs — the guard that keeps the negative-skew favorites edge from
// blowing up on correlated risk. Favorites win often / lose big, so the danger
// is many positions failing TOGETHER (same event, same category). Greedily picks
// the highest-edge favorites while enforcing: ≤N per event, ≤X% per category,
// ≤Y% total deployed, and a hard position cap. Keeps dry powder.

import { CONFIG } from '../config.mjs';

// picks: pre-sorted by edge (best first), each with { eventSlug, category, size, ... }
export function diversify(picks, { bankroll = CONFIG.BANKROLL } = {}) {
  const selected = [], skipped = { event: 0, category: 0, deployed: 0, count: 0 };
  const perEvent = new Map(), perCategory = new Map();
  let deployed = 0;

  for (const p of picks) {
    if (selected.length >= CONFIG.MAX_POSITIONS) { skipped.count++; continue; }
    const ev = p.eventSlug || p.conditionId;
    const cat = p.category || 'other';
    const stake = Math.max(10, p.size || 0);

    if ((perEvent.get(ev) || 0) >= CONFIG.MAX_PER_EVENT) { skipped.event++; continue; }
    if ((perCategory.get(cat) || 0) + stake > bankroll * CONFIG.MAX_CATEGORY_FRAC) { skipped.category++; continue; }
    if (deployed + stake > bankroll * CONFIG.MAX_DEPLOYED_FRAC) { skipped.deployed++; continue; }

    selected.push({ ...p, stake });
    perEvent.set(ev, (perEvent.get(ev) || 0) + 1);
    perCategory.set(cat, (perCategory.get(cat) || 0) + stake);
    deployed += stake;
  }
  return { selected, skipped, deployed, byCategory: perCategory, bankroll };
}
