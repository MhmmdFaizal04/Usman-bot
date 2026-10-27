import type { ApiRequest, ApiResponse } from '../src/http.js';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { getConfig } from '../src/config.js';
import { InputError, parseSnapshot, resolveReportDate, validDate } from '../src/report.js';
import { database, Store } from '../src/store.js';
import { Telegram, TelegramError, type TelegramUpdate } from '../src/telegram.js';
import { parseValinsArguments, parseValinsWorkbook } from '../src/valins.js';
import { mainMenu, parseMenuAction, valinsKind, type MenuAction } from '../src/menu.js';
import type { OutgoingMessage } from '../src/messages.js';

const HELP = [
  '📖 PANDUAN SINGKAT', '',
  'MEMBUAT LAPORAN',
  '1. Ketik /start atau /menu.',
  '2. Pilih jenis laporan, lalu upload file sebagai dokumen.',
  '3. Setelah file diproses, pilih branch atau Cetak Semua.', '',
  '📎 FORMAT FILE',
  '• UNSPEC: CSV (.csv), gunakan export lengkap.',
  '• VALINS ODP / DC: Excel (.xlsx), data di Sheet1.',
  '• Ukuran file maksimal 10 MB.', '',
  '📅 TANGGAL DATA',
  'Tanpa caption, data disimpan pada tanggal upload WITA.',
  'Untuk tanggal lain, isi caption 2026-10-26 atau tanggal=2026-10-26 saat mengirim file.',
  'Anda boleh upload beberapa kali; file terakhir menjadi acuan tanggal tersebut.', '',
  '📈 PEMBANDING H-1',
  '• UNSPEC: menggunakan data tanggal sebelumnya di chat yang sama.',
  '• VALINS: menggunakan nilai H-1 yang tersedia di Excel.', '',
  '🖨 CETAK ULANG',
  'Gunakan tombol Cetak Ulang atau Ganti Branch setelah laporan dicetak.',
  'Untuk memilih tanggal: /report 2026-10-26 atau /valins bone 2026-10-26.'
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
    const callback = update.callback_query;
    const message = callback?.message ?? update.message;
    const actor = callback?.from ?? message?.from;
    if (!actor || actor.is_bot || !Number.isSafeInteger(actor.id) || !message || !Number.isSafeInteger(message.chat?.id) ||
        !Number.isSafeInteger(message.date) || !Number.isSafeInteger(message.message_id)) {
      res.status(200).json({ ok: true }); return;
    }
    const chatId = String(message.chat.id);
    const userId = String(actor.id);
    const threadId = message.message_thread_id ?? 0;
    const store = new Store(database(config.databaseUrl));
    const telegram = new Telegram(config.token);
    if (callback) await telegram.answerCallback(callback.id);
    let job = await store.getJob(update.update_id);
    if (!job) {
      try {
        if (callback) {
          await store.prepareMenu(update.update_id, chatId, userId, threadId, parseMenuAction(callback.data ?? ''));
        } else if (message.document) {
          const preference = await store.getPreference(chatId, userId, threadId);
          const reportDate = resolveReportDate(message.caption, message.date);
          const filename = message.document.file_name?.toLowerCase() ?? '';
          if (filename.endsWith('.xlsx')) {
            if (preference?.kind === 'unspec') throw new InputError('Pilihan Anda UNSPEC. Kirim CSV (.csv), atau gunakan /start untuk memilih VALINS.');
            const bytes = await telegram.downloadXlsx(message.document);
            const snapshot = await parseValinsWorkbook(bytes);
            const kind = preference?.kind ?? 'valins_all';
            await store.prepareValinsUpload(update.update_id, chatId, message.message_id, message.date, snapshot, reportDate,
              valinsKind(kind), 'PARE-PARE', { kind, userId, threadId });
          } else if (filename.endsWith('.csv')) {
            if (preference && preference.kind !== 'unspec') throw new InputError('Pilihan Anda VALINS. Kirim Excel (.xlsx), atau gunakan /start untuk memilih UNSPEC.');
            const csv = await telegram.downloadCsv(message.document);
            const snapshot = parseSnapshot(csv);
            await store.prepareUpload(update.update_id, chatId, message.message_id, message.date, snapshot, reportDate,
              'SEMUA', { kind: 'unspec', userId, threadId });
          } else {
            throw new InputError('Kirim .csv untuk UNSPEC atau .xlsx untuk VALINS.');
          }
        } else {
          const [rawCommand, date, ...extra] = (message.text ?? '').trim().split(/\s+/);
          const command = rawCommand?.split('@')[0]?.toLowerCase();
          let menu: MenuAction | null = null;
          if (command === '/start' || command === '/menu') menu = { type: 'main' };
          else if (command === '/unspec') menu = { type: 'kind', kind: 'unspec' };
          else if (!date && (command === '/valins' || command === '/valins_visit' || command === '/valins_dc')) {
            menu = { type: 'kind', kind: command === '/valins_visit' ? 'valins_visit' : command === '/valins_dc' ? 'valins_dc' : 'valins_all' };
          }
          if (menu) {
            await store.prepareMenu(update.update_id, chatId, userId, threadId, menu);
          } else {
            let messages: OutgoingMessage[];
            if (command === '/valins' || command === '/valins_visit' || command === '/valins_dc') {
              const options = parseValinsArguments([date, ...extra].filter((value): value is string => Boolean(value)));
              const kind = command === '/valins_visit' ? 'visit' : command === '/valins_dc' ? 'dc' : 'all';
              messages = await store.valinsReport(chatId, kind, options.scope, options.date);
            } else if (command === '/report') {
              if (extra.length || (date && !validDate(date))) throw new InputError('Gunakan /report atau /report YYYY-MM-DD dengan tanggal yang valid.');
              const preference = await store.getPreference(chatId, userId, threadId);
              messages = await store.report(chatId, date ?? preference?.date ?? undefined, preference?.kind === 'unspec' && preference.scope ? preference.scope : 'SEMUA');
            } else {
              messages = [HELP, mainMenu()];
            }
            await store.prepareMessages(update.update_id, chatId, messages);
          }
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
