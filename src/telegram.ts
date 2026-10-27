import { InputError, MAX_CSV_BYTES } from './report.js';

export interface TelegramMessage {
  message_id: number;
  date: number;
  message_thread_id?: number;
  from?: { id: number; is_bot?: boolean };
  chat: { id: number; type?: string };
  text?: string;
  caption?: string;
  document?: { file_id: string; file_name?: string; file_size?: number };
}
export interface TelegramUpdate { update_id: number; message?: TelegramMessage }

interface ApiResponse<T> { ok: boolean; result: T; error_code?: number; parameters?: { retry_after?: number } }
export class TelegramError extends Error {
  constructor(public readonly code: number, public readonly retryAfter?: number) {
    // Do not include Telegram response descriptions or token-bearing URLs in logs.
    super(`Telegram API gagal (kode ${code}).`);
  }
}

export class Telegram {
  constructor(private readonly token: string) {}

  async call<T>(method: string, body: Record<string, unknown>): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(8000)
      });
    } catch {
      throw new TelegramError(503);
    }
    let payload: ApiResponse<T>;
    try { payload = await response.json() as ApiResponse<T>; }
    catch { throw new TelegramError(response.status || 502); }
    if (!response.ok || !payload.ok) throw new TelegramError(payload.error_code ?? response.status, payload.parameters?.retry_after);
    return payload.result;
  }

  async send(chatId: string, text: string, threadId?: number): Promise<void> {
    await this.call('sendMessage', {
      chat_id: chatId, text,
      ...(threadId ? { message_thread_id: threadId } : {})
    });
  }

  async downloadCsv(document: NonNullable<TelegramMessage['document']>): Promise<string> {
    if (!document.file_name?.toLowerCase().endsWith('.csv')) throw new InputError('Kirim file berekstensi .csv sebagai dokumen.');
    if ((document.file_size ?? 0) > MAX_CSV_BYTES) throw new InputError('Ukuran CSV maksimal 10 MB.');
    const file = await this.call<{ file_path?: string; file_size?: number }>('getFile', { file_id: document.file_id });
    if (!file.file_path) throw new TelegramError(502);
    if ((file.file_size ?? 0) > MAX_CSV_BYTES) throw new InputError('Ukuran CSV maksimal 10 MB.');
    let response: Response;
    try {
      response = await fetch(`https://api.telegram.org/file/bot${this.token}/${file.file_path}`, {
        signal: AbortSignal.timeout(10000)
      });
    } catch { throw new TelegramError(503); }
    if (!response.ok || !response.body) throw new TelegramError(response.status || 502);
    // Stream with a hard cap, even when Telegram omits the declared file size.
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_CSV_BYTES) {
          await reader.cancel();
          throw new InputError('Ukuran CSV maksimal 10 MB.');
        }
        chunks.push(value);
      }
    } catch (error) {
      if (error instanceof InputError) throw error;
      throw new TelegramError(503);
    }
    const bytes = Buffer.concat(chunks);
    try {
      if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le', { fatal: true }).decode(bytes);
      if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be', { fatal: true }).decode(bytes);
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new InputError('Encoding CSV tidak didukung. Simpan ulang sebagai CSV UTF-8.');
    }
  }
}
