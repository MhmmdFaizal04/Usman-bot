import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/telegram.js';
import type { ApiRequest, ApiResponse } from '../src/http.js';
import { Store, type Job } from '../src/store.js';
import { Telegram, TelegramError, type TelegramMessage } from '../src/telegram.js';
import type { SheetData } from 'read-excel-file/node';
import { workbookBytes } from './helpers/xlsx.js';
import type { ReportPreference } from '../src/menu.js';
import type { OutgoingMessage } from '../src/messages.js';

test('webhook verifies the secret and accepts all users without an account allowlist', async t => {
  const original = { ...process.env };
  Object.assign(process.env, {
    TELEGRAM_BOT_TOKEN: 'test', TELEGRAM_WEBHOOK_SECRET: 'test_secret_12345678',
    DATABASE_URL: 'postgresql://not-connected'
  });
  const lookup = t.mock.method(Store.prototype, 'getJob', async (updateId: number) => ({
    update_id: String(updateId), chat_id: 'test', messages: ['already sent'], delivered: 1
  }));
  const run = async (method: string, secret: string, body: unknown): Promise<number> => {
    let status = 0;
    const res = {
      setHeader() {}, status(code: number) { status = code; return this; }, json() { return this; }
    } as unknown as ApiResponse;
    await handler({ method, headers: { 'x-telegram-bot-api-secret-token': secret }, body } as unknown as ApiRequest, res);
    return status;
  };
  try {
    assert.equal(await run('GET', '', {}), 405);
    assert.equal(await run('POST', 'wrong-secret', {}), 401);
    assert.equal(await run('POST', 'test_secret_12345678', '{bad json'), 400);
    assert.equal(await run('POST', 'test_secret_12345678', {}), 400);
    assert.equal(await run('POST', 'test_secret_12345678', {
      update_id: 1, message: { from: { id: 999 }, chat: { id: 999 }, date: 1, message_id: 1, text: '/start' }
    }), 200);
    assert.equal(await run('POST', 'test_secret_12345678', {
      update_id: 2, message: { from: { id: 100 }, chat: { id: -100999 }, date: 1, message_id: 2, text: '/start' }
    }), 200);
    assert.equal(lookup.mock.callCount(), 2);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
    Object.assign(process.env, original);
  }
});

