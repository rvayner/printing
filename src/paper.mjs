// paper.mjs — risk-free paper-trading ledger. Every follow signal becomes a
// simulated position; on market resolution it's marked to a real P&L. Tracks
// win rate, ROI, equity curve, and max drawdown so you can prove (or disprove)
// the live edge with zero money on the line.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export class PaperBook {
  constructor(path = null, { stake = 100 } = {}) {
    this.path = path;
    this.stake = stake;
    this.positions = path && existsSync(path) ? JSON.parse(readFileSync(path)) : [];
  }

  has(id) { return this.positions.some((p) => p.id === id); }

  // Open a simulated position: buy `shares` of the followed side at `entry`.
  open({ id, wallet, marketId, question, side, outcomeIndex = null, entry, resolveTime, stake = this.stake }) {
    if (this.has(id)) return false;
    const shares = stake / entry;                 // each share pays $1 if it wins
    this.positions.push({
      id, wallet, marketId, question, side, outcomeIndex, entry, stake, shares,
      resolveTime: resolveTime ?? null, status: 'open', won: null, pnl: null,
    });
    this._save();
    return true;
  }

  // Resolve every open position in a market once its outcome is known (sim path).
  resolve(marketId, won) {
    let n = 0;
    for (const p of this.positions) {
      if (p.status === 'open' && p.marketId === marketId) {
        p.status = 'closed';
        p.won = won ? 1 : 0;
        p.pnl = won ? p.shares * (1 - p.entry) : -p.stake;   // win: profit per share; lose: stake
        n++;
      }
    }
    if (n) this._save();
    return n;
  }

  // Resolve by winning outcome index (live path): each position wins iff it
  // followed the outcome that resolved true.
  resolveOutcome(marketId, winningIndex) {
    let n = 0;
    for (const p of this.positions) {
      if (p.status === 'open' && p.marketId === marketId) {
        const won = p.outcomeIndex === winningIndex;
        p.status = 'closed';
        p.won = won ? 1 : 0;
        p.pnl = won ? p.shares * (1 - p.entry) : -p.stake;
        n++;
      }
    }
    if (n) this._save();
    return n;
  }

  // Close early because the followed wallet SOLD — exit at their sell price.
  exitAt({ wallet, marketId, outcomeIndex, price }) {
    let n = 0;
    for (const p of this.positions) {
      if (p.status === 'open' && p.wallet === wallet && p.marketId === marketId && p.outcomeIndex === outcomeIndex) {
        p.status = 'exited';
        p.exitPrice = price;
        p.pnl = p.shares * price - p.stake;     // sold `shares` at `price`
        n++;
      }
    }
    if (n) this._save();
    return n;
  }

  _save() { if (this.path) writeFileSync(this.path, JSON.stringify(this.positions, null, 2)); }

  report() {
    const closed = this.positions.filter((p) => p.status === 'closed' || p.status === 'exited');
    const open = this.positions.filter((p) => p.status === 'open');
    const wins = closed.filter((p) => p.pnl > 0).length;
    const staked = closed.reduce((s, p) => s + p.stake, 0);
    const pnl = closed.reduce((s, p) => s + p.pnl, 0);

    // equity curve + max drawdown in resolution order
    const ordered = [...closed].sort((a, b) => (a.resolveTime ?? 0) - (b.resolveTime ?? 0));
    let eq = 0, peak = 0, maxDD = 0;
    const curve = [];
    for (const p of ordered) { eq += p.pnl; peak = Math.max(peak, eq); maxDD = Math.min(maxDD, eq - peak); curve.push(eq); }

    return {
      nClosed: closed.length, nOpen: open.length, wins,
      winRate: closed.length ? wins / closed.length : 0,
      staked, pnl, roi: staked ? pnl / staked : 0, maxDrawdown: maxDD, curve,
    };
  }
}

// tiny text equity sparkline
export function sparkline(curve, width = 48) {
  if (!curve.length) return '';
  const blocks = '▁▂▃▄▅▆▇█';
  const step = Math.max(1, Math.floor(curve.length / width));
  const pts = curve.filter((_, i) => i % step === 0);
  const lo = Math.min(...pts), hi = Math.max(...pts), range = hi - lo || 1;
  return pts.map((v) => blocks[Math.min(7, Math.floor(((v - lo) / range) * 7))]).join('');
}
