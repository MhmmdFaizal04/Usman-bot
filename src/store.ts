import postgres from 'postgres';
import { InputError, previousDate, reconciliation, renderReports, validDate, witaDate, type Snapshot } from './report.js';

let client: ReturnType<typeof postgres> | undefined;
export function database(url: string): ReturnType<typeof postgres> {
  client ??= postgres(url, { max: 1, prepare: false, idle_timeout: 5, connect_timeout: 8 });
  return client;
}
export interface Job {
  update_id: string;
  chat_id: string;
  messages: string[];
  delivered: number;
}
export class Store {
  constructor(private readonly sql: ReturnType<typeof postgres>) {}

  async getJob(updateId: number): Promise<Job | null> {
    const rows = await this.sql<Job[]>`SELECT update_id::text, chat_id, messages, delivered FROM telegram_jobs WHERE update_id = ${updateId}`;
    return rows[0] ?? null;
  }

  async prepareMessages(updateId: number, chatId: string, messages: string[]): Promise<void> {
    await this.sql`
      INSERT INTO telegram_jobs (update_id, chat_id, messages)
      VALUES (${updateId}, ${chatId}, ${this.sql.json(messages)})
      ON CONFLICT (update_id) DO NOTHING
    `;
  }

  async prepareUpload(updateId: number, chatId: string, messageId: number, timestamp: number, snapshot: Snapshot, date = witaDate(timestamp)): Promise<void> {
    if (!validDate(date)) throw new InputError('Tanggal laporan tidak valid.');
    await this.sql.begin(async tx => {
      // Serialise snapshot preparation for this chat, including simultaneous uploads.
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${chatId}, 0))`;
      const existing = await tx`SELECT update_id FROM telegram_jobs WHERE update_id = ${updateId}`;
      if (existing.length) return;
      const old = await tx<{ snapshot: Snapshot }[]>`
        SELECT snapshot FROM daily_snapshots WHERE chat_id = ${chatId} AND report_date = ${previousDate(date)}::date
      `;
      const reports = renderReports(snapshot, old[0]?.snapshot ?? null, timestamp, date);
      const changed = await tx`
        INSERT INTO daily_snapshots (chat_id, report_date, source_time, source_order, snapshot, reports)
        VALUES (${chatId}, ${date}::date, ${timestamp}, ${messageId}, ${tx.json(snapshot as unknown as postgres.JSONValue)}, ${tx.json(reports)})
        ON CONFLICT (chat_id, report_date) DO UPDATE SET
          source_time = EXCLUDED.source_time, source_order = EXCLUDED.source_order,
          uploaded_at = NOW(), snapshot = EXCLUDED.snapshot, reports = EXCLUDED.reports
        WHERE (daily_snapshots.source_time, daily_snapshots.source_order) < (EXCLUDED.source_time, EXCLUDED.source_order)
        RETURNING report_date
      `;
      if (changed.length) {
        // Backfilled/corrected H-1 also updates an already stored next-day report.
        // Messages sent earlier are retained; /report retrieves the corrected version.
        const next = await tx<{ snapshot: Snapshot; source_time: string; date: string }[]>`
          SELECT snapshot, source_time::text, report_date::text AS date FROM daily_snapshots
          WHERE chat_id = ${chatId} AND report_date = ${date}::date + 1
        `;
        if (next[0]) {
          const updated = renderReports(next[0].snapshot, snapshot, Number(next[0].source_time), next[0].date);
          await tx`UPDATE daily_snapshots SET reports = ${tx.json(updated)}
            WHERE chat_id = ${chatId} AND report_date = ${next[0].date}::date`;
        }
      }
      const note = reconciliation(snapshot);
      const messages = note ? [...reports, note] : reports;
      await tx`
        INSERT INTO telegram_jobs (update_id, chat_id, messages)
        VALUES (${updateId}, ${chatId}, ${tx.json(messages)})
      `;
    });
  }

  async report(chatId: string, date?: string): Promise<string[]> {
    const rows = date ? await this.sql<{ reports: string[] }[]>`
      SELECT reports FROM daily_snapshots WHERE chat_id = ${chatId} AND report_date = ${date}::date
    ` : await this.sql<{ reports: string[] }[]>`
      SELECT reports FROM daily_snapshots WHERE chat_id = ${chatId} ORDER BY report_date DESC LIMIT 1
    `;
    return rows[0]?.reports ?? ['Belum ada laporan untuk tanggal tersebut. Upload CSV terlebih dahulu.'];
  }

  async claim(updateId: number, owner: string): Promise<Job | null> {
    const rows = await this.sql<Job[]>`
      UPDATE telegram_jobs SET lease_owner = ${owner}, lease_until = NOW() + INTERVAL '70 seconds'
      WHERE update_id = ${updateId} AND completed_at IS NULL
        AND (lease_until IS NULL OR lease_until < NOW())
      RETURNING update_id::text, chat_id, messages, delivered
    `;
    return rows[0] ?? null;
  }

  async advance(updateId: number, owner: string, delivered: number, done: boolean): Promise<void> {
    await this.sql`
      UPDATE telegram_jobs SET delivered = ${delivered}, completed_at = CASE WHEN ${done} THEN NOW() ELSE NULL END
      WHERE update_id = ${updateId} AND lease_owner = ${owner}
    `;
  }

  async release(updateId: number, owner: string): Promise<void> {
    await this.sql`
      UPDATE telegram_jobs SET lease_owner = NULL, lease_until = NULL
      WHERE update_id = ${updateId} AND lease_owner = ${owner}
    `;
  }
}
