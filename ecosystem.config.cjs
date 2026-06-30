// pm2 process definitions — runs the whole bot 24/7 with one command:
//   pm2 start ecosystem.config.cjs
// pm2 keeps the watcher alive (restarts on crash/reboot), and runs the periodic
// reconcile + re-validation on a schedule. Works on Windows/macOS/Linux.
// Requires Node 22 in PATH and a filled-in .env (see .env.example).

module.exports = {
  apps: [
    {
      // live watcher — always on, paper-trading every alert
      name: 'whale-signals',
      script: 'signals.mjs',
      args: '--paper',
      node_args: '--env-file=.env',
      cwd: __dirname,
      autorestart: true,
      max_restarts: 100,
      restart_delay: 5000,
    },
    {
      // interactive Telegram commands (/stats, /top) — always on
      name: 'whale-commands',
      script: 'bot-commands.mjs',
      node_args: '--env-file=.env',
      cwd: __dirname,
      autorestart: true,
      max_restarts: 100,
      restart_delay: 5000,
    },
    {
      // close settled paper positions + refresh scorecard, every 30 min
      name: 'whale-reconcile',
      script: 'paper-reconcile.mjs',
      node_args: '--env-file=.env',
      cwd: __dirname,
      autorestart: false,
      cron_restart: '*/30 * * * *',
    },
    {
      // re-validate wallets daily (track records grow) + text the morning briefing
      name: 'whale-revalidate',
      script: 'run.mjs',
      args: '--since 2026-01-01 --markets 300 --notify',
      node_args: '--env-file=.env',
      cwd: __dirname,
      autorestart: false,
      cron_restart: '0 6 * * *',
    },
  ],
};
