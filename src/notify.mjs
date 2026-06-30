// notify.mjs — push alerts to Telegram, Discord, and/or Slack based on env vars.
// Set whichever you want; all configured channels fire. Console always prints.
//
//   Telegram:  TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
//   Discord:   DISCORD_WEBHOOK_URL   (or legacy WEBHOOK_URL)
//   Slack:     SLACK_WEBHOOK_URL

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT = process.env.TELEGRAM_CHAT_ID;
const DISCORD = process.env.DISCORD_WEBHOOK_URL || process.env.WEBHOOK_URL;
const SLACK = process.env.SLACK_WEBHOOK_URL;

export function configuredChannels() {
  const c = [];
  if (TG_TOKEN && TG_CHAT) c.push('Telegram');
  if (DISCORD) c.push('Discord');
  if (SLACK) c.push('Slack');
  return c;
}

async function post(url, body) {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) console.error(`  (alert ${url.split('/')[2]} → ${res.status})`);
  } catch (e) { console.error(`  (alert failed: ${e.message})`); }
}

export async function sendAlert(text) {
  console.log(text);
  const jobs = [];
  if (TG_TOKEN && TG_CHAT) {
    jobs.push(post(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`,
      { chat_id: TG_CHAT, text, disable_web_page_preview: true }));
  }
  if (DISCORD) jobs.push(post(DISCORD, { content: text }));
  if (SLACK) jobs.push(post(SLACK, { text }));
  await Promise.allSettled(jobs);
}
