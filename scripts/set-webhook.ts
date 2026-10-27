import 'dotenv/config';
import { getConfig } from '../src/config.js';
import { Telegram } from '../src/telegram.js';

try {
  const config = getConfig();
  const url = new URL(process.env.APP_URL ?? '');
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('APP_URL harus domain HTTPS production Vercel.');
  const telegram = new Telegram(config.token);
  const webhookUrl = new URL('/api/telegram', url).href;
  await telegram.call('setWebhook', {
    url: webhookUrl, secret_token: config.webhookSecret,
    allowed_updates: ['message'], max_connections: 1,
    drop_pending_updates: false
  });
  await telegram.call('setMyCommands', { commands: [
    { command: 'start', description: 'Petunjuk penggunaan bot' },
    { command: 'help', description: 'Bantuan upload CSV' },
    { command: 'report', description: 'Kirim ulang laporan terbaru' }
  ] });
  const info = await telegram.call<{ url: string; pending_update_count: number; last_error_message?: string }>('getWebhookInfo', {});
  console.log(`Webhook terdaftar: ${info.url}`);
  console.log(`Update menunggu: ${info.pending_update_count}`);
  if (info.last_error_message) console.log('Telegram masih mencatat error sebelumnya. Uji /start untuk memeriksa koneksi saat ini.');
} catch (error) {
  console.error(error instanceof Error && !error.message.includes('://') ? error.message : 'Pendaftaran webhook gagal. Periksa environment dan APP_URL.');
  process.exitCode = 1;
}
