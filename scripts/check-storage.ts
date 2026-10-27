import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID, randomInt } from 'node:crypto';
import postgres from 'postgres';
import { parseSnapshot } from '../src/report.js';
import { Store } from '../src/store.js';

// Opt-in integration check against the configured database. Every write is rolled back.
if (!process.env.DATABASE_URL) throw new Error('Isi DATABASE_URL terlebih dahulu.');
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, connect_timeout: 10 });
const rollback = new Error('INTEGRATION_CHECK_ROLLBACK');
let verified = false;
try {
  await sql.begin(async tx => {
    await tx`SET LOCAL statement_timeout = '15s'`;
    // Store transactions become SAVEPOINTs inside this disposable outer transaction.
    const connection = new Proxy(tx, {
      get(target, property, receiver) {
        return property === 'begin' ? target.savepoint.bind(target) : Reflect.get(target, property, receiver);
      }
    }) as unknown as ReturnType<typeof postgres>;
    const store = new Store(connection);
    const chat = `integration-check:${randomUUID()}`;
    const otherChat = `integration-check:${randomUUID()}`;
    const base = -randomInt(1_000_000, 1_000_000_000);
    const stamp = (day: number, hour: number): number => Date.parse(`2026-10-${day}T${String(hour).padStart(2, '0')}:00:00+08:00`) / 1000;
    const snapshot = (count: number) => parseSnapshot([
      'INCIDENT,WORKZONE,SUMMARY,STATUS',
      ...Array.from({ length: count }, (_, index) => `INC${index},WON,[UNSPEC],BACKEND`)
    ].join('\n'));

    await store.prepareUpload(base, chat, 1, stamp(26, 8), snapshot(1));
    await store.prepareUpload(base - 1, chat, 3, stamp(26, 17), snapshot(2));
    // An older message arriving late must not replace the latest daily snapshot.
    await store.prepareUpload(base - 2, chat, 2, stamp(26, 12), snapshot(1));
    assert.match((await store.report(chat, '2026-10-26'))[3]!, /SALDO \(H\): 2\n/);

    await store.prepareUpload(base - 3, chat, 4, stamp(27, 8), snapshot(3));
    let reports = await store.report(chat, '2026-10-27');
    assert.equal(reports.length, 4);
    assert.match(reports[3]!, /SALDO \(H\): 3\n/);
    assert.match(reports[3]!, /SALDO \(H-1\): 2\n/);
    assert.match(reports[3]!, /\(Memburuk\)/);

    // A retry of an already prepared update cannot replace its snapshot or messages.
    await store.prepareUpload(base - 3, chat, 4, stamp(27, 8), snapshot(4));
    reports = await store.report(chat, '2026-10-27');
    assert.match(reports[3]!, /SALDO \(H\): 3\n/);

    await store.prepareUpload(base - 4, otherChat, 1, stamp(27, 8), snapshot(1));
    assert.match((await store.report(otherChat))[3]!, /SALDO \(H-1\): Belum tersedia/);

    const first = await store.claim(base - 3, 'worker-one');
    assert.equal(first?.delivered, 0);
    assert.equal(await store.claim(base - 3, 'worker-two'), null);
    await store.advance(base - 3, 'worker-one', 1, false);
    await store.release(base - 3, 'worker-one');
    const resumed = await store.claim(base - 3, 'worker-two');
    assert.equal(resumed?.delivered, 1);
    await store.advance(base - 3, 'worker-two', 4, true);
    await store.release(base - 3, 'worker-two');
    assert.equal(await store.claim(base - 3, 'worker-three'), null);
    assert.equal((await store.getJob(base - 3))?.delivered, 4);

    // Command jobs are also idempotent.
    await store.prepareMessages(base - 5, chat, ['original']);
    await store.prepareMessages(base - 5, chat, ['replacement']);
    assert.deepEqual((await store.getJob(base - 5))?.messages, ['original']);
    verified = true;
    throw rollback;
  });
} catch (error) {
  if (error !== rollback) {
    console.error(error instanceof assert.AssertionError ? `Uji penyimpanan gagal: ${error.message}` : 'Uji penyimpanan gagal. Periksa koneksi dan skema database.');
    process.exitCode = 1;
  }
} finally { await sql.end({ timeout: 5 }); }
if (verified && !process.exitCode) console.log('Database lulus: snapshot terbaru, H-1, isolasi chat, retry, dan kelanjutan pengiriman. Semua data uji di-rollback.');
