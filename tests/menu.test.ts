import test from 'node:test';
import assert from 'node:assert/strict';
import { branchMenu, mainMenu, parseMenuAction, REPORT_TYPES, selectedMenu } from '../src/menu.js';
import { InputError } from '../src/report.js';
import { selectUnspecReports } from '../src/store.js';

test('main menu has four features and every branch menu has all five print choices', () => {
  const features = mainMenu().reply_markup!.inline_keyboard.flat();
  assert.equal(features.length, 4);
  assert.deepEqual(features.map(button => parseMenuAction(button.callback_data)), REPORT_TYPES.map(kind => ({ type: 'kind', kind })));
  for (const kind of REPORT_TYPES) {
    const buttons = branchMenu(kind).reply_markup!.inline_keyboard.flat();
    assert.deepEqual(buttons.slice(0, 5).map(button => parseMenuAction(button.callback_data)),
      ['PARE-PARE','BONE','KENDARI','MAKASSAR','SEMUA'].map(scope => ({ type: 'branch', kind, scope })));
    assert.deepEqual(parseMenuAction(buttons[5]!.callback_data), { type: 'main' });
    assert.ok(buttons.every(button => Buffer.byteLength(button.callback_data) <= 64));
  }
});

test('selected menu preserves feature/branch and offers print and navigation', () => {
  const menu = selectedMenu('valins_dc', 'BONE', false);
  assert.match(menu.text, /VALINS DC — BONE/);
  assert.match(menu.text, /Excel \(\.xlsx\)/);
  assert.match(menu.text, /Belum ada data/);
  const buttons = menu.reply_markup!.inline_keyboard.flat();
  assert.deepEqual(parseMenuAction(buttons[0]!.callback_data), { type: 'print', kind: 'valins_dc', scope: 'BONE' });
  assert.deepEqual(parseMenuAction(buttons[1]!.callback_data), { type: 'kind', kind: 'valins_dc' });
  assert.deepEqual(parseMenuAction(buttons[2]!.callback_data), { type: 'main' });
  assert.match(selectedMenu('unspec', 'SEMUA', true).text, /CSV \(\.csv\)/);
});

test('malformed callback choices are rejected and UNSPEC filtering uses branch order', () => {
  for (const input of ['menu:wrong', 'branch:unspec:PALU', 'branch:valins_dc:', 'menu:unspec:extra', 'print:unspec:BONE:extra']) {
    assert.throws(() => parseMenuAction(input), InputError);
  }
  const reports = ['bone','kendari','makassar','pare-pare'];
  assert.deepEqual(selectUnspecReports(reports, 'BONE'), ['bone']);
  assert.deepEqual(selectUnspecReports(reports, 'PARE-PARE'), ['pare-pare']);
  assert.deepEqual(selectUnspecReports(reports, 'SEMUA'), reports);
});
