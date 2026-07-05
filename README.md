# whale-tracker — follow *consistently skilled* Polymarket wallets

A system to find prediction-market wallets with a **statistically real, persistent
edge** and follow their new bets — without falling for the trap that kills most
copy-traders: mistaking luck for skill.

## The honest thesis

Following whales *can* work, but only a narrow version:
- **Not** "biggest trade" — we proved (see `../kalshi-whale-follow.mjs`) that size
  alone has zero predictive power and loses after slippage.
- **Yes** "wallets that beat the market's OWN prices, by a margin too large to be
  luck, and keep doing it out-of-sample" — on slower markets where their
  information edge hasn't fully diffused into the price yet.

The whole game is the second clause. This system is mostly a **skill detector**,
not a trade copier.

## Three gates that separate skill from luck

1. **Calibration edge (skill.mjs).** A wallet's entry price IS a probability
   prediction. If they win MORE than their entry prices implied, by a z-score too
   big to be chance, they have edge. `z = (wins − Σprice) / √Σ price(1−price)`.
2. **Multiple-testing correction (skill.mjs).** Test 10,000 wallets and dozens
   look "skilled" by pure chance. We require significance AFTER a Bonferroni/FDR
   correction for the number of wallets screened.
3. **Out-of-sample persistence (persistence.mjs).** THE make-or-break test. Rank
   wallets on an older period, then check if the top ones STILL outperform on a
   newer period they didn't influence the ranking with. If top-half winners don't
   persist into the second half, there is no skill to follow — full stop.

Only wallets that clear all three become "validated." `backtest.mjs` then asks the
only question that matters: would following validated wallets' *new* bets, entering
at a realistic (worse) price, have made money out-of-sample?

## Data

- **Polymarket** (on-chain, free): `polymarket.mjs` targets the public Data API
  (`data-api.polymarket.com`) for wallet trades + positions and Gamma for market
  resolutions. This is where individual traders ARE identifiable (Kalshi is
  anonymous — it cannot be part of this).
- Real runs need live network access to Polymarket. In a sandbox, use
  `simulate.mjs` to prove the statistical machinery works before pointing it at
  real money.

## Run — full workflow

```bash
# 0. Prove the gates work (no network): validates skilled, rejects lucky.
node simulate.mjs

# 1. Find validated wallets on REAL data (needs internet). Writes
#    validated-wallets.json with safeToFollow=true ONLY if the evidence holds.
node run.mjs --since 2026-01-01 --markets 300

# 2. Watch them live. Refuses to run unless step 1 said safeToFollow.
#    Alerts only when a validated wallet opens a STILL-followable bet.
node signals.mjs                 # live loop
node signals.mjs --once          # single poll
node signals.mjs --demo          # see an alert fire, no network
WEBHOOK_URL=https://… node signals.mjs   # push alerts to Discord/Slack/Telegram
```

The chain is self-gating: `run.mjs` won't mark wallets followable without
validation + persistence + positive out-of-sample backtest, and `signals.mjs`
won't watch wallets that aren't followable. No proven edge → no alerts. By design.

## Paper trading (prove the live edge risk-free)

```bash
# Fast forward-test at scale, no network — see a few thousand trades resolve:
node paper-sim.mjs --signals 4000        # real edge → converges positive
node paper-sim.mjs --edge 0              # null world → trades nothing

# Live paper trading: log every alert as a simulated position…
node signals.mjs --paper                 # writes paper-positions.json
# …then resolve settled markets + see your scorecard (run on a schedule):
node paper-reconcile.mjs
```

**The lesson paper-sim proves:** a genuine edge can LOSE over a few hundred trades
(variance), and only surfaces over thousands. 300 trades ≈ −3%; 4000 ≈ +9%. Do not
trust a paper record until it has hundreds-to-thousands of closed trades.

## The scoring algorithm (signal quality, not just "a whale bet")

Every live signal is scored 0-100 before it alerts you (`src/score.mjs`):
- **Proven edge** (40%) — lower bound of a 95% CI on the wallet's true edge.
  Statistically significant or it scores ~0.
- **Category fit** (20%) — the wallet's edge *in this market's category* (a
  politics specialist scores low on a crypto bet).
- **Conviction** (20%) — bet size vs the wallet's own median AND vs market depth.
- **Entry quality** (20%) — can you still buy near the whale's price?

Only signals ≥ `MIN_SCORE` (default 60) alert/paper-trade. A **surge** (🚨) fires
when ≥2 validated wallets converge on the same outcome — the strongest signal.

