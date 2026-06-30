# Deploying whale-tracker

End-to-end deploy on an always-on machine (spare PC / VPS / Pi). Zero npm deps —
just Node 22. The whole bot runs under pm2.

## 0. Prove it first (no network, 1 min)

```bash
node simulate.mjs       # gates validate skill, reject luck
node algo-sim.mjs       # scored beats naive
node montecarlo.mjs     # scoring beats naive in ~90%+ of worlds
```
These prove the *logic*. They do NOT prove real wallets have edge — only live data does.

## 1. Get the code on the box

```bash
git clone <your private repo>   # or copy the folder / unzip
cd whale-tracker
node --version                  # must be v22+
```

## 2. Configure Telegram

```bash
cp .env.example .env
# fill TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID (from @BotFather; see README)
node --env-file=.env telegram-test.mjs     # phone should buzz
```

## 3. Find validated wallets (the real test)

```bash
node --env-file=.env run.mjs --since 2026-01-01 --markets 300
```
- Prints per-category specialist leaderboards + writes `validated-wallets.json`.
- **✅ safeToFollow** → wallets exist to track.
- **⛔** → no statistically-proven, persistent wallets. The bot stays silent. This
  is the system being honest, not broken — do not override it.

## 4. Launch everything (pm2)

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs    # signals + commands + reconcile + daily revalidate
pm2 save
pm2 startup                       # run the printed line → auto-start on reboot
pm2 logs whale-signals            # watch it live
```

Four processes start:
| process | role |
|---|---|
| `whale-signals` | watches wallets, scores signals, alerts + paper-trades |
| `whale-commands` | answers `/stats`, `/top [category]`, `/help` from your phone |
| `whale-reconcile` | closes settled paper positions every 30 min |
| `whale-revalidate` | re-runs `run.mjs` daily (track records grow) |

## 5. Operate from your phone

- `/stats` → live paper scorecard (win %, ROI, drawdown, equity curve)
- `/top politics` → best validated wallets in a category
- Alerts arrive automatically, each with a 0–100 score + edge confidence interval.

## 6. Go-live criteria (do NOT skip)

Stay in **paper mode for weeks/months**. Only consider real money when
`/stats` shows, over **hundreds-to-thousands of closed trades**:
- positive ROI after the built-in slippage,
- a drawdown you can stomach,
- win rate consistent with the scored backtest.

A few dozen wins prove nothing (a real edge lost money over 300 trades in testing).
The large-sample paper scorecard is the only judge. Start real money tiny.
