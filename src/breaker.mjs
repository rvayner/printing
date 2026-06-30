// breaker.mjs — the safety circuit breaker. Live alerts are only allowed while a
// FRESH walk-forward PASS exists. If the daily walk-forward flips to FAIL, or the
// last verdict goes stale, the breaker trips and the watcher goes silent — so the
// bot can never keep signaling an edge that has decayed.

import { existsSync, readFileSync } from 'node:fs';
import { CONFIG } from '../config.mjs';

const REPORT = new URL('../walkforward-report.json', import.meta.url).pathname;

export function checkBreaker() {
  if (!existsSync(REPORT)) {
    // untested ≠ failed. Allow (e.g. paper bootstrap) but warn loudly.
    return { tripped: false, untested: true, reason: 'no walk-forward report yet — run walkforward.mjs to confirm an edge' };
  }
  let r;
  try { r = JSON.parse(readFileSync(REPORT)); } catch { return { tripped: true, reason: 'walk-forward report unreadable' }; }
  const ageDays = r.generatedAt ? (Date.now() - Date.parse(r.generatedAt)) / 864e5 : Infinity;
  if (r.PASS !== true) return { tripped: true, reason: `walk-forward FAIL (${(r.generatedAt || '').slice(0, 10)})` };
  if (ageDays > CONFIG.WALKFORWARD_MAX_AGE_DAYS) {
    return { tripped: true, reason: `walk-forward verdict stale (${ageDays.toFixed(0)}d old > ${CONFIG.WALKFORWARD_MAX_AGE_DAYS}d) — re-run to reconfirm` };
  }
  return { tripped: false, reason: `walk-forward PASS (${(r.generatedAt || '').slice(0, 10)}, ${ageDays.toFixed(0)}d old)` };
}