**Anti-manipulation (src/verify.mjs):** every signal is checked for price-*swinging*
— round-tripping (bought AND sold the same market), price-impact (bet too big vs
liquidity, moved the price itself), and isolation (no corroborating wallets). HIGH
risk is suppressed automatically; MEDIUM is flagged in the alert.

**Exit signals:** when a wallet you followed SELLS the outcome, you get a 🔻 EXIT
alert and the paper position closes at their sell price — so you know to get out too.

**Position sizing (src/sizing.mjs):** alerts include a suggested $ size via fractional
(¼) Kelly on the conservative edge, capped at `MAX_BANKROLL_FRAC` and the liquidity
fill cap. `kelly-sim.mjs` shows the honest case: under edge decay, flat sizing ruins
~15% of the time vs ~4% for Kelly — sizing is about SURVIVAL, not bigger mean returns.

**Circuit breaker (src/breaker.mjs):** live alerts auto-pause if the daily walk-forward
flips to FAIL or goes stale (>7 days). The bot can't keep signaling a decayed edge.

```bash
# Prove scoring beats naive "follow everything" (no network):
node algo-sim.mjs
# typical: SCORED ~2x the ROI of NAIVE on fewer trades + smaller drawdown
```

## Automate it (run unattended)

```bash
# keep the watcher alive (macOS/Linux):
nohup node signals.mjs --paper > signals.log 2>&1 &

# reconcile + refresh validated wallets on a schedule (crontab -e):
*/30 * * * * cd ~/Projects/oddpool-arb/whale-tracker && node paper-reconcile.mjs >> paper.log 2>&1
0 6 * * *   cd ~/Projects/oddpool-arb/whale-tracker && node run.mjs --since 2026-01-01 --markets 300 >> run.log 2>&1
```

`run.mjs` re-validates daily (track records grow), `signals.mjs` watches live,
`paper-reconcile.mjs` marks results every 30 min. Let it compound a track record
for weeks before believing any number.

## Running it 24/7 on an always-on Mac (paper mode) — resilience & recovery

The favorites paper trade runs from cron. Activation (already done on this machine):

```bash
# in crontab -e  (uses the Node 22 nvm path):
0 13 * * *  cd ~/Projects/oddpool-arb/whale-tracker && <node22> favorites-scan.mjs --top 20 --paper >> paper.log 2>&1
30 */6 * * * cd ~/Projects/oddpool-arb/whale-tracker && <node22> paper-reconcile.mjs >> paper.log 2>&1
```

### Keep the Mac awake (critical — cron does NOT run during sleep)
"Powered on" ≠ "awake." macOS sleeps after inactivity and cron jobs are skipped
(not caught up). Make it permanent so it survives reboots:

```bash
sudo pmset -c sleep 0      # never sleep on power (run in the real Terminal app for the password)
```
Or GUI: System Settings → Battery → Options → "Prevent automatic sleeping on power
adapter when display is off." Temporary stopgap (dies on reboot):
`nohup caffeinate -i > /dev/null 2>&1 & disown`.

### What happens on power loss / reboot / battery
- **Open positions are safe** — saved in `paper-positions.json`, nothing lost.
- **Cron auto-resumes on reboot** — the crontab persists; scanning + reconciling
  restart automatically once you log back in. Nothing to restart.
- **The only thing a reboot kills is a temporary `caffeinate`** — which is why the
  permanent `pmset -c sleep 0` matters. With it set, reboots are fully handled.
- **On battery / WiFi off / brief shutdown** — those runs just skip. Harmless for
  paper: markets still resolve and the next reconcile catches up.

### Checking on it / manual controls
```bash
cd ~/Projects/oddpool-arb/whale-tracker
crontab -l                          # confirm jobs are scheduled
node paper-reconcile.mjs --report   # scorecard: win rate, ROI, P&L
node favorites-scan.mjs --paper     # manually open a fresh batch
tail -20 paper.log                  # what the cron jobs have done
```

Check weekly. After ~2–4 weeks / 50–100+ closed trades, compare the live win-rate
and ROI to the backtest (87% / ~+9%). Only if they match → do the $1 canary
(`clob-check.mjs` first) before any real money. Paper only until then.

## The bar, stated honestly

Even a validated wallet is "follow with realistic expectations of a small, risky
edge," not a sure thing. The system's most valuable output may be telling you
**no wallet clears the bar** — which is a real, money-saving answer. Trust the
out-of-sample backtest over any in-sample win rate.
