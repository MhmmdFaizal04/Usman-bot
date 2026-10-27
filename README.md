# Bot Telegram Laporan UNSPEC Sulbagsel

Upload CSV di Telegram → bot mengirim empat laporan: **BONE, KENDARI, MAKASSAR, PARE-PARE**. Aplikasi siap untuk deployment manual ke Vercel.

Panduan singkat untuk deployment proyek yang sudah dikonfigurasi tersedia di **[DEPLOY.md](DEPLOY.md)**.

## Perilaku laporan

- CSV baru maupun lama diterima. Tanggal tiket tidak dijadikan tanggal laporan.
- Bot terbuka untuk **semua pengguna Telegram**, tanpa pendaftaran ID akun. Riwayat dipisahkan per chat.
- Tanpa caption, tanggal laporan adalah **tanggal pesan dokumen dikirim, zona WITA (Asia/Makassar)**. Jika webhook terlambat diproses, tanggal tetap mengikuti pengiriman awal, bukan waktu retry.
- Untuk file hari lain, beri caption **`tanggal=YYYY-MM-DD`** saat mengirim dokumen. Contoh: upload `export (35).csv` dengan `tanggal=2026-10-25`, lalu `export (36).csv` dengan `tanggal=2026-10-26`. H-1 laporan tanggal 26 berasal dari snapshot tanggal 25 meskipun keduanya diupload pada hari yang sama.
- Caption tanggal tanpa awalan juga diterima, misalnya **`2026-10-25`**. Tanggal tidak valid seperti `2026-02-30` tetap ditolak.
- Jika snapshot hari sebelumnya baru diupload/dikoreksi belakangan, laporan hari berikutnya yang tersimpan otomatis diperbarui. Gunakan `/report YYYY-MM-DD` untuk mengambil versi terbaru; pesan lama yang sudah dikirim tidak diedit.
- Setiap upload adalah snapshot lengkap, bukan penambahan tiket ke snapshot sebelumnya.
- Upload berulang pada hari yang sama menghasilkan laporan baru. Pesan upload terakhir menjadi snapshot acuan hari itu, walaupun proses upload sebelumnya baru selesai belakangan.
- H-1 menggunakan snapshot terakhir pada **tepat satu hari sebelumnya di chat yang sama**. Jika tidak tersedia, saldo H-1 dan growth bertuliskan `Belum tersedia`.
- Snapshot lama dari HTML/JSON tidak diimpor. Hanya master STO dan LIS yang diambil dari dashboard.
- Jika Anda mengirim ulang file identik melalui pesan baru, bot tetap membuat laporan. Pengulangan webhook untuk pesan yang sama dilanjutkan dari status pengiriman terakhir.
- Empat laporan dikirim sebagai pesan terpisah. Jika ada tiket di luar cakupan, duplikat, atau tiket yang disaring, ada satu pesan catatan tambahan.

## 1. Persiapan lokal

Gunakan **Node.js 24**. Buka terminal di folder proyek:

```powershell
npm install
```

Buat file `.env` dengan menyalin isi `.env.example`, lalu isi nilainya:

| Variable | Isi |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Token bot dari **@BotFather** |
| `TELEGRAM_WEBHOOK_SECRET` | String acak 16–256 karakter; hanya huruf, angka, `_`, `-` |
| `DATABASE_URL` | Connection string PostgreSQL, misalnya Neon dengan SSL |
| `APP_URL` | Domain production Vercel, misalnya `https://kkp-bot.vercel.app` |

Tidak perlu mengisi ID pengguna atau ID chat. Setiap pengguna dapat mengirim CSV ke bot; semua anggota di grup yang sama menggunakan riwayat snapshot grup tersebut.

Contoh membuat webhook secret:

```powershell
node -e "console.log(require('node:crypto').randomBytes(24).toString('hex'))"
```

## 2. Buat database PostgreSQL

