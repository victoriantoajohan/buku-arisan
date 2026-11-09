#!/usr/bin/env node
/* Buku Arisan — backup data arisan (data, gambar QRIS, bukti transfer) ke satu file JSON.
 * Dijalankan oleh .github/workflows/backup.yml; workflow yang mengenkripsi dan menyimpan file-nya.
 *
 * Variabel lingkungan:
 *   ARISAN_ID   wajib  satu atau beberapa ID arisan (dipisah koma/spasi); link lengkap juga diterima
 *   OUT_DIR     folder keluaran (default ./backup-out)
 *   HAS_PASS    "true" bila secret BACKUP_PASSPHRASE diisi
 *   HAS_REPO    "true" bila secret BACKUP_REPO dan BACKUP_TOKEN diisi
 *
 * Log tidak memuat isi data, hanya jumlah.
 */
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = process.env;
const SCHEDULED = env.GITHUB_EVENT_NAME === "schedule";
const lines = [];
const out = l => { console.log(l); lines.push(l); };
const flush = () => { if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, "## Backup Buku Arisan\n\n" + lines.map(l => "- " + l).join("\n") + "\n"); };
const setOutput = (k, v) => { if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, k + "=" + v + "\n"); };
function notReady(msg) {
  if (SCHEDULED) { out("⏭️ Dilewati: " + msg); flush(); process.exit(0); }
  out("❌ " + msg); flush(); process.exit(1);
}

const cfg = readFileSync(join(ROOT, "config.js"), "utf8");
const SB_URL = env.SUPABASE_URL || (cfg.match(/https:\/\/[a-z0-9]+\.supabase\.co/) || [])[0];
const SB_KEY = env.SUPABASE_ANON_KEY || (cfg.match(/eyJ[A-Za-z0-9._-]+/) || [])[0];
if (!SB_URL || !SB_KEY) notReady("config.js belum berisi URL dan anon key Supabase.");

const ids = [...new Set(String(env.ARISAN_ID || "").match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) || [])];
if (!ids.length) notReady("Secret ARISAN_ID belum diisi.");
const hasPass = env.HAS_PASS === "true", hasRepo = env.HAS_REPO === "true";
if (!hasPass && !hasRepo) notReady("Tujuan backup belum diatur. Isi secret BACKUP_PASSPHRASE (backup terenkripsi di tab Actions) dan/atau BACKUP_REPO + BACKUP_TOKEN (repo privat).");

async function rpc(fn, args) {
  const res = await fetch(SB_URL + "/rest/v1/rpc/" + fn, {
    method: "POST",
    headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(args)
  });
  if (!res.ok) throw new Error(fn + " HTTP " + res.status);
  return res.json();
}

const items = [];
for (const id of ids) {
  const res = await rpc("get_arisan", { p_id: id }).catch(e => { out("❌ Gagal membaca arisan " + id.slice(0, 8) + "…: " + e.message); return undefined; });
  if (res === undefined) { flush(); process.exit(1); }
  if (!res) { out("⚠️ Arisan " + id.slice(0, 8) + "… tidak ditemukan, dilewati."); continue; }
  const data = res.data || {};
  const qr = res.qr_hash ? await rpc("get_arisan_qr", { p_id: id }) : null;
  const proofs = [];
  for (const [r, byMember] of Object.entries(data.payouts || {})) {
    for (const [member, po] of Object.entries(byMember || {})) {
      if (!po || !po.proof) continue;
      const image = await rpc("get_payout_proof", { p_id: id, p_round: +r, p_member: member });
      if (image) proofs.push({ round: +r, member, image });
    }
  }
  items.push({ format: "buku-arisan-backup", v: 1, exported_at: new Date().toISOString(), id, name: res.name, version: res.version, updated_at: res.updated_at, data, qr, proofs });
  out("✅ Arisan " + id.slice(0, 8) + "…: versi " + res.version + ", " + (data.members || []).length + " anggota, QR " + (qr ? "ada" : "tidak ada") + ", " + proofs.length + " bukti transfer");
}
if (!items.length) { out("❌ Tidak ada arisan yang bisa di-backup."); flush(); process.exit(1); }

const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const dir = env.OUT_DIR || join(ROOT, "backup-out");
mkdirSync(dir, { recursive: true });
const file = join(dir, "buku-arisan-backup-" + date + ".json");
const body = JSON.stringify({ format: "buku-arisan-backup-set", v: 1, exported_at: new Date().toISOString(), items });
writeFileSync(file, body);
out("Ukuran backup: " + Math.round(Buffer.byteLength(body) / 1024) + " KB · tujuan: " + [hasPass && "artifact terenkripsi", hasRepo && "repo privat"].filter(Boolean).join(" + "));
setOutput("file", file);
setOutput("date", date);
flush();
