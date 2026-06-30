// surge.mjs — detect when SEVERAL validated wallets independently bet the same
// outcome within a short window. Convergence of proven money is a far stronger
// signal than any single whale (and is what a real information event looks like).

export class SurgeTracker {
  constructor({ windowMs, minWallets }) {
    this.windowMs = windowMs;
    this.minWallets = minWallets;
    this.hits = new Map(); // key "market:outcome" -> [{wallet, time}]
  }

  // Record a validated-wallet signal. Returns { surge, wallets, count } if the
  // distinct-wallet count in the window has reached the threshold.
  add({ marketId, outcomeIndex, wallet, time = Date.now() }) {
    const key = `${marketId}:${outcomeIndex}`;
    const arr = (this.hits.get(key) || []).filter((h) => time - h.time <= this.windowMs);
    if (!arr.some((h) => h.wallet === wallet)) arr.push({ wallet, time });
    this.hits.set(key, arr);
    const wallets = [...new Set(arr.map((h) => h.wallet))];
    return { surge: wallets.length >= this.minWallets, wallets, count: wallets.length, marketId, outcomeIndex };
  }
}
