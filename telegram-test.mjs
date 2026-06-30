// telegram-test.mjs — verify your Telegram bot before deploying the watcher.
//   node --env-file=.env telegram-test.mjs            # send a "bot is alive" message
//   node --env-file=.env telegram-test.mjs --whoami   # list chats/channels that can
//                                                       receive (find your chat_id)
//
// Works for a private chat OR a channel: for a channel, add the bot as an admin
// and set TELEGRAM_CHAT_ID to the channel's @username or its -100… numeric id.

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT = process.env.TELEGRAM_CHAT_ID;
const WHOAMI = process.argv.includes('--whoami');

if (!TOKEN) {
  console.error('Missing TELEGRAM_BOT_TOKEN. Get it from @BotFather, put it in .env, run with --env-file=.env');
  process.exit(1);
}

async function api(method, params) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params || {}),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && data.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, networkError: e.message };
  }
}

if (WHOAMI) {
  const r = await api('getUpdates');
  if (r.networkError) { console.error('No network to Telegram:', r.networkError); process.exit(1); }
  if (!r.ok) { console.error('getUpdates failed:', r.data?.description || r.status); process.exit(1); }
  const chats = new Map();
  for (const u of r.data.result || []) {
    const c = u.message?.chat || u.channel_post?.chat || u.my_chat_member?.chat;
    if (c) chats.set(c.id, c);
  }
  if (!chats.size) {
    console.log('No chats yet. Message your bot once (send "hi"), or post in the channel with the bot as admin, then re-run --whoami.');
    process.exit(0);
  }
  console.log('Chats/channels your bot can reach:');
  for (const [id, c] of chats) console.log(`  TELEGRAM_CHAT_ID=${id}   (${c.type}: ${c.title || c.username || c.first_name || ''})`);
  console.log('\nCopy the right id into .env, then run without --whoami to send a test.');
  process.exit(0);
}

if (!CHAT) {
  console.error('Missing TELEGRAM_CHAT_ID. Find it with:  node --env-file=.env telegram-test.mjs --whoami');
  process.exit(1);
}

const r = await api('sendMessage', { chat_id: CHAT, text: '✅ whale-tracker bot is alive — alerts will arrive here.' });
if (r.networkError) { console.error('No network to Telegram:', r.networkError); process.exit(1); }
if (r.ok) {
  console.log('Sent! Check Telegram — you should see the test message.');
} else {
  console.error('Failed:', r.data?.description || r.status);
  console.error('Common fixes: token typo · you must message the bot first · wrong chat_id (try --whoami) · for a channel, add the bot as an admin.');
  process.exit(1);
}
