#!/usr/bin/env node
/* Buku Arisan — kirim pengingat WhatsApp terjadwal.
 * Dijalankan oleh .github/workflows/reminder.yml (bisa juga lewat cron di server sendiri).
 *
 * Variabel lingkungan:
 *   ARISAN_ID        wajib  UUID arisan (bagian ?g=... di link)
 *   WA_PROVIDER      waha (default) | fonnte | webhook
 *   WAHA_URL         untuk waha: alamat server WAHA, mis. https://wa.contoh.com
 *   WAHA_API_KEY     untuk waha: nilai WHATSAPP_API_KEY di server WAHA
 *   WAHA_SESSION     untuk waha: nama sesi (default "default")
 *   FONNTE_TOKEN     untuk fonnte
 *   WA_WEBHOOK_URL   untuk webhook: menerima POST JSON {to, kind, message}
 *   WA_WEBHOOK_TOKEN untuk webhook (opsional): dikirim sebagai Authorization: Bearer
 *   WA_GROUP_ID      ID grup WA (WAHA: 1203...@g.us)
 *   TREASURER_PHONE  nomor bendahara untuk rekap, mis. 62812xxxx
 *   ARISAN_PIN       opsional: dipakai untuk mencatat "pengingat terkirim" di catatan aktivitas
 *   APP_URL          opsional: alamat aplikasi (default GitHub Pages repo ini)
 *   DRY_RUN=1        hanya menghitung, tidak mengirim
 *   FORCE=1          kirim walau hari ini bukan jadwal H-n
 *
 * Log GitHub Actions di repo publik bisa dilihat siapa saja, jadi skrip ini
 * tidak pernah mencetak isi pesan, nama lengkap, atau nomor telepon utuh.
 */
import { readFileSync, appendFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const core = require(join(ROOT, "reminder-core.js"));
const env = process.env;
const flag = v => /^(1|true|yes)$/i.test(String(v || ""));
const DRY = flag(env.DRY_RUN), FORCE = flag(env.FORCE);
const provider = (env.WA_PROVIDER || "waha").toLowerCase();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const mask = s => { s = String(s || ""); return s.length <= 6 ? "***" : s.slice(0, 4) + "****" + s.slice(-3); };
const initials = n => String(n || "").split(/\s+/).map(w => w[0] || "").join("").toUpperCase();
const summary = [];
const out = line => { console.log(line); summary.push(line); };

function fail(msg) { out("❌ " + msg); flush(); process.exit(1); }
function flush() { if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, "## Pengingat WhatsApp\n\n" + summary.map(l => "- " + l).join("\n") + "\n"); }

// --- konfigurasi Supabase dari config.js (anon key memang publik) ---
const cfgJs = readFileSync(join(ROOT, "config.js"), "utf8");
const SB_URL = env.SUPABASE_URL || (cfgJs.match(/https:\/\/[a-z0-9]+\.supabase\.co/) || [])[0];
const SB_KEY = env.SUPABASE_ANON_KEY || (cfgJs.match(/eyJ[A-Za-z0-9._-]+/) || [])[0];
if (!SB_URL || !SB_KEY) fail("config.js belum berisi URL dan anon key Supabase.");
if (!/^[0-9a-f-]{36}$/i.test(env.ARISAN_ID || "")) fail("Secret ARISAN_ID belum diisi atau formatnya salah.");

async function rpc(fn, args) {
  const res = await fetch(SB_URL + "/rest/v1/rpc/" + fn, {
    method: "POST",
    headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(args)
  });
  if (!res.ok) throw new Error(fn + " HTTP " + res.status);
  return res.json();
}

// --- pengirim per provider ---
const chatId = (to, kind) => kind === "group" ? to : (String(to).includes("@") ? to : String(to).replace(/\D/g, "") + "@c.us");
async function send(to, kind, message) {
  if (provider === "waha") {
    if (!env.WAHA_URL) throw new Error("WAHA_URL belum diisi");
    const res = await fetch(env.WAHA_URL.replace(/\/+$/, "") + "/api/sendText", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(env.WAHA_API_KEY ? { "X-Api-Key": env.WAHA_API_KEY } : {}) },
      body: JSON.stringify({ session: env.WAHA_SESSION || "default", chatId: chatId(to, kind), text: message })
    });
    if (!res.ok) throw new Error("WAHA HTTP " + res.status);
    return;
  }
  if (provider === "fonnte") {
    if (!env.FONNTE_TOKEN) throw new Error("FONNTE_TOKEN belum diisi");
    const res = await fetch("https://api.fonnte.com/send", {
      method: "POST", headers: { Authorization: env.FONNTE_TOKEN },
      body: new URLSearchParams({ target: String(to), message, countryCode: "62" })
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.status === false) throw new Error("Fonnte: " + (j.reason || "HTTP " + res.status));
    return;
  }
  if (provider === "webhook") {
    if (!env.WA_WEBHOOK_URL) throw new Error("WA_WEBHOOK_URL belum diisi");
    const res = await fetch(env.WA_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(env.WA_WEBHOOK_TOKEN ? { Authorization: "Bearer " + env.WA_WEBHOOK_TOKEN } : {}) },
      body: JSON.stringify({ to, kind, message })
    });
    if (!res.ok) throw new Error("Webhook HTTP " + res.status);
    return;
  }
  throw new Error("WA_PROVIDER tidak dikenal: " + provider);
}

