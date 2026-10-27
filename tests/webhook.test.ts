import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/telegram.js';
import type { ApiRequest, ApiResponse } from '../src/http.js';
import { Store } from '../src/store.js';
import { Telegram } from '../src/telegram.js';
import type { SheetData } from 'read-excel-file/node';
import { workbookBytes } from './helpers/xlsx.js';

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
  const upload = t.mock.method(Store.prototype, 'prepareValinsUpload', async () => {});
  const command = t.mock.method(Store.prototype, 'valinsReport', async () => ['chosen report']);
  const messages = t.mock.method(Store.prototype, 'prepareMessages', async () => {});
  const csv = t.mock.method(Store.prototype, 'prepareUpload', async () => { throw new Error('XLSX must not use the CSV store'); });
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
    assert.equal(await run(11, { text: '/valins_dc bone 2026-10-26' }), 200);
    assert.deepEqual(command.mock.calls[0]!.arguments, ['123', 'dc', 'BONE', '2026-10-26']);
    assert.deepEqual(messages.mock.calls[0]!.arguments, [11, '123', ['chosen report']]);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
    Object.assign(process.env, original);
  }
});
