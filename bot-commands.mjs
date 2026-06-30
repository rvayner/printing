// bot-commands.mjs — make the Telegram bot interactive. Reply to:
//   /stats         → live paper-trading scorecard
//   /top [cat]     → best validated wallets (optionally by category)
//   /help          → command list
//
// Run alongside signals.mjs (pm2 manages both).
//   node --env-file=.env bot-commands.mjs
//   node --env-file=.env bot-commands.mjs --once   # single poll (for testing)

import { existsSync, readFileSync } from 'node:fs';
import { PaperBook, sparkline } from './src/paper.mjs';
import { formatLeaderboards } from './src/leaderboard.mjs';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) { console.error('Missing TELEGRAM_BOT_TOKEN (set it in .env).'); process.exit(1); }
const ONCE = process.argv.includes('--once');
const PAPER_PATH = new URL('./paper-positions.json', import.meta.url).pathname;
const VALID_PATH = new URL('./validated-wallets.json', import.meta.url).pathname;

async function api(method, params) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params || {}),
    });
    return await r.json();
  } catch (e) { return { ok: false, error: e.message }; }
}
const reply = (chatId, text) => api('sendMessage', { chat_id: chatId, text, disable_web_page_preview: true });

function statsText() {
  const book = new PaperBook(PAPER_PATH);
  const r = book.report();
  if (!r.nClosed && !r.nOpen) return '📈 No paper positions yet. Start the watcher: signals.mjs --paper';
  return [
    '📈 Paper scorecard',
    `Open ${r.nOpen} · Closed ${r.nClosed}`,
    r.nClosed ? `Win ${(r.winRate * 100).toFixed(1)}% · ROI ${(r.roi * 100 >= 0 ? '+' : '')}${(r.roi * 100).toFixed(1)}% · P&L ${r.pnl >= 0 ? '+' : ''}$${r.pnl.toFixed(0)}` : '',
    r.nClosed ? `Max drawdown $${r.maxDrawdown.toFixed(0)}` : '',
    r.nClosed ? `Equity ${sparkline(r.curve)}` : '',
    r.nClosed < 200 ? '\n⚠️ Sample still small — trust only after hundreds of closed trades.' : '',
  ].filter(Boolean).join('\n');
}

function topText(cat) {
  if (!existsSync(VALID_PATH)) return 'No validated wallets yet. Run run.mjs first.';
  const meta = JSON.parse(readFileSync(VALID_PATH));
  let boards = meta.leaderboards || {};
  if (cat) boards = boards[cat] ? { [cat]: boards[cat] } : {};
  return '🏆 Top specialists' + (cat ? ` (${cat})` : '') + '\n' + formatLeaderboards(boards);
}

function handle(text) {
  const [cmd, arg] = text.trim().split(/\s+/);
  if (cmd === '/stats') return statsText();
  if (cmd === '/top') return topText(arg?.toLowerCase());
  if (cmd === '/help' || cmd === '/start') return 'Commands:\n/stats — live paper scorecard\n/top [category] — best validated wallets\n/help — this message';
  return null;
}

let offset = 0;
async function poll() {
  const res = await api('getUpdates', { offset, timeout: ONCE ? 0 : 25 });
  for (const u of res.result || []) {
    offset = u.update_id + 1;
    const m = u.message;
    if (!m?.text) continue;
    const out = handle(m.text);
    if (out) await reply(m.chat.id, out);
  }
}

console.log('Telegram command bot listening (/stats, /top, /help)…');
if (ONCE) { await poll(); }
else { for (;;) { await poll(); } }
