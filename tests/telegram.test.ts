import test from 'node:test';
import assert from 'node:assert/strict';
import { Telegram, TelegramError } from '../src/telegram.js';
import { InputError, MAX_CSV_BYTES } from '../src/report.js';

test('CSV download uses Telegram getFile then fetches document content', async t => {
  const urls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    urls.push(url);
    return urls.length === 1 ? Response.json({ ok: true, result: { file_path: 'documents/file.csv' } }) :
      new Response('INCIDENT,WORKZONE\nI1,WON');
  });
  const text = await new Telegram('test-token').downloadCsv({ file_id: 'f1', file_name: 'EXPORT.CSV' });
  assert.equal(text, 'INCIDENT,WORKZONE\nI1,WON');
  assert.equal(urls.length, 2);
  assert.match(urls[0]!, /getFile$/);
});

test('wrong extension and oversized files fail before downloading', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Must not fetch'); });
  const telegram = new Telegram('test-token');
  await assert.rejects(telegram.downloadCsv({ file_id: 'f1', file_name: 'data.xlsx' }), InputError);
  await assert.rejects(telegram.downloadCsv({ file_id: 'f1', file_name: 'data.csv', file_size: MAX_CSV_BYTES + 1 }), InputError);
  assert.equal(fetch.mock.callCount(), 0);
});

test('actual downloaded bytes are capped even without declared file size', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => ++calls === 1 ?
    Response.json({ ok: true, result: { file_path: 'file.csv' } }) : new Response(new Uint8Array(MAX_CSV_BYTES + 1)));
  await assert.rejects(new Telegram('test-token').downloadCsv({ file_id: 'f1', file_name: 'data.csv' }), InputError);
});

test('API rate limit exposes retry timing without leaking token', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    ok: false, error_code: 429, parameters: { retry_after: 12 }
  }, { status: 429 }));
  await assert.rejects(new Telegram('secret-token').send('1', 'hello'), (error: unknown) => {
    assert.ok(error instanceof TelegramError);
    assert.equal(error.retryAfter, 12);
    assert.ok(!error.message.includes('secret-token'));
    return true;
  });
});

test('network errors with token-bearing URLs are replaced with safe errors', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Failed https://api.telegram.org/botsecret-token/getFile'); });
  await assert.rejects(new Telegram('secret-token').send('1', 'hello'), (error: unknown) => {
    assert.ok(error instanceof TelegramError);
    assert.ok(!error.message.includes('secret-token'));
    return true;
  });
});