Contoh menggunakan [Neon](https://neon.tech):

1. Buat project/database dan salin connection string **pooled** yang disediakan.
2. Masukkan connection string itu sebagai `DATABASE_URL` dalam `.env`.
3. Buat tabel:

```powershell
npm run db:setup
```

Alternatif: jalankan isi `db/schema.sql` di SQL Editor database Anda. Setup dapat diulang tanpa menghapus snapshot yang sudah ada.

Database hanya menyimpan ringkasan jumlah tiket per STO, LIS, teks laporan, dan status pengiriman; CSV mentah serta nama/nomor pelanggan tidak disimpan oleh aplikasi.

Untuk memeriksa koneksi database, tabel, dan token Telegram:

```powershell
npm run connections:check
```

Untuk menguji penyimpanan H/H-1, update harian, retry, dan isolasi chat langsung di database:

```powershell
npm run db:check
```

Uji database menggunakan transaksi sementara; seluruh data uji di-rollback dan tidak menjadi saldo harian pengguna.

## 3. Periksa aplikasi sebelum upload

```powershell
npm test
npm run build
npm run report:preview -- "export (36).csv"
```

Preview tidak memerlukan token atau database. Untuk mencoba growth dengan dua CSV:

```powershell
npm run report:preview -- "hari-ini.csv" "hari-sebelumnya.csv"
```

`npm run build` menghasilkan kompilasi TypeScript di `dist/`. Saat deploy, gunakan **folder proyek/source**, bukan hanya folder `dist`, karena Vercel membangun endpoint dari `api/`.

## 4. Deploy manual ke Vercel

### Melalui dashboard Vercel + repository Git

1. Upload source proyek ke repository Git milik Anda. File CSV, JSON riwayat, HTML dashboard lama, `.env`, `node_modules`, dan `dist` sudah masuk daftar ignore.
2. Vercel → **Add New → Project** → pilih repository tersebut.
3. Framework preset: **Other**.
4. Root Directory: folder tempat `package.json` berada.
5. Build Command: `npm run build`.
6. Output Directory: `public`.
7. Node.js Version: **24.x**.
8. Tambahkan environment variable dari `.env`: token, webhook secret, dan database. `APP_URL` bisa dilengkapi setelah domain tersedia.
9. Klik **Deploy**.
10. Pastikan `https://domain-anda.vercel.app/api/health` mengembalikan `{"ok":true,...}`. Endpoint health hanya mengecek bahwa function dapat diakses, bukan koneksi database/token.

### Melalui terminal, jika Anda memilih Vercel CLI

```powershell
npx vercel
```

Setelah project terhubung, atur environment variable pada dashboard Vercel, kemudian deploy production:

```powershell
npx vercel --prod
```

`.vercelignore` mengecualikan CSV, JSON riwayat, dan dashboard lama dari upload CLI. Jangan meletakkan file pelanggan di dalam `public/`.

Jika environment variable diubah setelah deployment, lakukan **Redeploy**. Pastikan domain production dapat menerima request Telegram; Deployment Protection/Vercel Authentication tidak boleh memblokir endpoint webhook production.

## 5. Hubungkan webhook Telegram

Setelah deploy selesai:

1. Isi `APP_URL` di `.env` lokal dengan domain **production**, bukan preview deployment sementara.
2. Pastikan token dan webhook secret di `.env` lokal sama dengan environment production Vercel.
3. Jalankan:

```powershell
npm run webhook:set
```

Script mendaftarkan `/api/telegram`, secret verifikasi, serta menu command bot. Tidak perlu menaruh token dalam URL browser. Satu bot Telegram hanya dapat memiliki satu webhook aktif.

## 6. Penggunaan

1. Buka bot dan kirim `/start`.
2. Kirim CSV sebagai **dokumen/file**, bukan screenshot.
3. Tunggu empat laporan. Data di luar cakupan akan dijelaskan melalui catatan tambahan.
4. Upload CSV lagi jika ada perubahan hari yang sama. Untuk data tanggal lain, isi caption `tanggal=YYYY-MM-DD` ketika mengirim file; caption lain yang tidak sesuai format akan ditolak agar tanggal tidak keliru.

Command:

```text
/start
/help
/report
/report 2026-10-27
```

Untuk grup, tambahkan bot dan izinkan mengirim pesan. Jika dokumen grup tidak diterima, nonaktifkan **Group Privacy** melalui @BotFather (`/setprivacy`) atau jadikan bot admin sesuai kebutuhan. Semua anggota grup dapat mengirim CSV. Untuk topic grup, balasan mengikuti topic tempat CSV dikirim; snapshot tetap dipisahkan per chat/grup, bukan per topic.

## Aturan CSV dan perhitungan

- Maksimum file **10 MB / 100.000 baris**. Mendukung delimiter koma/titik koma, UTF-8/BOM, dan UTF-16 dengan BOM untuk dokumen Telegram.
- Kolom wajib: `INCIDENT`, `WORKZONE`.
- Jika `SUMMARY` tersedia, hanya baris dengan kata `UNSPEC` yang dihitung.
- Jika `STATUS` tersedia, `CLOSED`, `CLOSE`, `RESOLVED`, `RESOLVE`, `CANCELLED`, dan `CANCELED` dikecualikan.
- Deduplikasi berdasarkan `INCIDENT`: baris terakhir digunakan.
- Pemetaan branch berdasarkan STO `WORKZONE`, mengikuti dashboard.
- STO di luar empat branch yang sudah dikenal master dikecualikan. STO yang belum dikenal membuat upload gagal, supaya saldo tidak keliru.
- CSV harus berupa **export lengkap**: STO/branch yang tidak muncul dianggap memiliki saldo **0**.
- Realisasi = saldo tiket ÷ LIS × 100%.
- Target saldo = `floor(LIS / 1000)`.
- Hijau jika saldo × 1000 ≤ LIS. Penentuan status menggunakan angka asli sebelum pembulatan.
- Growth = realisasi H − realisasi H-1. Format `%` mengikuti contoh pengguna; secara matematis ini selisih **poin persentase**, bukan pertumbuhan relatif.
- STO hijau diurutkan dari realisasi terendah; STO merah dari tertinggi. Semua STO dengan rasio tertinggi yang sama diberi label `(Tertinggi)`.
- LIS awal: BONE **44.600**, KENDARI **83.681**, MAKASSAR **152.298**, PARE-PARE **101.503**.
- Perbarui `src/master.ts` jika ada perubahan LIS/pemetaan, lalu build dan redeploy. Snapshot yang sudah tersimpan mempertahankan LIS dan teks laporannya saat diproses.

## Struktur proyek

```text
api/telegram.ts       Endpoint webhook Telegram
api/health.ts         Status server
src/report.ts         Parser CSV dan format laporan
src/master.ts         Master STO/LIS dari dashboard
src/store.ts          Snapshot harian dan status pengiriman
src/telegram.ts       Telegram API dan download file
db/schema.sql         Tabel PostgreSQL
scripts/              Setup database, webhook, preview
tests/                Uji parsing, kalkulasi, akses, Telegram API
public/               Halaman status publik
vercel.json           Konfigurasi deployment
```

## Pemulihan dan troubleshooting

- **Bot diam:** periksa webhook production, Deployment Protection, dan log function Vercel.
- **Database belum siap:** jalankan `npm run db:setup` dengan connection string yang sama seperti production.
- **H-1 kosong:** harus ada snapshot tanggal sebelumnya di chat yang sama. Anda bisa mengisi data historis dengan caption `tanggal=YYYY-MM-DD`. Dua file yang diupload hari ini tanpa caption sama-sama dianggap snapshot hari ini, bukan otomatis dua tanggal berbeda.
- **Laporan tidak lengkap karena gangguan sementara:** Telegram mengulang webhook; bot melanjutkan dari pesan yang belum tercatat terkirim. `/report` juga bisa digunakan untuk mengirim ulang laporan tersimpan.
- Dalam kondisi jarang ketika Telegram sudah menerima pesan tetapi koneksi terputus sebelum aplikasi menerima konfirmasi/menyimpan status, pesan tersebut bisa terkirim ulang saat retry. Telegram tidak menyediakan idempotency key untuk `sendMessage`.
- Tidak ada proses background yang dibiarkan berjalan setelah response. Semua pengiriman di-`await`, dan status tersimpan sebelum response sukses.

Pengujian lokal tidak membutuhkan credential. Uji live Telegram dan database production dilakukan setelah Anda mengisi environment, membuat tabel, dan deploy manual.
