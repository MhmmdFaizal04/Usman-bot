-- Snapshot terisolasi per chat. Tidak menyimpan nama/nomor pelanggan atau CSV mentah.
CREATE TABLE IF NOT EXISTS daily_snapshots (
  chat_id TEXT NOT NULL,
  report_date DATE NOT NULL,
  source_time BIGINT NOT NULL,
  source_order BIGINT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  snapshot JSONB NOT NULL,
  reports JSONB NOT NULL,
  PRIMARY KEY (chat_id, report_date)
);

-- Pesan disiapkan sekali per Telegram update, lalu dilanjutkan saat webhook diulang.
CREATE TABLE IF NOT EXISTS telegram_jobs (
  update_id BIGINT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  messages JSONB NOT NULL,
  delivered INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT,
  lease_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Terpisah dari UNSPEC; H-1 VALINS berasal dari kolom M/Y dalam Sheet1 Excel.
CREATE TABLE IF NOT EXISTS valins_snapshots (
  chat_id TEXT NOT NULL,
  report_date DATE NOT NULL,
  source_time BIGINT NOT NULL,
  source_order BIGINT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  snapshot JSONB NOT NULL,
  PRIMARY KEY (chat_id, report_date)
);
