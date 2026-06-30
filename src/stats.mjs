// stats.mjs — the statistical primitives the skill gates rely on.

// Standard normal CDF (Abramowitz-Stegun 7.1.26).
export function normCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}
// One-sided p-value for "is this z-score positive by more than chance".
export const pValueOneSided = (z) => 1 - normCdf(z);

export const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
export const sum = (a) => a.reduce((s, x) => s + x, 0);

// Spearman rank correlation — used to ask "do period-A ranks predict period-B ranks?"
export function spearman(pairs) {
  const n = pairs.length;
  if (n < 3) return null;
  const rank = (key) => {
    const idx = pairs.map((p, i) => [p[key], i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(n);
    idx.forEach(([, i], k) => { r[i] = k + 1; });
    return r;
  };
  const ra = rank(0), rb = rank(1);
  const d2 = sum(ra.map((x, i) => (x - rb[i]) ** 2));
  return 1 - (6 * d2) / (n * (n * n - 1));
}
