import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID, randomInt } from 'node:crypto';
import postgres from 'postgres';
import { parseSnapshot } from '../src/report.js';
import { Store } from '../src/store.js';
import { readFile } from 'node:fs/promises';
import { parseValinsWorkbook, renderValinsReports } from '../src/valins.js';

// Opt-in integration check against the configured database. Every write is rolled back.
if (!process.env.DATABASE_URL) throw new Error('Isi DATABASE_URL terlebih dahulu.');
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, connect_timeout: 10 });
const rollback = new Error('INTEGRATION_CHECK_ROLLBACK');
let verified = false;
try {
  const workbook = process.argv[2] ? await parseValinsWorkbook(await readFile(process.argv[2])) : null;
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

    // Both exports are sent on the 27th, but their captions identify the 25th/26th.
    const datedChat = `integration-check:${randomUUID()}`;
    await store.prepareUpload(base - 6, datedChat, 1, stamp(27, 8), snapshot(2), '2026-10-25');
    await store.prepareUpload(base - 7, datedChat, 2, stamp(27, 8), snapshot(3), '2026-10-26');
    const datedReports = await store.report(datedChat, '2026-10-26');
    assert.match(datedReports[3]!, /📅 26 Oktober 2026/);
    assert.match(datedReports[3]!, /SALDO \(H-1\): 2\n/);
    // Correct the 25th after the 26th was already reported; /report must refresh H-1.
    await store.prepareUpload(base - 8, datedChat, 3, stamp(27, 9), snapshot(4), '2026-10-25');
    assert.match((await store.report(datedChat, '2026-10-26'))[3]!, /SALDO \(H-1\): 4\n/);

    const reversedChat = `integration-check:${randomUUID()}`;
    await store.prepareUpload(base - 9, reversedChat, 1, stamp(27, 8), snapshot(3), '2026-10-26');
    await store.prepareUpload(base - 10, reversedChat, 2, stamp(27, 9), snapshot(2), '2026-10-25');
    assert.match((await store.report(reversedChat, '2026-10-26'))[3]!, /SALDO \(H-1\): 2\n/);

    await store.prepareMenu(base - 20, chat, 'user-a', 0, { type: 'kind', kind: 'unspec' });
    assert.deepEqual(await store.getPreference(chat, 'user-a'), { kind: 'unspec', scope: null });
    await store.prepareMenu(base - 21, chat, 'user-a', 0, { type: 'branch', kind: 'unspec', scope: 'BONE' });
    assert.deepEqual(await store.getPreference(chat, 'user-a'), { kind: 'unspec', scope: 'BONE' });
    const menuJob = await store.getJob(base - 21);
    assert.match(String(menuJob?.messages[0]), /BRANCH BONE/);
    const confirmation = menuJob?.messages.at(-1);
    assert.ok(confirmation && typeof confirmation !== 'string' && confirmation.reply_markup?.inline_keyboard.length);
    await store.prepareMenu(base - 22, chat, 'user-b', 0, { type: 'kind', kind: 'valins_dc' });
    await store.prepareMenu(base - 23, chat, 'user-a', 42, { type: 'kind', kind: 'valins_visit' });
    assert.deepEqual(await store.getPreference(chat, 'user-a'), { kind: 'unspec', scope: 'BONE' });
    assert.deepEqual(await store.getPreference(chat, 'user-b'), { kind: 'valins_dc', scope: null });
    assert.deepEqual(await store.getPreference(chat, 'user-a', 42), { kind: 'valins_visit', scope: null });
    await store.prepareMenu(base - 24, chat, 'user-a', 0, { type: 'main' });
    await store.prepareMenu(base - 24, chat, 'user-a', 0, { type: 'kind', kind: 'unspec' });
    assert.equal(await store.getPreference(chat, 'user-a'), null); // Retry cannot reapply a different action.
    assert.equal((await store.getPreference(chat, 'user-b'))?.kind, 'valins_dc');
    await store.prepareUpload(base - 25, chat, 5, stamp(27, 10), snapshot(3), '2026-10-27', 'BONE');
    assert.equal((await store.getJob(base - 25))?.messages.length, 1);
    assert.match(String((await store.getJob(base - 25))?.messages[0]), /BRANCH BONE/);
    assert.equal((await store.report(chat, '2026-10-27')).length, 4); // All branches remain in the snapshot.
    console.log('Uji menu lulus: pilihan jenis/branch, tombol tersimpan, isolasi pengguna/topic, dan retry.');

    if (workbook) {
      const valinsChat = `integration-check:${randomUUID()}`;
      const expected = renderValinsReports(workbook);
      await store.prepareValinsUpload(base - 11, valinsChat, 2, stamp(27, 9), workbook, '2026-10-26');
      assert.deepEqual(await store.valinsReport(valinsChat, 'all', 'PARE-PARE', '2026-10-26'), expected);
      assert.deepEqual((await store.getJob(base - 11))?.messages, expected);
      // The first VALINS upload already has growth from the workbook, not daily_snapshots.
      assert.ok(expected.every(report => !report.includes('GROWTH (H VS H-1): Belum tersedia')));
      assert.equal((await store.valinsReport(valinsChat, 'dc', 'SEMUA')).length, 4);
      assert.equal((await store.report(valinsChat)).length, 1); // No UNSPEC data was created.
      await store.prepareValinsUpload(base - 11, valinsChat, 2, stamp(27, 9), workbook, '2026-10-25');
      assert.equal((await tx`SELECT report_date FROM valins_snapshots WHERE chat_id = ${valinsChat}`).length, 1);
      await store.prepareValinsUpload(base - 12, valinsChat, 1, stamp(27, 8), workbook, '2026-10-26');
      const last = await tx<{ source_order: string }[]>`SELECT source_order::text FROM valins_snapshots WHERE chat_id = ${valinsChat}`;
      assert.equal(last[0]?.source_order, '2');
      assert.match((await store.valinsReport(`${valinsChat}-other`))[0]!, /Belum ada data VALINS/);
      await store.prepareValinsUpload(base - 26, valinsChat, 3, stamp(27, 10), workbook, '2026-10-26', 'visit', 'SEMUA');
      const selected = (await store.getJob(base - 26))!.messages;
      assert.equal(selected.length, 4);
      assert.ok(selected.every(message => typeof message === 'string' && message.includes('VALINS VISIT ODP')));
      await store.prepareMenu(base - 27, valinsChat, 'user-a', 0, { type: 'branch', kind: 'valins_dc', scope: 'BONE' });
      assert.match(String((await store.getJob(base - 27))?.messages[0]), /VALINS DC QR CODE & SERVICE – BONE/);
      console.log('Uji VALINS lulus: file Excel, H-1 bawaan, pemilihan laporan/branch, isolasi UNSPEC/chat, dan retry.');
    }
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