test('XLSX upload is parsed and stored as VALINS; VALINS command selects the requested report', async t => {
  const original = { ...process.env };
  Object.assign(process.env, {
    TELEGRAM_BOT_TOKEN: 'test', TELEGRAM_WEBHOOK_SECRET: 'test_secret_12345678', DATABASE_URL: 'postgresql://not-connected'
  });
  const rows: SheetData = [];
  const metrics = (label: string): SheetData[number] => [
    null,label,100,90,10,.9,0,0,0,1,92.27,.95,.94,.01,label,1000,950,null,960,950,940,50,95,.94,.95,-.01
  ];
  for (const [branch, sto] of [['BONE','WTP'],['KENDARI','KDR'],['MAKASSAR','BAL'],['PARE-PARE','WON']]) {
    rows.push(
      [null,'VALINS VISIT ODP',null,null,null,null,null,null,null,null,null,'TOTAL',null,'GROWTH','VALINS DC QR CODE & SERVICE'],
      [null,'SA / STO','ONT BARU','VALINS PSB','BELUM VALINS','REAL','ONT BERUBAH PORT','VALINS OMSET','BELUM VALINS','REAL','TARGET',null,null,null,'SA / STO','ONT IN SERVICE','QR CODE VALINS',null,'SUDAH VALINS','VALINS To UIM','SUCCESS UIM','BELUM VALINS','TARGET'],
      [null,null,null,null,null,null,null,null,null,null,null,'H','H-1',null,null,null,null,null,null,null,null,null,null,'H','H-1'],
      metrics(sto!), metrics(branch!)
    );
  }
  const lookups = new Map<number, number>();
  t.mock.method(Store.prototype, 'getJob', async (id: number) => {
    const count = lookups.get(id) ?? 0;
    lookups.set(id, count + 1);
    return count ? { update_id: String(id), chat_id: '123', messages: ['prepared'], delivered: 1 } : null;
  });
  const download = t.mock.method(Telegram.prototype, 'downloadXlsx', async () => workbookBytes(rows));
  let preference: ReportPreference | null = null;
  t.mock.method(Store.prototype, 'getPreference', async () => preference);
  const upload = t.mock.method(Store.prototype, 'prepareValinsUpload', async () => {});
  const command = t.mock.method(Store.prototype, 'valinsReport', async () => ['chosen report']);
  const messages = t.mock.method(Store.prototype, 'prepareMessages', async () => {});
  const csv = t.mock.method(Store.prototype, 'prepareUpload', async () => {});
  t.mock.method(Telegram.prototype, 'downloadCsv', async () => 'INCIDENT,WORKZONE\nINC1,WON');
  const run = async (updateId: number, message: object): Promise<number> => {
    let status = 0;
    const res = {
      setHeader() {}, status(code: number) { status = code; return this; }, json() { return this; }
    } as unknown as ApiResponse;
    await handler({
      method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'test_secret_12345678' },
      body: { update_id: updateId, message: {
        from: { id: 123 }, chat: { id: 123 }, message_id: updateId, date: 1793062800, ...message
      } }
    } as unknown as ApiRequest, res);
    return status;
  };
  try {
    assert.equal(await run(10, { document: { file_id: 'file', file_name: 'report.xlsx' }, caption: '2026-10-26' }), 200);
    assert.equal(download.mock.callCount(), 1);
    assert.equal(upload.mock.callCount(), 1);
    assert.equal(csv.mock.callCount(), 0);
    assert.equal(upload.mock.calls[0]!.arguments[5], '2026-10-26');
    assert.deepEqual(upload.mock.calls[0]!.arguments[8], { kind: 'valins_all', userId: '123', threadId: 0 });
    assert.equal(await run(11, { text: '/valins_dc bone 2026-10-26' }), 200);
    assert.deepEqual(command.mock.calls[0]!.arguments, ['123', 'dc', 'BONE', '2026-10-26']);
    assert.deepEqual(messages.mock.calls[0]!.arguments, [11, '123', ['chosen report']]);
    preference = { kind: 'valins_dc', scope: 'BONE' };
    assert.equal(await run(12, { document: { file_id: 'file', file_name: 'report.xlsx' } }), 200);
    assert.equal(upload.mock.calls[1]!.arguments[6], 'dc');
    assert.deepEqual(upload.mock.calls[1]!.arguments[8], { kind: 'valins_dc', userId: '123', threadId: 0 });
    preference = { kind: 'unspec', scope: 'SEMUA' };
    assert.equal(await run(13, { document: { file_id: 'file', file_name: 'report.xlsx' } }), 200);
    assert.equal(download.mock.callCount(), 2);
    assert.match(String(messages.mock.calls[1]!.arguments[2]![0]), /Pilihan Anda UNSPEC/);
    preference = { kind: 'unspec', scope: null };
    assert.equal(await run(14, { document: { file_id: 'file', file_name: 'report.csv' } }), 200);
    assert.equal(csv.mock.callCount(), 1);
    assert.equal(csv.mock.calls[0]!.arguments[5], '2026-10-26');
    assert.deepEqual(csv.mock.calls[0]!.arguments[7], { kind: 'unspec', userId: '123', threadId: 0 });
    preference = { kind: 'unspec', scope: 'BONE' };
    assert.equal(await run(15, { document: { file_id: 'file', file_name: 'report.csv' } }), 200);
    assert.equal(csv.mock.calls[1]!.arguments[6], 'SEMUA');
    assert.deepEqual(csv.mock.calls[1]!.arguments[7], { kind: 'unspec', userId: '123', threadId: 0 });
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
    Object.assign(process.env, original);
  }
});

test('/start and inline buttons use the clicking user, chat and topic', async t => {
  const original = { ...process.env };
  Object.assign(process.env, {
    TELEGRAM_BOT_TOKEN: 'test', TELEGRAM_WEBHOOK_SECRET: 'test_secret_12345678', DATABASE_URL: 'postgresql://not-connected'
  });
  const lookups = new Map<number, number>();
  t.mock.method(Store.prototype, 'getJob', async (id: number) => {
    const count = lookups.get(id) ?? 0;
    lookups.set(id, count + 1);
    return count ? { update_id: String(id), chat_id: '-100123', messages: ['prepared'], delivered: 1 } : null;
  });
  const menu = t.mock.method(Store.prototype, 'prepareMenu', async () => {});
  const ack = t.mock.method(Telegram.prototype, 'answerCallback', async () => {});
  const run = async (body: unknown): Promise<number> => {
    let status = 0;
    const response = { setHeader() {}, status(code: number) { status = code; return this; }, json() { return this; } } as unknown as ApiResponse;
    await handler({ method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'test_secret_12345678' }, body } as unknown as ApiRequest, response);
    return status;
  };
  const botMessage = { from: { id: 777, is_bot: true }, chat: { id: -100123 }, message_id: 20, date: 1793062800, message_thread_id: 42 };
  try {
    assert.equal(await run({ update_id: 20, message: { ...botMessage, from: { id: 123 }, text: '/start' } }), 200);
    assert.deepEqual(menu.mock.calls[0]!.arguments, [20, '-100123', '123', 42, { type: 'main' }]);
    assert.equal(await run({ update_id: 21, callback_query: { id: 'cb1', from: { id: 456 }, message: botMessage, data: 'menu:valins_all' } }), 200);
    assert.deepEqual(menu.mock.calls[1]!.arguments, [21, '-100123', '456', 42, { type: 'kind', kind: 'valins_all' }]);
    assert.equal(await run({ update_id: 22, callback_query: { id: 'cb2', from: { id: 456 }, message: botMessage, data: 'branch:valins_all:SEMUA:2026-10-27' } }), 200);
    assert.deepEqual(menu.mock.calls[2]!.arguments, [22, '-100123', '456', 42, { type: 'branch', kind: 'valins_all', scope: 'SEMUA', date: '2026-10-27' }]);
    assert.equal(ack.mock.callCount(), 2);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
    Object.assign(process.env, original);
  }
});

