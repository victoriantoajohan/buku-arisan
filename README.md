# Buku Arisan

Web app arisan: daftar anggota dan nominal, checklist transfer per putaran, kocok pemenang, riwayat, pengingat WhatsApp, dan ekspor CSV.

- **Frontend**: HTML + vanilla JS, tanpa build step (cukup upload folder ini).
- **Backend**: Supabase (Postgres). Data per arisan disimpan sebagai `jsonb`; semua akses lewat fungsi RPC.
- **Akses**: siapa pun yang punya link `?g=<id>` bisa melihat; hanya pemegang **PIN bendahara** yang bisa mengubah.
- **Sinkron**: Supabase Realtime (broadcast) + polling 20 detik sebagai cadangan.

```
buku-arisan/
├── index.html           # halaman + CSS
├── app.js               # logika aplikasi
├── config.js            # ← isi URL & anon key Supabase
└── supabase/schema.sql  # tabel + fungsi RPC (jalankan sekali)
```

Tanpa `config.js` diisi, aplikasi berjalan dalam **mode demo** (data contoh, tersimpan di browser saja). Ini cocok untuk mencoba tampilan.

---

## 1. Siapkan Supabase (±5 menit)

1. Daftar/masuk di https://supabase.com → **New project**. Pilih region **Southeast Asia (Singapore)** supaya cepat dari Indonesia.
2. Buka **SQL Editor → New query**, tempel seluruh isi `supabase/schema.sql`, lalu klik **Run**. Hasilnya harus "Success. No rows returned".
3. Buka **Project Settings → API** (atau **API Keys**), lalu salin:
   - **Project URL** → `https://xxxx.supabase.co`
   - **anon / public key**. Kalau dashboard menampilkan tab *Legacy API keys*, ambil `anon` dari situ.
4. Tempel keduanya ke `config.js`:

```js
window.ARISAN_CONFIG = {
  supabaseUrl: "https://xxxx.supabase.co",
  supabaseAnonKey: "eyJhbGciOi..."
};
```

> Anon key aman ditaruh di frontend. Tabel `arisan` dikunci RLS sehingga anon tidak bisa membaca atau menulis langsung. Perubahan hanya bisa lewat `save_arisan`, yang memeriksa PIN (hash bcrypt, terkunci 15 menit setelah 5 kali salah).

## 2. Deploy frontend

Pilih salah satu cara berikut.

### A. Netlify Drop (paling cepat, tanpa akun Git)
1. Buka https://app.netlify.com/drop
2. Seret **folder `buku-arisan`** ke halaman itu.
3. Selesai. Kamu akan mendapat URL `https://nama-acak.netlify.app`, dan nama situs bisa diganti di *Site configuration*.

### B. Vercel
```bash
cd buku-arisan
npx vercel          # login sekali, pilih "Other", tanpa build command
npx vercel --prod
```
Atau push folder ini ke GitHub → https://vercel.com/new → Import repo → Framework Preset: **Other** → Deploy.

### C. GitHub Pages
Push ke repo GitHub → **Settings → Pages** → Source: *Deploy from a branch* → `main` / root.

Domain sendiri (misalnya `arisan.namamu.id`) bisa ditambahkan dari pengaturan domain di Netlify atau Vercel.

## 3. Cara pakai

1. Buka URL situs → isi **Buat arisan baru** (nama, iuran, periode, tanggal kocokan pertama, PIN).
2. Kamu otomatis masuk sebagai bendahara di perangkat itu.
3. Klik **Salin link grup** dan bagikan ke grup WhatsApp. Anggota bisa melihat siapa yang sudah atau belum transfer.
4. Bendahara di HP lain cukup buka link yang sama → **Masuk bendahara** → masukkan PIN.

## Catatan

- **Realtime**: broadcast publik aktif secara default. Kalau di *Realtime → Settings* kamu mengaktifkan "private channels only", matikan opsi itu. Tanpa realtime pun data tetap tersinkron lewat polling setiap 20 detik.
- **Dua bendahara mengubah bersamaan**: penyimpanan memakai nomor versi. Yang kalah akan melihat data terbaru dan pesan untuk mengulangi perubahannya, jadi tidak ada data yang tertimpa diam-diam.
- **Lupa PIN**: ganti langsung di database (SQL Editor):
  ```sql
  update public.arisan
     set pin_hash = extensions.crypt('PIN-BARU', extensions.gen_salt('bf', 10)),
         failed_attempts = 0, locked_until = null
   where id = 'ID-ARISAN';
  ```
- **Spam pembuatan arisan**: `create_arisan` bisa dipanggil siapa saja yang tahu URL Supabase-mu. Untuk pemakaian pribadi atau keluarga ini cukup. Kalau situsnya publik, batasi dengan Supabase Auth atau hapus grant `create_arisan` dari `anon` setelah arisanmu dibuat.
- **Cadangan**: tab *Pengaturan → Unduh cadangan (.json)*, dan tab *Riwayat → Unduh CSV* untuk dibuka di Excel/Sheets.
- **Free tier Supabase**: project akan di-pause setelah 7 hari tanpa aktivitas. Buka situsnya sesekali, atau klik *Restore* di dashboard bila ter-pause.
