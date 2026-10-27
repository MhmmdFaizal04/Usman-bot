# Deployment manual ke Vercel

## Yang sudah disiapkan

- Source bot berada di folder proyek ini.
- Token bot **@reportsulbagsel_bot**, koneksi Neon, dan webhook secret sudah diisi dalam **`.env` lokal**.
- Tabel Neon sudah dibuat: `daily_snapshots` dan `telegram_jobs`.
- Bot terbuka untuk semua pengguna, tanpa ID akun yang perlu didaftarkan.
- Snapshot dashboard lama tidak dimasukkan ke database.

## 1. Deploy source proyek

Anda dapat menghubungkan repository proyek ke Vercel, atau menjalankan Vercel CLI sendiri:

```powershell
npx vercel
```

Gunakan konfigurasi berikut:

| Pengaturan | Nilai |
|---|---|
| Framework | Other |
| Root Directory | Folder yang berisi `package.json` |
| Node.js | 24.x |
| Build Command | `npm run build` |
| Output Directory | `public` |

Deploy **source proyek**, bukan hanya folder `dist`. File `.env`, CSV pelanggan, JSON riwayat, dan dashboard lama dikecualikan dari repository/upload CLI oleh file ignore.

## 2. Isi environment variable Vercel

Buka **Project → Settings → Environment Variables**. Salin nilai dari `.env` lokal untuk environment **Production**:

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_WEBHOOK_SECRET
DATABASE_URL
```

Tidak perlu mengisi `PGHOST`, `PGPASSWORD`, `POSTGRES_URL`, atau variable koneksi alternatif; aplikasi cukup menggunakan `DATABASE_URL`.

Setelah environment tersimpan, lakukan **Redeploy**, atau jika menggunakan CLI:

```powershell
npx vercel --prod
```

Pastikan endpoint production dapat diakses Telegram; Vercel Authentication/Deployment Protection tidak boleh memblokir webhook production.

## 3. Daftarkan webhook

Setelah mendapatkan domain production Vercel, isi baris ini di `.env` lokal:

```dotenv
APP_URL=https://nama-project-anda.vercel.app
```

Kemudian jalankan dari folder proyek:

```powershell
npm run webhook:set
```

Command ini menghubungkan bot ke `https://nama-project-anda.vercel.app/api/telegram`. Token dan webhook secret lokal harus sama dengan yang Anda masukkan di Vercel.

## 4. Uji bot

1. Buka **https://t.me/reportsulbagsel_bot**.
2. Kirim `/start`.
3. Upload CSV sebagai dokumen.
4. Bot mengirim empat laporan branch, ditambah catatan jika ada tiket di luar cakupan.
5. Upload lagi pada hari yang sama jika data berubah.

H-1 otomatis tersedia setelah ada snapshot hari sebelumnya di chat yang sama. Untuk mengupload dua file historis hari ini:

1. Kirim `export (35).csv` dengan caption **`tanggal=2026-10-25`**.
2. Kirim `export (36).csv` dengan caption **`tanggal=2026-10-26`**.
3. Laporan tanggal 26 akan menggunakan data tanggal 25 sebagai H-1.

Tanpa caption, bot tetap menggunakan tanggal upload WITA. Jika file hari sebelumnya diupload belakangan, gunakan `/report 2026-10-26` untuk melihat pembanding yang telah diperbarui.

Anda juga bisa menulis caption tanggal saja, misalnya `2026-10-25` atau `2026-10-26`.

Semua anggota dalam satu grup menggunakan snapshot grup tersebut; chat lain memiliki riwayat sendiri.

## Pemeriksaan lokal opsional

```powershell
npm run connections:check
npm run db:check
npm test
npm run build
```

`connections:check` memeriksa koneksi Neon dan token Telegram. `db:check` menguji penyimpanan dalam transaksi yang di-rollback. Kedua command tidak mendaftarkan webhook atau mengirim laporan ke pengguna.

## Fitur baru VALINS

Setelah source terbaru diupload dan di-deploy, jalankan `npm run webhook:set` untuk memperbarui menu command. Tabel `valins_snapshots` sudah dibuat pada database proyek; jika menggunakan database lain, jalankan `npm run db:setup` terlebih dahulu.

Kirim `/menu`, lalu upload Excel `.xlsx`. Bot membaca **Sheet1** dan mengirim dua laporan PARE-PARE. `/valins_visit` mengambil laporan VISIT ODP, `/valins_dc` mengambil laporan DC, dan `/valins semua` mengambil kedua laporan untuk empat branch. H-1 VALINS berasal dari kolom Excel, sehingga tersedia sejak upload pertama jika workbook memuat nilainya. Panduan rumus dan contoh command tersedia di [VALINS.md](VALINS.md).