// --- jalankan ---
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const repo = env.GITHUB_REPOSITORY || "";
const appUrl = (env.APP_URL || (repo ? "https://" + repo.split("/")[0] + ".github.io/" + repo.split("/")[1] + "/" : "")).replace(/\/?$/, "/");
const link = appUrl ? appUrl + "?g=" + env.ARISAN_ID : "";

let res;
try { res = await rpc("get_arisan", { p_id: env.ARISAN_ID }); } catch (e) { fail("Gagal membaca data arisan: " + e.message); }
if (!res) fail("Arisan dengan ARISAN_ID tersebut tidak ditemukan.");

const plan = core.build(res.data || {}, { today, url: link, hasQr: !!res.qr_hash, force: FORCE });
out("Tanggal (WIB): " + today + " · putaran " + (plan.round + 1) + " · kocokan " + plan.dueText + " (" + plan.label + ")");
out("Belum transfer: " + plan.unpaid.length + " orang · provider: " + provider + (DRY ? " · DRY RUN" : "") + (FORCE ? " · FORCE" : ""));
if (!plan.shouldSend) { out("Tidak ada yang dikirim: " + plan.reason); flush(); process.exit(0); }

const sent = { group: 0, personal: 0, treasurer: 0 }, errors = [];
async function attempt(label, fn) {
  if (DRY) { out("[dry-run] " + label); return true; }
  try { await fn(); out("✅ " + label); return true; }
  catch (e) { errors.push(label + ": " + e.message); out("⚠️ " + label + " gagal: " + e.message); return false; }
}

if (plan.group) {
  if (!env.WA_GROUP_ID) out("Lewati grup: secret WA_GROUP_ID belum diisi.");
  else if (await attempt("Grup (" + plan.group.length + " karakter)", () => send(env.WA_GROUP_ID, "group", plan.group))) sent.group = 1;
}
for (const [i, p] of plan.personal.entries()) {
  if (i > 0 && !DRY) await sleep(4000 + Math.floor(Math.random() * 4000)); // jeda acak supaya tidak dianggap spam
  if (await attempt("Japri " + initials(p.name) + " " + mask(p.phone), () => send(p.phone, "personal", p.message))) sent.personal++;
}
if (plan.noPhone.length) out("Tidak dijapri (tanpa nomor WA): " + plan.noPhone.length + " orang");
if (plan.treasurer) {
  if (!env.TREASURER_PHONE) out("Lewati rekap bendahara: secret TREASURER_PHONE belum diisi.");
  else {
    const extra = "\n\nPengingat " + plan.label + " terkirim: grup " + (sent.group ? "✓" : "✗") + ", japri " + sent.personal + "/" + plan.personal.length
      + (errors.length ? "\nGagal: " + errors.length + " (lihat tab Actions di GitHub)" : "");
    if (await attempt("Rekap bendahara " + mask(env.TREASURER_PHONE), () => send(env.TREASURER_PHONE, "personal", plan.treasurer + extra))) sent.treasurer = 1;
  }
}

// catat di aktivitas aplikasi (opsional, butuh PIN)
if (!DRY && env.ARISAN_PIN && (sent.group || sent.personal)) {
  for (let i = 0; i < 2; i++) {
    try {
      const cur = await rpc("get_arisan", { p_id: env.ARISAN_ID });
      const data = cur.data || {};
      data.log = [{ t: Date.now(), m: "Pengingat WA otomatis " + plan.label + " terkirim: grup " + (sent.group ? "✓" : "✗") + ", japri " + sent.personal + " orang (Putaran " + (plan.round + 1) + ")" }].concat(data.log || []).slice(0, 60);
      const s = await rpc("save_arisan", { p_id: env.ARISAN_ID, p_pin: env.ARISAN_PIN, p_data: data, p_version: cur.version });
      if (s && s.ok) { out("Dicatat di aktivitas aplikasi."); break; }
      if (!s || s.error !== "version_conflict") { out("Tidak bisa mencatat aktivitas: " + ((s && s.error) || "unknown")); break; }
    } catch (e) { out("Tidak bisa mencatat aktivitas: " + e.message); break; }
  }
}

flush();
if (errors.length) process.exit(1);
