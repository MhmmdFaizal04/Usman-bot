import { BRANCHES } from './master.js';
import type { RichMessage } from './messages.js';
import { InputError, previousDate, validDate } from './report.js';
import type { ValinsKind, ValinsScope } from './valins.js';

export const REPORT_TYPES = ['unspec', 'valins_visit', 'valins_dc', 'valins_all'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];
export interface ReportPreference { kind: ReportType; scope: ValinsScope | null; date?: string | null }
export interface UploadMenuContext { kind: ReportType; userId: string; threadId: number }
export type MenuAction = { type: 'main' } | { type: 'kind'; kind: ReportType } |
  { type: 'branches'; kind: ReportType; date: string } |
  { type: 'branch' | 'print'; kind: ReportType; scope: ValinsScope; date?: string };

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
      '2️⃣ Upload file CSV atau Excel.',
      '3️⃣ Pilih branch atau Cetak Semua.', '',
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
export function uploadPrompt(kind: ReportType): RichMessage {
  return {
    text: [
      `📊 ${REPORT_LABELS[kind]}`, '',
      `📤 Silakan upload file ${kind === 'unspec' ? 'CSV (.csv)' : 'Excel (.xlsx)'}.`,
      'Setelah file diproses, tombol pilihan branch dan Cetak Semua akan muncul.', '',
      '📅 Untuk data hari ini, cukup kirim file tanpa caption.',
      'Untuk tanggal lain, isi caption tanggal, misalnya 2026-10-26.', '',
      ...(kind === 'unspec' ? ['📈 H-1 otomatis memakai data tanggal sebelumnya di chat yang sama.'] :
        ['📈 H-1 dan growth VALINS dibaca dari Sheet1 Excel.'])
    ].join('\n'),
    reply_markup: { inline_keyboard: [[{ text: '🏠 Menu Utama', callback_data: 'menu:main' }]] }
  };
}
export function branchMenu(kind: ReportType, date: string, hasPrevious?: boolean): RichMessage {
  const button = (scope: ValinsScope, label: string = scope) => ({ text: label, callback_data: `branch:${kind}:${scope}:${date}` });
  return {
    text: [
      `✅ File ${REPORT_LABELS[kind]} berhasil diproses.`,
      `📅 Tanggal data: ${date}`,
      ...(kind === 'unspec' ? [`📈 Pembanding H-1: ${previousDate(date)}${hasPrevious === undefined ? '' : hasPrevious ? ' (tersedia)' : ' (belum tersedia)'}`] : []), '',
      'Silakan pilih branch yang ingin dicetak.',
      'Tekan Cetak Semua untuk mencetak seluruh branch dari data ini.'
    ].join('\n'),
    reply_markup: { inline_keyboard: [
      [button('PARE-PARE'), button('BONE')],
      [button('KENDARI'), button('MAKASSAR')],
      [button('SEMUA', '🖨 CETAK SEMUA')],
      [{ text: '⬅️ Menu Utama', callback_data: 'menu:main' }]
    ] }
  };
}
export function selectedMenu(kind: ReportType, scope: ValinsScope, date: string): RichMessage {
  return {
    text: [
      `✅ Pilihan: ${REPORT_LABELS[kind]} — ${scope === 'SEMUA' ? 'SEMUA BRANCH' : scope}`,
      `📅 Tanggal data: ${date}`, '',
      'Laporan dari file yang Anda upload sudah dicetak.',
      'Gunakan tombol di bawah untuk mencetak branch lain atau mengupload file baru.'
    ].join('\n'),
    reply_markup: { inline_keyboard: [
      [{ text: '🖨 Cetak Ulang', callback_data: `print:${kind}:${scope}:${date}` }],
      [{ text: '⬅️ Ganti Branch', callback_data: `branches:${kind}:${date}` }, { text: '📤 Upload File Baru', callback_data: `menu:${kind}` }],
      [{ text: '🏠 Menu Utama', callback_data: 'menu:main' }]
    ] }
  };
}
export function parseMenuAction(data: string): MenuAction {
  if (data === 'menu:main') return { type: 'main' };
  const parts = data.split(':');
  const [action, kind, scope] = parts;
  if (!REPORT_TYPES.includes(kind as ReportType)) throw new InputError('Pilihan menu tidak valid. Ketik /start untuk membuka menu baru.');
  if (action === 'menu' && parts.length === 2) return { type: 'kind', kind: kind as ReportType };
  if (action === 'branches' && parts.length === 3 && scope && validDate(scope)) {
    return { type: 'branches', kind: kind as ReportType, date: scope };
  }
  if ((action === 'branch' || action === 'print') && (parts.length === 3 || (parts.length === 4 && validDate(parts[3]!))) &&
      (scope === 'SEMUA' || BRANCHES.includes(scope as (typeof BRANCHES)[number]))) {
    return { type: action, kind: kind as ReportType, scope: scope as ValinsScope, ...(parts[3] ? { date: parts[3] } : {}) };
  }
  throw new InputError('Pilihan menu tidak valid. Ketik /start untuk membuka menu baru.');
}
