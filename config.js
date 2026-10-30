// Konfigurasi Supabase (Project Settings → API Keys → Legacy → anon).
// Anon key memang aman ditaruh di frontend: tabel dikunci RLS dan
// semua perubahan wajib lewat fungsi yang memeriksa PIN bendahara.
// JANGAN pernah menaruh service_role key di sini.
window.ARISAN_CONFIG = {
  supabaseUrl: "https://jebbcqzfnzdmxksfdgou.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImplYmJjcXpmbnpkbXhrc2ZkZ291Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMzMjUyNjYsImV4cCI6MjEwODkwMTI2Nn0.TA0ZwhSqtbqwFxhmRALAy7Qlv3C5YE_lWEm6ZWsO5yU"
};