test('photo reply creates a delivery job and retries long-report text without sending the photo again', async t => {
  const original = { ...process.env };
  Object.assign(process.env, {
    TELEGRAM_BOT_TOKEN: '777:test', TELEGRAM_WEBHOOK_SECRET: 'test_secret_12345678', DATABASE_URL: 'postgresql://not-connected'
  });
  const jobs = new Map<number, Job>();
  const prepare = t.mock.method(Store.prototype, 'prepareMessages', async (id: number, chatId: string, messages: OutgoingMessage[]) => {
    if (!jobs.has(id)) jobs.set(id, { update_id: String(id), chat_id: chatId, messages, delivered: 0 });
  });
  t.mock.method(Store.prototype, 'getJob', async (id: number) => jobs.get(id) ?? null);
  t.mock.method(Store.prototype, 'claim', async (id: number) => jobs.get(id) ?? null);
  t.mock.method(Store.prototype, 'advance', async (id: number, _owner: string, delivered: number) => { jobs.get(id)!.delivered = delivered; });
  t.mock.method(Store.prototype, 'release', async () => {});
  const preferences = t.mock.method(Store.prototype, 'getPreference', async () => { throw new Error('Photo replies must not read upload preferences'); });
  const sends: OutgoingMessage[] = [];
  let failTextOnce = true;
  t.mock.method(Telegram.prototype, 'send', async (_chatId: string, message: OutgoingMessage) => {
    sends.push(message);
    if (typeof message !== 'string' && message.type !== 'photo' && failTextOnce) {
      failTextOnce = false;
      throw new TelegramError(503);
    }
  });
  t.mock.method(console, 'error', () => {});
  const report = '📊 SUMMARY PERFORMANSI UNSPEC – BRANCH PARE-PARE\n\nSALDO (H): 227';
  const message: TelegramMessage = {
    message_id: 100, date: 1793062800, message_thread_id: 42,
    from: { id: 123 }, chat: { id: -100123 }, photo: [{ file_id: 'image', width: 1280, height: 960 }],
    caption: 'caption biasa, bukan tanggal upload',
    reply_to_message: { message_id: 50, date: 1793062700, from: { id: 777, is_bot: true }, chat: { id: -100123 }, text: report }
  };
  const run = async (id: number): Promise<number> => {
    let status = 0;
    const response = { setHeader() {}, status(code: number) { status = code; return this; }, json() { return this; } } as unknown as ApiResponse;
    await handler({ method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'test_secret_12345678' }, body: { update_id: id, message } } as unknown as ApiRequest, response);
    return status;
  };
  try {
    assert.equal(await run(100), 200);
    assert.equal(sends.length, 1);
    assert.equal(jobs.get(100)?.delivered, 1);
    const first = sends[0];
    assert.ok(first && typeof first !== 'string' && first.type === 'photo');
    assert.equal(first.caption, report);
    message.reply_to_message!.text = report.padEnd(1100, 'x');
    message.message_id = 101;
    assert.equal(await run(101), 503);
    assert.equal(jobs.get(101)?.delivered, 1);
    assert.equal(await run(101), 200);
    assert.equal(jobs.get(101)?.delivered, 2);
    assert.equal(await run(101), 200);
    assert.equal(sends.filter(outgoing => typeof outgoing !== 'string' && outgoing.type === 'photo').length, 2);
    assert.equal(sends.length, 4);
    assert.equal(prepare.mock.callCount(), 2);
    assert.equal(preferences.mock.callCount(), 0);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
    Object.assign(process.env, original);
  }
});
