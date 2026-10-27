import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/telegram.js';
import type { ApiRequest, ApiResponse } from '../src/http.js';
import { Store } from '../src/store.js';

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
