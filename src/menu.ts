import { BRANCHES } from './master.js';
import type { RichMessage } from './messages.js';
import { InputError } from './report.js';
import type { ValinsKind, ValinsScope } from './valins.js';

export const REPORT_TYPES = ['unspec', 'valins_visit', 'valins_dc', 'valins_all'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];
export interface ReportPreference { kind: ReportType; scope: ValinsScope | null }
export type MenuAction = { type: 'main' } | { type: 'kind'; kind: ReportType } |
  { type: 'branch' | 'print'; kind: ReportType; scope: ValinsScope };

export const REPORT_LABELS: Record<ReportType, string> = {
  unspec: 'UNSPEC', valins_visit: 'VALINS ODP', valins_dc: 'VALINS DC', valins_all: 'VALINS ODP DAN DC'
};
export function valinsKind(kind: Exclude<ReportType, 'unspec'>): ValinsKind {
  return kind === 'valins_visit' ? 'visit' : kind === 'valins_dc' ? 'dc' : 'all';
}
export function mainMenu(): RichMessage {
  return {
    text: [
      '👋 Selamat datang di Report Sulbagsel!', '',
      'Buat laporan UNSPEC dan VALINS dengan mudah.', '',
      '1️⃣ Pilih jenis laporan.',
      '2️⃣ Pilih branch atau Cetak Semua.',
      '3️⃣ Upload file CSV atau Excel.', '',
      'Silakan pilih jenis laporan di bawah ini 👇'
    ].join('\n'),
    reply_markup: { inline_keyboard: [
      [{ text: '📊 UNSPEC', callback_data: 'menu:unspec' }],
      [{ text: '📋 VALINS ODP', callback_data: 'menu:valins_visit' }],
      [{ text: '🔎 VALINS DC', callback_data: 'menu:valins_dc' }],
      [{ text: '📑 VALINS ODP DAN DC', callback_data: 'menu:valins_all' }]
    ] }
  };
}
export function branchMenu(kind: ReportType): RichMessage {
  const button = (scope: ValinsScope, label: string = scope) => ({ text: label, callback_data: `branch:${kind}:${scope}` });
  return {
    text: [
      `📊 ${REPORT_LABELS[kind]}`, '',
      'Pilih branch yang ingin dibuatkan laporan.',
      'Tekan Cetak Semua untuk menampilkan seluruh branch.', '',
      `📎 Format file: ${kind === 'unspec' ? 'CSV (.csv)' : 'Excel (.xlsx)'}`
    ].join('\n'),
    reply_markup: { inline_keyboard: [
      [button('PARE-PARE'), button('BONE')],
      [button('KENDARI'), button('MAKASSAR')],
      [button('SEMUA', '🖨 CETAK SEMUA')],
      [{ text: '⬅️ Menu Utama', callback_data: 'menu:main' }]
    ] }
  };
}
export function selectedMenu(kind: ReportType, scope: ValinsScope, hasData: boolean): RichMessage {
  const extension = kind === 'unspec' ? 'CSV (.csv)' : 'Excel (.xlsx)';
  return {
    text: [
      `✅ Pilihan: ${REPORT_LABELS[kind]} — ${scope === 'SEMUA' ? 'SEMUA BRANCH' : scope}`,
      '', hasData ? 'Laporan tersimpan sudah ditampilkan di atas.' : 'Belum ada data untuk pilihan ini.', '',
      `📤 Kirim file ${extension} untuk membuat laporan terbaru.`, '',
      '📅 Untuk data tanggal lain, tambahkan caption tanggal saat mengirim file.',
      'Contoh: 2026-10-26', '',
      'Pilihan ini juga digunakan untuk upload berikutnya. Anda dapat menggantinya melalui tombol di bawah.'
    ].join('\n'),
    reply_markup: { inline_keyboard: [
      [{ text: '🖨 Cetak Data Tersimpan', callback_data: `print:${kind}:${scope}` }],
      [{ text: '⬅️ Ganti Branch', callback_data: `menu:${kind}` }, { text: '🏠 Menu Utama', callback_data: 'menu:main' }]
    ] }
  };
}
export function parseMenuAction(data: string): MenuAction {
  if (data === 'menu:main') return { type: 'main' };
  const parts = data.split(':');
  const [action, kind, scope] = parts;
  if (!REPORT_TYPES.includes(kind as ReportType)) throw new InputError('Pilihan menu tidak valid. Ketik /start untuk membuka menu baru.');
  if (action === 'menu' && parts.length === 2) return { type: 'kind', kind: kind as ReportType };
  if ((action === 'branch' || action === 'print') && parts.length === 3 &&
      (scope === 'SEMUA' || BRANCHES.includes(scope as (typeof BRANCHES)[number]))) {
    return { type: action, kind: kind as ReportType, scope: scope as ValinsScope };
  }
  throw new InputError('Pilihan menu tidak valid. Ketik /start untuk membuka menu baru.');
}
