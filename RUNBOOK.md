# RUNBOOK — whale-tracker

The single doc to deploy and operate the system. Follow it in order. Don't skip.

---

## The two proven edges (what you're trading)

| Edge | Rule | Proven | Risk |
|---|---|---|---|
| **⭐ Favorites** | Buy 65–85¢ favorites, hold to resolution | z=49.6 · 8/8 periods · 100% bootstrap · +9.6% | negative skew (win often, lose big) → diversify |
| **💸 Informed money** | Follow big ($1k+) bets on uncertain (35–70¢) non-sports event markets | z=3.8 · p<0.0001 · +14–22% | small sample, high variance → losing stretches |

**No trade is 100% certain.** Favorites lose ~13% of the time, informed ~27%. You trade the *edge* over many bets, sized so no loss ruins you. Lean on favorites (the certain one); treat informed-money as a smaller, higher-variance satellite.

---

## ONE-TIME SETUP

```bash
# 1. On an always-on machine with Node 22:
git clone <your private repo> && cd whale-tracker
cp .env.example .env        # fill TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
node --env-file=.env telegram-test.mjs      # phone should buzz
```

---

## GO-LIVE SEQUENCE (never skip a step)

1. **Prove the edges still hold** (re-run any time):
   `node proof.mjs`  → favorites must be z>10, positive in most periods.
2. **Paper-trade for 2–4 weeks:**
   `pm2 start ecosystem.config.cjs` (runs favorites-scan + smart-money + reconcile, paper mode)
   Check `node paper-reconcile.mjs --report` (or `/stats` on Telegram) until **100+ closed trades**.
   ✅ Proceed only if paper ROI is positive and roughly matches the backtest.
3. **Prove execution** (zero risk): `node clob-check.mjs` → orders must be live-fillable.
4. **Dry-run the bot:** `node executor.mjs` → eyeball that orders look sane.
5. **Fund small + wire real orders:** create a Polymarket account, fund ~$100–200,
   `npm i @polymarket/clob-client`, enable the block in `src/clob.mjs` `postOrder()`,
   set `POLYMARKET_PRIVATE_KEY` in `.env`.
6. **Canary:** place ONE $1 order, confirm the fill on Polymarket. **Do not skip.**
7. **Go live small:** `node --env-file=.env executor.mjs --live --i-understand-the-risk`
   (hard-capped at $25/order, $250/run in config).

---

## DAILY OPERATING CHECKLIST

- [ ] Telegram: any 💸/🔥 insider alerts overnight? (act only if still fillable near the price)
- [ ] `node paper-reconcile.mjs` — settle resolved markets, refresh scorecard
- [ ] Check `/stats`: win rate + ROI tracking the backtest? Drawdown tolerable?
- [ ] Favorites: the daily scan auto-runs; confirm it deployed ≤50% bankroll, diversified
- [ ] Weekly: re-run `node proof.mjs` — edges still significant? If favorites z drops below ~10, PAUSE.

---

## KILL CONDITIONS (stop trading, investigate)

- Paper/live ROI goes **negative over 100+ trades** → the edge may have decayed. Stop.
- `proof.mjs` favorites z-score **drops below ~10** → structural edge weakening. Pause.
- Drawdown exceeds **your comfort** (e.g., 20% of bankroll) → halve size or stop.
- Any executor error you don't understand → kill it (`pm2 stop all`), dry-run, debug.

---

## THE RULES (that keep you solvent)

1. **Never oversize.** Quarter-Kelly, ≤5% bankroll/bet, ≤$25/order live. The caps exist for a reason.
2. **Always diversify.** ≤1 position per event, ≤30% per category, ≤50% deployed. One upset ≠ ruin.
3. **Favorites first.** It's the bulletproof edge. Informed-money is the risky bonus.
4. **Paper before real, small before big, always.**
5. **The edge is real; the discipline is on you.** Most people who lose had an edge and blew the sizing.
