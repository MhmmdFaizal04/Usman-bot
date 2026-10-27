import type { ApiRequest, ApiResponse } from '../src/http.js';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { getConfig } from '../src/config.js';
import { InputError, parseSnapshot, resolveReportDate, validDate } from '../src/report.js';
import { database, Store } from '../src/store.js';
import { Telegram, TelegramError, type TelegramUpdate } from '../src/telegram.js';
import { parseValinsArguments, parseValinsWorkbook } from '../src/valins.js';

const HELP = [
  '👋 Bot laporan Sulbagsel', '',
  'PILIH FITUR',
  '/unspec — petunjuk laporan UNSPEC dari CSV',
  '/valins — dua laporan VALINS dari Excel (default PARE-PARE)',
  '/valins_visit — laporan VALINS VISIT ODP tersimpan',
  '/valins_dc — laporan VALINS DC QR CODE & SERVICE tersimpan',
  'Tambahkan branch jika perlu: /valins bone, /valins makassar, /valins kendari, /valins semua.',
  'Upload .xlsx otomatis membaca Sheet1 dan mengirim kedua laporan VALINS PARE-PARE. Growth/H-1 VALINS berasal langsung dari Excel.', '',
  'Kirim CSV sebagai dokumen untuk mendapatkan 4 laporan: BONE, KENDARI, MAKASSAR, dan PARE-PARE.',
  'CSV lama maupun baru dapat diproses. Tanpa caption, tanggal laporan mengikuti waktu pengiriman dokumen (WITA).',
  'Untuk data hari lain, beri caption tanggal=YYYY-MM-DD saat mengirim CSV. Contoh: file tanggal 25 diberi caption tanggal=2026-10-25, lalu file tanggal 26 diberi caption tanggal=2026-10-26 agar H-1 muncul.',
  'Caption berupa tanggal saja, seperti 2026-10-25, juga diterima.',
  'Upload berkali-kali diperbolehkan. File terakhir menjadi snapshot hari tersebut. Saldo H-1 menggunakan snapshot hari sebelumnya di chat yang sama.', '',
  '/report — kirim ulang laporan terbaru',
  '/report 2026-10-27 — laporan tanggal tertentu',
  '/menu atau /help — petunjuk penggunaan', '',
  'Kolom wajib: INCIDENT dan WORKZONE. Jika SUMMARY tersedia, hanya tiket UNSPEC yang dihitung. Tiket berstatus CLOSED/RESOLVED/CANCELLED dikecualikan. CSV maksimal 10 MB.',
  'Upload harus berupa export lengkap karena STO yang tidak muncul dihitung saldo 0. Data LIS mengacu master dashboard.'
].join('\n');

function verifySecret(actual: unknown, expected: string): boolean {
  if (typeof actual !== 'string') return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  const started = Date.now();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const config = getConfig();
    if (!verifySecret(req.headers['x-telegram-bot-api-secret-token'], config.webhookSecret)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    let update: TelegramUpdate;
    try { update = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as TelegramUpdate; }
    catch { res.status(400).json({ error: 'Invalid JSON' }); return; }
    if (!update || !Number.isSafeInteger(update.update_id)) {
      res.status(400).json({ error: 'Invalid update' });
      return;
    }
    const message = update.message;
    if (!message?.from || message.from.is_bot || !Number.isSafeInteger(message.chat?.id) ||
        !Number.isSafeInteger(message.date) || !Number.isSafeInteger(message.message_id)) {
      res.status(200).json({ ok: true }); return;
    }
    const chatId = String(message.chat.id);
    const store = new Store(database(config.databaseUrl));
    const telegram = new Telegram(config.token);
    let job = await store.getJob(update.update_id);
    if (!job) {
      try {
        if (message.document) {
          const reportDate = resolveReportDate(message.caption, message.date);
          const filename = message.document.file_name?.toLowerCase() ?? '';
          if (filename.endsWith('.xlsx')) {
            const bytes = await telegram.downloadXlsx(message.document);
            const snapshot = await parseValinsWorkbook(bytes);
            await store.prepareValinsUpload(update.update_id, chatId, message.message_id, message.date, snapshot, reportDate);
          } else if (filename.endsWith('.csv')) {
            const csv = await telegram.downloadCsv(message.document);
            const snapshot = parseSnapshot(csv);
            await store.prepareUpload(update.update_id, chatId, message.message_id, message.date, snapshot, reportDate);
          } else {
            throw new InputError('Kirim .csv untuk UNSPEC atau .xlsx untuk VALINS.');
          }
        } else {
          const [rawCommand, date, ...extra] = (message.text ?? '').trim().split(/\s+/);
          const command = rawCommand?.split('@')[0]?.toLowerCase();
          let messages: string[];
          if (command === '/valins' || command === '/valins_visit' || command === '/valins_dc') {
            const options = parseValinsArguments([date, ...extra].filter((value): value is string => Boolean(value)));
            const kind = command === '/valins_visit' ? 'visit' : command === '/valins_dc' ? 'dc' : 'all';
            messages = await store.valinsReport(chatId, kind, options.scope, options.date);
          } else if (command === '/report') {
            if (extra.length || (date && !validDate(date))) throw new InputError('Gunakan /report atau /report YYYY-MM-DD dengan tanggal yang valid.');
            messages = await store.report(chatId, date);
          } else {
            messages = [HELP];
          }
          await store.prepareMessages(update.update_id, chatId, messages);
        }
      } catch (error) {
        if (!(error instanceof InputError)) throw error;
        await store.prepareMessages(update.update_id, chatId, [`❌ ${error.message}\n\nSnapshot valid sebelumnya tidak diubah.`]);
      }
      job = await store.getJob(update.update_id);
    }
    if (!job) throw new Error('Job belum tersedia.');
    if (job.delivered >= job.messages.length) { res.status(200).json({ ok: true }); return; }
    const owner = randomUUID();
    const claimed = await store.claim(update.update_id, owner);
    if (!claimed) { res.status(503).json({ error: 'Update sedang diproses, coba ulang.' }); return; }
    try {
      for (let index = claimed.delivered; index < claimed.messages.length; index++) {
        // Stop before Vercel's time limit; Telegram can retry and resume unsent messages.
        if (Date.now() - started > 45000) {
          res.status(503).json({ error: 'Pemrosesan akan dilanjutkan.' });
          return;
        }
        await telegram.send(chatId, claimed.messages[index]!, message.message_thread_id);
        await store.advance(update.update_id, owner, index + 1, index + 1 === claimed.messages.length);
        // Telegram limits consecutive messages to the same chat.
        if (index + 1 < claimed.messages.length) await new Promise(resolve => setTimeout(resolve, 1100));
      }
    } finally {
      await store.release(update.update_id, owner);
    }
    res.status(200).json({ ok: true });
  } catch (error) {
    // Never log raw CSV, customer records, database URLs, or fetch errors containing the bot token.
    console.error('Webhook gagal:', error instanceof TelegramError ? error.message : 'Kesalahan konfigurasi, database, atau pemrosesan.');
    if (error instanceof TelegramError && error.retryAfter) res.setHeader('Retry-After', String(error.retryAfter));
    res.status(503).json({ error: 'Pemrosesan gagal sementara. Telegram akan mencoba ulang.' });
  }
}
