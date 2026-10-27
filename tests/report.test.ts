import test from 'node:test';
import assert from 'node:assert/strict';
import { BRANCHES } from '../src/master.js';
import { InputError, parseSnapshot, previousDate, reconciliation, renderReports, resolveReportDate, witaDate } from '../src/report.js';

const csv = (...rows: string[]): string => ['INCIDENT,WORKZONE,SUMMARY,STATUS', ...rows].join('\n');
const timestamp = Date.parse('2026-10-27T09:00:00+08:00') / 1000;

test('master LIS matches the four dashboard branch totals', () => {
  const snapshot = parseSnapshot(csv('INC1,WON,[UNSPEC],BACKEND'));
  assert.deepEqual(BRANCHES.map(branch => snapshot.branches[branch].lis), [44600, 83681, 152298, 101503]);
  assert.equal(snapshot.branches['PARE-PARE'].saldo, 1);
  assert.equal(snapshot.branches.BONE.saldo, 0);
});

test('quoted multiline fields, commas, BOM and semicolon exports parse correctly', () => {
  const snapshot = parseSnapshot('\uFEFFINCIDENT;WORKZONE;SUMMARY;STATUS\r\nINC1;won;"[UNSPEC] teks, dengan\nbaris baru";BACKEND');
  assert.equal(snapshot.branches['PARE-PARE'].stos.WON, 1);
});

test('duplicate incident keeps its last row, including changed workzone', () => {
  const snapshot = parseSnapshot(csv('INC1,WON,[UNSPEC],BACKEND', 'INC1,WTP,[UNSPEC],BACKEND'));
  assert.equal(snapshot.duplicateRows, 1);
  assert.equal(snapshot.branches['PARE-PARE'].saldo, 0);
  assert.equal(snapshot.branches.BONE.saldo, 1);
});

test('known outside STO is excluded while non-UNSPEC and closed tickets are filtered', () => {
  const snapshot = parseSnapshot(csv(
    'INC1,WON,[UNSPEC],BACKEND', 'INC2,PKA,[UNSPEC],BACKEND',
    'INC3,WTP,OTHER,BACKEND', 'INC4,WTP,[UNSPEC],CLOSED'
  ));
  assert.equal(snapshot.excludedRows, 1);
  assert.equal(snapshot.filteredRows, 2);
  assert.match(reconciliation(snapshot)!, /1 tiket di luar 4 branch/);
  assert.equal(snapshot.branches.BONE.saldo, 0);
});

test('unknown STO, malformed CSV, blank required cells, or missing headers are rejected', () => {
  for (const input of [
    csv('INC1,UNKNOWN,[UNSPEC],BACKEND'),
    csv('INC1,WON,"unterminated,BACKEND'),
    csv('INC1,,[UNSPEC],BACKEND'),
    'INCIDENT,SUMMARY\nINC1,[UNSPEC]',
    'INCIDENT,WORKZONE,WORKZONE\nINC1,WON,WTP',
    'INCIDENT,WORKZONE\n'
  ]) assert.throws(() => parseSnapshot(input), InputError);
});

test('old REPORTED DATE never prevents a current upload from being reported', () => {
  const snapshot = parseSnapshot('INCIDENT,WORKZONE,REPORTED DATE\nINC1,WON,2020-01-01 00:00:00');
  const reports = renderReports(snapshot, null, timestamp);
  assert.equal(reports.length, 4);
  assert.match(reports[3]!, /27 Oktober 2026/);
  assert.match(reports[3]!, /SALDO \(H\): 1\n/);
  assert.match(reports[3]!, /SALDO \(H-1\): Belum tersedia/);
  assert.match(reports[3]!, /TOTAL LIS: 101\.503/);
  assert.match(reports[3]!, /TARGET SALDO 0,10%: 101\n/);
  assert.match(reports[3]!, /🟢 SID: 0,00%/);
  assert.ok(reports.every(report => report.length < 4096));
});

test('target status uses full precision even when displayed percentages are equal', () => {
  // MAL has LIS 629; 1 ticket is already over target. WON has LIS 3347;
  // 3 tickets are green, 4 are red.
  const snapshot = parseSnapshot(csv(
    'I1,MAL,[UNSPEC],BACKEND',
    'I2,WON,[UNSPEC],BACKEND', 'I3,WON,[UNSPEC],BACKEND',
    'I4,WON,[UNSPEC],BACKEND', 'I5,WON,[UNSPEC],BACKEND'
  ));
  const report = renderReports(snapshot, null, timestamp);
  assert.match(report[2]!, /🔴 MAL: 0,16% \(Tertinggi\)/);
  assert.match(report[3]!, /🔴 WON: 0,12% \(Tertinggi\)/);
  snapshot.branches['PARE-PARE'].stos.WON = 3;
  snapshot.branches['PARE-PARE'].saldo = 3;
  assert.match(renderReports(snapshot, null, timestamp)[3]!, /🟢 WON: 0,09%/);
  // Just above the branch target still displays 0,10%, but must be red.
  snapshot.branches['PARE-PARE'].saldo = 102;
  assert.match(renderReports(snapshot, null, timestamp)[3]!, /🔴 0,10% \(Di atas target\)/);
});

test('growth compares branch ratios against previous snapshot and includes zero balances', () => {
  const old = parseSnapshot(csv('I1,WON,[UNSPEC],BACKEND'));
  const current = parseSnapshot(csv('I2,WTP,[UNSPEC],BACKEND'));
  const reports = renderReports(current, old, timestamp);
  assert.match(reports[0]!, /SALDO \(H-1\): 0\n/);
  assert.match(reports[0]!, /\(Memburuk\)/);
  assert.match(reports[1]!, /0,00% \(Tetap\)/);
  assert.match(reports[3]!, /\(Membaik\)/);
});

test('WITA midnight and month/year boundaries choose exact previous calendar day', () => {
  assert.equal(witaDate(Date.parse('2026-10-27T15:59:59Z') / 1000), '2026-10-27');
  assert.equal(witaDate(Date.parse('2026-10-27T16:00:00Z') / 1000), '2026-10-28');
  assert.equal(previousDate('2026-11-01'), '2026-10-31');
  assert.equal(previousDate('2027-01-01'), '2026-12-31');
  assert.equal(previousDate('2028-03-01'), '2028-02-29');
});

test('caption dates separate historical exports uploaded on the same day', () => {
  assert.equal(resolveReportDate(undefined, timestamp), '2026-10-27');
  assert.equal(resolveReportDate('  ', timestamp), '2026-10-27');
  assert.equal(resolveReportDate('tanggal=2026-10-25', timestamp), '2026-10-25');
  assert.equal(resolveReportDate('Tanggal = 2026-10-26', timestamp), '2026-10-26');
  for (const caption of ['tanggal=2026-02-30', 'tanggal=25-10-2026', 'tanggal=', 'tanggal=2026-10-25 extra', '2026-10-25']) {
    assert.throws(() => resolveReportDate(caption, timestamp), InputError);
  }
  const snapshot = parseSnapshot(csv('I1,WON,[UNSPEC],BACKEND'));
  const report = renderReports(snapshot, null, timestamp, '2026-10-25')[3]!;
  assert.match(report, /📅 25 Oktober 2026\n/);
  assert.match(report, /🕒 Diupload: 27 Oktober 2026/);
});
