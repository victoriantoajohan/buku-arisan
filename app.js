/* Buku Arisan — frontend (vanilla JS, tanpa build step)
 * Penyimpanan: Supabase RPC (lihat supabase/schema.sql). Tanpa config → mode demo (localStorage).
 */
(function(){
"use strict";
const $ = s => document.querySelector(s);
const app = $("#app");

/* ---------- konfigurasi & koneksi ---------- */
const CFG = window.ARISAN_CONFIG || {};
const params = new URLSearchParams(location.search);
const GID = params.get("g");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hasBackend = !!(CFG.supabaseUrl && CFG.supabaseAnonKey && window.supabase);
const sb = hasBackend ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { persistSession: false } }) : null;
const DEMO_KEY = "buku-arisan-demo-v1";
const PIN_KEY = id => "buku-arisan-pin-" + id;
const RECENT_KEY = "buku-arisan-recent";

const blank = (o) => {
  const d = Object.assign({ v:1, sample:false, name:"Arisan", defaultAmount:200000, cycle:"bulanan", winnersPerRound:1,
    startDate:new Date().toISOString().slice(0,10), current:0, members:[], payments:{}, winners:{}, log:[], pay:null }, o || {});
  const pay = d.pay && typeof d.pay === "object" ? d.pay : {};
  d.payouts = d.payouts && typeof d.payouts === "object" ? d.payouts : {};
  d.pay = { note: String(pay.note || ""), accounts: (Array.isArray(pay.accounts) ? pay.accounts : []).map(a => ({ id: a.id || ("a" + Math.random().toString(36).slice(2,8)), bank: String(a.bank||""), number: String(a.number||""), holder: String(a.holder||"") })) };
  // kompatibel dengan data lama: winners[r] dulu berupa string, sekarang array id
  const w = {};
  for (const k in (d.winners || {})) { const v = d.winners[k]; const arr = Array.isArray(v) ? v.filter(Boolean) : (v ? [v] : []); if (arr.length) w[k] = arr; }
  d.winners = w;
  d.winnersPerRound = Math.min(10, Math.max(1, parseInt(d.winnersPerRound, 10) || 1));
  return d;
};

const SAMPLE = {"v":1,"sample":true,"name":"Arisan Keluarga Besar","defaultAmount":200000,"cycle":"bulanan","startDate":"2026-09-01","current":2,"members":[{"id":"m1","name":"Bu Ratna","amount":200000,"phone":"6281234500001"},{"id":"m2","name":"Pak Hendra","amount":200000,"phone":"6281234500002"},{"id":"m3","name":"Siti Aminah","amount":200000,"phone":""},{"id":"m4","name":"Dewi Lestari","amount":200000,"phone":"6281234500004"},{"id":"m5","name":"Mas Bayu","amount":200000,"phone":""},{"id":"m6","name":"Tante Lina","amount":400000,"phone":"6281234500006"},{"id":"m7","name":"Om Agus","amount":200000,"phone":""},{"id":"m8","name":"Rina Wulandari","amount":200000,"phone":"6281234500008"}],"payments":{"0":{"m1":"2026-08-29T09:10:00Z","m2":"2026-08-30T03:00:00Z","m3":"2026-08-30T05:00:00Z","m4":"2026-08-31T02:00:00Z","m5":"2026-08-31T08:00:00Z","m6":"2026-08-28T07:00:00Z","m7":"2026-09-01T01:00:00Z","m8":"2026-08-30T10:00:00Z"},"1":{"m1":"2026-09-28T09:10:00Z","m2":"2026-09-29T03:00:00Z","m3":"2026-09-30T05:00:00Z","m4":"2026-09-30T02:00:00Z","m5":"2026-10-02T08:00:00Z","m6":"2026-09-27T07:00:00Z","m7":"2026-09-30T01:00:00Z","m8":"2026-09-29T10:00:00Z"},"2":{"m1":"2026-10-27T09:10:00Z","m4":"2026-10-28T02:00:00Z","m6":"2026-10-26T07:00:00Z","m8":"2026-10-29T10:00:00Z","m2":"2026-10-29T12:00:00Z"}},"winners":{"0":"m4","1":"m7"},"log":[]};

let S = blank();
let view = "loading";          // loading | landing | app | notfound | error
let mode = hasBackend ? "remote" : "demo";
let isAdmin = false;
let pin = null;
let version = 0;
let saveState = "idle";        // idle | saving | saved | error
let saveTimer = null, saving = false, dirty = false;
let channel = null;
let loadError = "";
let qrData = null, qrHash = null;   // gambar QR disimpan terpisah dari data utama
const DEMO_QR_KEY = "buku-arisan-demo-qr";
const proofCache = {};               // hash -> data URL
const demoProofKey = (r, id) => "buku-arisan-demo-proof-" + r + "-" + id;
const BANKS = ["BCA","BRI","BNI","Mandiri","BSI","CIMB Niaga","Permata","Danamon","BTN","OCBC","Bank Jago","SeaBank","blu by BCA Digital","Jenius","DANA","OVO","GoPay","ShopeePay","LinkAja"];

const ui = { rollCount: 1, round: 0, tab: "anggota", filter: "semua", q: "", editing: null, armed: {}, rolling: false, rollName: "", login: false, loginErr: "", createErr: "", busy: false };

/* ---------- helpers ---------- */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const rp = n => "Rp " + Math.round(Number(n)||0).toLocaleString("id-ID");
const uid = () => "m" + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
const K = () => Math.min(10, Math.max(1, parseInt(S.winnersPerRound, 10) || 1));
const totalRounds = () => Math.max(1, Math.ceil(S.members.length / K()));
const slots = r => Math.max(1, Math.min(K(), S.members.length - K() * r));
const roundDate = i => {
  const d = new Date((S.startDate || "2026-01-01") + "T00:00:00");
  if (S.cycle === "mingguan") d.setDate(d.getDate() + 7*i);
  else if (S.cycle === "2mingguan") d.setDate(d.getDate() + 14*i);
  else d.setMonth(d.getMonth() + i);
  return d;
};
const fDate = (d, o) => d.toLocaleDateString("id-ID", o || {day:"numeric", month:"short", year:"numeric"});
const fShort = iso => fDate(new Date(iso), {day:"numeric", month:"short"});
const paidMap = r => (S.payments[r] = S.payments[r] || {});
const isPaid = (r, id) => !!(S.payments[r] && S.payments[r][id]);
const winIds = r => (S.winners[r] || []).filter(id => S.members.some(m => m.id === id));
const winnersOf = r => winIds(r).map(id => S.members.find(m => m.id === id));
const wonRound = id => { for (const k in S.winners) if ((S.winners[k] || []).includes(id)) return +k; return -1; };
const allWinnerIds = () => { const s = new Set(); for (const k in S.winners) (S.winners[k] || []).forEach(id => s.add(id)); return s; };
const setRound = (r, ids) => { if (ids.length) S.winners[r] = ids; else delete S.winners[r]; };
const pot = () => S.members.reduce((a, m) => a + (Number(m.amount)||0), 0);
const payout = r => pot() / slots(r);
const names = ms => ms.length <= 1 ? (ms[0] ? ms[0].name : "") : ms.slice(0, -1).map(m => m.name).join(", ") + " & " + ms[ms.length-1].name;
const collected = r => S.members.reduce((a, m) => a + (isPaid(r, m.id) ? Number(m.amount)||0 : 0), 0);
const cycleLabel = {bulanan:"Bulanan", "2mingguan":"Dua mingguan", mingguan:"Mingguan"};
const normPhone = p => { let d = String(p||"").replace(/\D/g, ""); if (d.startsWith("0")) d = "62" + d.slice(1); return d; };
const digits = v => Number(String(v||"").replace(/\D/g, "")) || 0;
const lsGet = k => { try { return localStorage.getItem(k); } catch(e){ return null; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch(e){} };
const readOnly = () => !isAdmin;
const shareUrl = () => location.origin + location.pathname + "?g=" + GID;
const icon = { check:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' };
const ERR = {
  invalid_input: "Data tidak valid.", too_many: "Batas jumlah bukti transfer tercapai.",
  invalid_image: "File harus berupa gambar PNG, JPG, atau WebP.",
  invalid_pin: "PIN salah.", locked: "Terlalu banyak percobaan salah. Coba lagi 15 menit lagi.",
  not_found: "Arisan tidak ditemukan.", pin_too_short: "PIN minimal 4 karakter.",
  name_required: "Nama arisan wajib diisi.", too_large: "Data terlalu besar."
};

function toast(msg){
  const old = $(".toast"); if (old) old.remove();
  const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; t.setAttribute("role","status");
  document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
}
async function copy(text, done){
  try { await navigator.clipboard.writeText(text); toast(done || "Tersalin"); }
  catch(e){
    const ta = $("#copyFallback");
    if (ta){ ta.hidden = false; ta.value = text; ta.focus(); ta.select(); toast("Teks sudah dipilih, tekan Ctrl/⌘+C"); }
  }
}
function downloadUrl(filename, url){
  const a = document.createElement("a"); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 500);
}
function download(filename, text, type){
  const blob = new Blob([text], {type: type || "text/plain"});
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
function arm(key){
  if (ui.armed[key]) { delete ui.armed[key]; return true; }
  ui.armed = {}; ui.armed[key] = true;
  setTimeout(() => { if (ui.armed[key]) { delete ui.armed[key]; render(); } }, 3500);
  render(); return false;
}
function rememberRecent(id, name){
  let list = []; try { list = JSON.parse(lsGet(RECENT_KEY) || "[]"); } catch(e){}
  list = [{id, name}].concat(list.filter(x => x.id !== id)).slice(0, 8);
  lsSet(RECENT_KEY, JSON.stringify(list));
}
async function rpc(fn, args){
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw error;
  return data;
}

/* ---------- persistence ---------- */
function commit(msg){
  if (msg){ S.log.unshift({t: Date.now(), m: msg}); S.log = S.log.slice(0, 60); }
  render();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, mode === "remote" ? 600 : 150);
}
async function save(){
  saveTimer = null;
  if (mode === "demo") { lsSet(DEMO_KEY, JSON.stringify(S)); saveState = "saved"; renderStatus(); return; }
  if (!isAdmin) return;
  if (saving) { dirty = true; return; }
  saving = true; dirty = false; saveState = "saving"; renderStatus();
  try {
    const res = await rpc("save_arisan", { p_id: GID, p_pin: pin, p_data: S, p_version: version });
    if (res && res.ok) {
      version = res.version; saveState = "saved";
      rememberRecent(GID, S.name);
      if (channel) channel.send({ type: "broadcast", event: "updated", payload: { version } });
    } else {
      const code = res && res.error;
      if (code === "version_conflict") { toast("Ada perubahan dari bendahara lain. Data terbaru dimuat; ulangi perubahanmu bila perlu."); dirty = false; await loadRemote(true); }
      else if (code === "invalid_pin" || code === "locked") { logout(); toast(ERR[code]); }
      else { saveState = "error"; toast(ERR[code] || "Gagal menyimpan."); }
    }
  } catch(e) {
    saveState = "error"; dirty = true; toast("Gagal tersambung. Perubahan akan dicoba simpan lagi.");
    setTimeout(() => { if (dirty && !saveTimer) save(); }, 5000);
  } finally {
    saving = false; renderStatus();
    if (dirty && isAdmin && saveState !== "error") save();
  }
}
function applyRemote(res){
  S = blank(Object.assign({}, res.data || {}, { name: (res.data && res.data.name) || res.name }));
  version = res.version;
  ui.round = Math.min(ui.round, totalRounds()-1);
  document.title = S.name + " · Buku Arisan";
}
async function syncQr(hash){
  hash = hash || null;
  if (hash === qrHash) return;
  qrHash = hash;
  if (!hash) { qrData = null; render(); return; }
  try { qrData = await rpc("get_arisan_qr", { p_id: GID }); } catch(e) { qrHash = null; }
  render();
}
async function loadRemote(force){
  try {
    const res = await rpc("get_arisan", { p_id: GID });
    if (!res) { view = "notfound"; render(); return; }
    syncQr(res.qr_hash);
    if (force || res.version > version) {
      const first = view !== "app";
      applyRemote(res);
      if (first) ui.round = S.current;
      view = "app"; render();
    }
  } catch(e) {
    if (view !== "app") { view = "error"; loadError = e.message || String(e); render(); }
  }
}
function pendingLocal(){ return saving || dirty || !!saveTimer || ui.rolling; }
function startSync(){
  channel = sb.channel("arisan-" + GID, { config: { broadcast: { self: false } } });
  channel.on("broadcast", { event: "updated" }, ({ payload }) => {
    if (payload && payload.version > version && !pendingLocal()) loadRemote(false);
  }).on("broadcast", { event: "qr" }, ({ payload }) => { if (payload) syncQr(payload.qr_hash); }).subscribe();
  setInterval(() => { if (document.visibilityState === "visible" && !pendingLocal()) loadRemote(false); }, 20000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && !pendingLocal()) loadRemote(false); });
}
async function tryLogin(p, silent){
  try {
    const res = await rpc("check_pin", { p_id: GID, p_pin: p });
    if (res && res.ok) { pin = p; isAdmin = true; lsSet(PIN_KEY(GID), p); ui.login = false; ui.loginErr = ""; render(); if (!silent) toast("Masuk sebagai bendahara"); return; }
    if (!silent) { ui.loginErr = ERR[res && res.error] || "Gagal masuk."; render(); }
    else lsSet(PIN_KEY(GID), null);
  } catch(e){ if (!silent) { ui.loginErr = "Gagal tersambung."; render(); } }
}
function logout(){ isAdmin = false; pin = null; lsSet(PIN_KEY(GID), null); render(); }

async function boot(){
  if (mode === "demo") {
    let L = null; try { L = JSON.parse(lsGet(DEMO_KEY) || "null"); } catch(e){}
    S = blank(L && L.v === 1 ? L : JSON.parse(JSON.stringify(SAMPLE)));
    qrData = lsGet(DEMO_QR_KEY);
    isAdmin = true; ui.round = S.current; view = "app"; render(); return;
  }
  if (!GID) { view = "landing"; render(); return; }
  if (!UUID_RE.test(GID)) { view = "notfound"; render(); return; }
  render();
  await loadRemote(true);
  if (view !== "app") return;
  rememberRecent(GID, S.name);
  startSync();
  const saved = lsGet(PIN_KEY(GID));
  if (saved) tryLogin(saved, true);
}

/* ---------- views ---------- */
function statusChip(){
  if (mode === "demo") return '<span class="chip gold"><i class="dot"></i>Mode demo · tersimpan di perangkat ini</span>';
  if (!isAdmin) return '<span class="chip"><i class="dot"></i>Mode lihat</span>';
  if (saveState === "saving") return '<span class="chip acc"><i class="dot"></i>Menyimpan…</span>';
  if (saveState === "error") return '<span class="chip warn"><i class="dot"></i>Belum tersimpan</span>';
  return '<span class="chip ok"><i class="dot"></i>Tersimpan online</span>';
}
function renderStatus(){ const el = $("#status"); if (el) el.innerHTML = statusChip(); }

function render(){
  const ae = document.activeElement && document.activeElement.id;
  let html;
  if (view === "loading") html = '<div class="wrap"><div class="empty">Memuat arisan…</div></div>';
  else if (view === "landing") html = viewLanding();
  else if (view === "notfound") html = '<div class="wrap landing"><div class="panel"><h2>Arisan tidak ditemukan</h2><p class="muted" style="margin:0">Periksa kembali link yang kamu terima dari bendahara.</p><div class="actions"><a class="btn" href="' + esc(location.pathname) + '">Buat arisan baru</a></div></div></div>';
  else if (view === "error") html = '<div class="wrap landing"><div class="panel"><h2>Gagal memuat</h2><p class="muted" style="margin:0">' + esc(loadError) + '</p><div class="actions"><button data-act="reload">Coba lagi</button></div></div></div>';
  else html = viewApp();
  app.innerHTML = html;
  if (ae && document.getElementById(ae) && ae !== "copyFallback") { const el = document.getElementById(ae); el.focus(); if (el.type === "search" && el.setSelectionRange) { const v = el.value.length; el.setSelectionRange(v, v); } }
}

function viewLanding(){
  let recent = []; try { recent = JSON.parse(lsGet(RECENT_KEY) || "[]"); } catch(e){}
  const today = new Date().toISOString().slice(0,10);
  let h = '<div class="wrap landing"><header class="hero"><div class="eyebrow">Buku Arisan</div><h1>Catat iuran, kocok pemenang, kirim pengingat.</h1>'
    + '<p>Buat arisan baru, lalu bagikan linknya ke grup. Semua anggota bisa melihat siapa yang sudah transfer, dan hanya bendahara yang memegang PIN bisa mengubah data.</p></header>';
  if (recent.length) h += '<section class="panel recent"><h2>Arisan di perangkat ini</h2><div class="list">'
    + recent.map(r => '<div class="row" style="grid-template-columns:1fr auto"><a href="?g=' + esc(r.id) + '">' + esc(r.name) + '</a><span class="chip">' + (lsGet(PIN_KEY(r.id)) ? 'Bendahara' : 'Anggota') + '</span></div>').join("") + '</div></section>';
  h += '<section class="panel"><h2>Buat arisan baru</h2><form id="createForm" class="form" autocomplete="off">'
    + '<label class="f" style="grid-column:1/-1">Nama arisan<input id="c_name" required maxlength="120" placeholder="mis. Arisan Ibu-Ibu RT 05"></label>'
    + '<label class="f">Iuran per orang (Rp)<input id="c_amount" inputmode="numeric" value="200000"></label>'
    + '<label class="f">Periode<select id="c_cycle">' + Object.entries(cycleLabel).map(([k,l]) => '<option value="' + k + '">' + l + '</option>').join("") + '</select></label>'
    + '<label class="f">Tanggal kocokan pertama<input id="c_start" type="date" value="' + today + '"></label>'
    + '<label class="f">Pemenang per putaran<select id="c_k">' + [1,2,3,4,5].map(k => '<option value="' + k + '">' + k + ' orang</option>').join("") + '</select></label>'
    + '<label class="f">PIN bendahara<input id="c_pin" type="password" inputmode="numeric" minlength="4" required placeholder="minimal 4 angka"></label>'
    + '<label class="f">Ulangi PIN<input id="c_pin2" type="password" inputmode="numeric" minlength="4" required></label>'
    + (ui.createErr ? '<div class="err" style="grid-column:1/-1">' + esc(ui.createErr) + '</div>' : '')
    + '<div class="actions" style="grid-column:1/-1"><button class="primary" type="submit"' + (ui.busy?' disabled':'') + '>' + (ui.busy ? 'Membuat…' : 'Buat arisan') + '</button></div>'
    + '</form><p class="muted" style="margin:0;font-size:13px">Simpan PIN baik-baik. PIN tidak bisa dipulihkan, tapi bisa diganti selama kamu masih ingat PIN lama.</p></section></div>';
  return h;
}

function viewApp(){
  const r = Math.min(ui.round, totalRounds()-1);
  ui.round = r;
  const RO = readOnly();
  const N = S.members.length, P = pot(), C = collected(r);
  const paidN = S.members.filter(m => isPaid(r, m.id)).length;
  const pct = P ? Math.round(C / P * 100) : 0;
  const ws = winnersOf(r), need = slots(r) - ws.length;
  const winnersSet = allWinnerIds();
  const notYet = S.members.filter(m => !winnersSet.has(m.id));
  const isCur = r === S.current;
  const dis = RO ? ' disabled' : '';

  let html = '<div class="wrap">';
  html += '<header class="top"><div><div class="eyebrow">Buku Arisan</div><h1>' + esc(S.name || "Arisan") + '</h1>'
    + '<div class="meta"><span>' + esc(cycleLabel[S.cycle] || "Bulanan") + '</span><span class="num">' + rp(S.defaultAmount) + ' / orang</span><span>' + N + ' anggota</span>' + (K() > 1 ? '<span>' + K() + ' pemenang / putaran</span>' : '') + '<span>Mulai ' + fDate(roundDate(0)) + '</span></div></div>'
    + '<div class="hdr-actions"><span id="status">' + statusChip() + '</span>';
  if (mode === "remote") {
    html += '<button data-act="share">Salin link grup</button>';
    html += isAdmin ? '<button class="ghost" data-act="logout">Keluar</button>' : '<button class="primary" data-act="openLogin">Masuk bendahara</button>';
  }
  html += '</div></header>';

  if (ui.login && !isAdmin) {
    html += '<form class="banner info login" id="loginForm"><label class="f">PIN bendahara<input id="pin" type="password" inputmode="numeric" autocomplete="current-password" required></label>'
      + '<button class="primary" type="submit">Masuk</button><button type="button" class="ghost" data-act="closeLogin">Batal</button>'
      + (ui.loginErr ? '<span class="err">' + esc(ui.loginErr) + '</span>' : '') + '</form>';
  }
  if (S.sample) html += '<div class="banner"><span><b>Ini data contoh.</b> Coba centang, kocok, dan lihat riwayatnya.</span><button data-act="clearSample">Mulai dari kosong</button></div>';
  if (mode === "remote" && !isAdmin && !ui.login) html += '<div class="banner info"><span>Kamu sedang melihat status arisan. Bendahara bisa masuk dengan PIN untuk mengubah data.</span></div>';

  html += '<div class="grid"><section class="panel" aria-label="Putaran">';
  html += '<div class="round-nav"><div><div class="eyebrow">Putaran ' + (r+1) + ' dari ' + totalRounds() + (isCur ? ' · berjalan' : (r < S.current ? ' · selesai' : ' · akan datang')) + '</div>'
    + '<h2>Kocokan ' + fDate(roundDate(r), {weekday:"long", day:"numeric", month:"long", year:"numeric"}) + '</h2></div>'
    + '<div class="r"><button class="ghost" data-act="prev" aria-label="Putaran sebelumnya"' + (r<=0?' disabled':'') + '>‹ Sebelumnya</button>'
    + '<button class="ghost" data-act="next" aria-label="Putaran berikutnya"' + (r>=totalRounds()-1?' disabled':'') + '>Berikutnya ›</button></div></div>';
  html += '<div class="pot"><span class="eyebrow">Terkumpul</span><div class="big">' + rp(C) + '</div>'
    + '<div class="muted">dari <span class="num">' + rp(P) + '</span> · ' + pct + '%' + (slots(r) > 1 ? ' · dibagi ' + slots(r) + ' pemenang, <span class="num">' + rp(payout(r)) + '</span>/orang' : '') + '</div>'
    + '<div class="bar" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100"><i style="width:' + pct + '%"></i></div></div>';
  html += '<div class="stats"><div class="stat"><b>' + paidN + '/' + N + '</b><span>Sudah transfer</span></div>'
    + '<div class="stat"><b>' + (N - paidN) + '</b><span>Belum transfer</span></div>'
    + '<div class="stat"><b>' + rp(P - C) + '</b><span>Kurang</span></div></div>';
  html += '<div class="actions">'
    + '<button data-act="remind"' + (N-paidN===0?' disabled':'') + '>Salin pengingat WA</button>'
    + '<button data-act="summary"' + (N===0?' disabled':'') + '>Salin rekap</button>'
    + (RO ? '' : '<button data-act="allPaid"' + (N===0||paidN===N?' disabled':'') + '>' + (ui.armed.allPaid ? 'Yakin tandai semua?' : 'Tandai semua lunas') + '</button>')
    + (!RO && isCur && r < totalRounds()-1 ? '<button class="primary" data-act="advance">' + (ui.armed.advance ? 'Yakin lanjut?' : 'Mulai putaran ' + (r+2)) + '</button>' : '')
    + (!RO && !isCur ? '<button data-act="setCurrent">Jadikan putaran berjalan</button>' : '')
    + '</div><textarea id="copyFallback" hidden aria-label="Teks untuk disalin"></textarea></section>';

  html += '<section class="panel" aria-label="Kocokan"><div class="toolbar"><h2>Kocokan</h2><span class="chip gold">' + notYet.length + ' belum dapat</span></div>';
  const fundChip = paidN < N ? '<span class="chip warn">Dana belum lengkap: kurang ' + rp(P-C) + '</span>' : '<span class="chip ok">Dana lengkap, siap diserahkan</span>';
  if (ui.rolling) {
    html += '<div class="drum"><span class="eyebrow">Mengocok ' + ui.rollCount + ' pemenang…</span><div class="slip rolling" id="rollName">' + esc(ui.rollName) + '</div></div>';
  } else if (ws.length) {
    html += '<div class="drum won"><span class="eyebrow">Penerima putaran ' + (r+1) + (slots(r) > 1 ? ' · ' + ws.length + ' dari ' + slots(r) : '') + '</span>'
      + '<div class="slip">' + ws.map(m => esc(m.name)).join('<br>') + '</div><div class="amt">' + rp(payout(r)) + (slots(r) > 1 ? ' per orang' : '') + '</div>'
      + (ws.every(m => payoutOf(r, m.id)) ? '<span class="chip ok">Sudah ditransfer bendahara</span>' : fundChip) + '</div>';
  } else {
    html += '<div class="drum"><span class="eyebrow">Putaran ' + (r+1) + ' · ' + slots(r) + ' pemenang</span><div class="slip">' + (notYet.length ? '?' : (N ? 'Semua sudah dapat' : 'Belum ada anggota')) + '</div>'
      + '<div class="muted" style="font-size:13px">' + (notYet.length ? 'Diundi dari ' + notYet.length + ' anggota yang belum pernah dapat' + (slots(r) > 1 ? ', masing-masing dapat ' + rp(payout(r)) : '') : (N ? 'Arisan sudah selesai satu siklus' : 'Tambahkan anggota dulu')) + '</div></div>';
  }
  if (ws.length && !ui.rolling) html += winnerRows(r, ws, notYet, RO);
  if (!RO && !ui.rolling) {
    if (need > 0 && notYet.length) {
      const unpaid = N - paidN, n = Math.min(need, notYet.length);
      html += '<div class="actions"><button class="gold" data-act="roll">' + (ui.armed.roll ? unpaid + ' belum transfer, tetap kocok?' : (ws.length ? 'Kocok ' + n + ' pemenang lagi' : 'Kocok ' + (n > 1 ? n + ' pemenang' : 'pemenang'))) + '</button>'
        + '<select id="manualWin" aria-label="Pilih penerima manual" style="width:auto;flex:1"><option value="">Atau pilih manual…</option>'
        + notYet.map(m => '<option value="' + esc(m.id) + '">' + esc(m.name) + '</option>').join("") + '</select></div>';
    }
  }
  html += '<div><div class="eyebrow" style="margin-bottom:8px">Belum dapat</div><div class="queue">'
    + (notYet.length ? notYet.map(m => '<span class="chip">' + esc(m.name) + '</span>').join("") : '<span class="muted">Tidak ada</span>') + '</div></div></section></div>';

  html += viewPay(r);
  const tabs = [["anggota","Anggota & checklist"],["riwayat","Riwayat"],["laporan","Laporan"]].concat(RO ? [] : [["pengaturan","Pengaturan"]]);
  if (RO && ui.tab === "pengaturan") ui.tab = "anggota";
  html += '<div class="tabs" role="tablist">' + tabs.map(([k,l]) => '<button role="tab" data-act="tab" data-v="' + k + '" aria-selected="' + (ui.tab===k) + '">' + l + '</button>').join("") + '</div>';
  if (ui.tab === "anggota") html += viewMembers(r);
  else if (ui.tab === "riwayat") html += viewHistory();
  else if (ui.tab === "laporan") html += viewReport();
  else html += viewSettings();
  html += '<footer>Putaran berjalan: ' + (S.current+1) + ' · Pot per putaran ' + rp(P) + (mode === "remote" ? ' · <a href="' + esc(location.pathname) + '" style="color:inherit">Arisan lain</a>' : '') + '</footer></div>';
  return html;
}

function viewMembers(r){
  let h = '<section class="panel" aria-label="Anggota"><div class="toolbar"><div class="seg" role="group" aria-label="Saring">'
    + [["semua","Semua"],["belum","Belum transfer"],["sudah","Sudah transfer"]].map(([k,l]) => '<button data-act="filter" data-v="' + k + '" aria-pressed="' + (ui.filter===k) + '">' + l + '</button>').join("")
    + '</div><input id="q" class="search" type="search" placeholder="Cari nama…" value="' + esc(ui.q) + '" aria-label="Cari anggota"></div>';
  h += '<div class="list" id="list">' + listRows(r) + '</div>';
  if (!readOnly()) {
    h += '<form class="add" id="addForm" autocomplete="off"><label class="f full">Nama anggota<input id="m_name" required maxlength="80" placeholder="mis. Bu Yanti"></label>'
      + '<label class="f">Nominal (Rp)<input id="m_amount" inputmode="numeric" value="' + (S.defaultAmount||"") + '"></label>'
      + '<label class="f">No. WhatsApp (opsional)<input id="m_phone" inputmode="tel" placeholder="08…"></label>'
      + '<button class="primary" type="submit">Tambah</button></form>';
  }
  return h + '</section>';
}

function listRows(r){
  const RO = readOnly();
  const q = ui.q.trim().toLowerCase();
  const rows = S.members.filter(m => (!q || m.name.toLowerCase().includes(q)) && (ui.filter === "semua" || (ui.filter === "sudah") === isPaid(r, m.id)));
  if (!S.members.length) return '<div class="empty">' + (RO ? 'Belum ada anggota.' : 'Belum ada anggota. Tambahkan nama di bawah untuk mulai.') + '</div>';
  if (!rows.length) return '<div class="empty">Tidak ada anggota yang cocok.</div>';
  return rows.map(m => {
    if (ui.editing === m.id && !RO) {
      return '<form class="edit-row" data-id="' + esc(m.id) + '" id="editForm"><label class="f full">Nama<input id="e_name" value="' + esc(m.name) + '" required maxlength="80"></label>'
        + '<label class="f">Nominal<input id="e_amount" inputmode="numeric" value="' + esc(m.amount) + '"></label>'
        + '<label class="f">No. WhatsApp<input id="e_phone" inputmode="tel" value="' + esc(m.phone||"") + '"></label>'
        + '<div class="actions"><button class="primary" type="submit">Simpan</button><button type="button" data-act="cancelEdit">Batal</button></div></form>';
    }
    const paid = isPaid(r, m.id), wr = wonRound(m.id);
    const sub = [paid ? '<span class="chip ok">Lunas ' + fShort(S.payments[r][m.id]) + '</span>' : '<span class="chip warn">Belum transfer</span>'];
    if (wr >= 0) sub.push('<span class="chip gold">Dapat putaran ' + (wr+1) + '</span>');
    if (!paid && m.phone && !RO) {
      const txt = "Halo " + m.name + ", pengingat iuran " + (S.name||"arisan") + " putaran " + (r+1) + " sebesar " + rp(m.amount) + " ya. Terima kasih." + payLines();
      sub.push('<a class="btn" style="padding:3px 9px;font-size:12px" target="_blank" rel="noopener" href="https://wa.me/' + esc(m.phone) + '?text=' + encodeURIComponent(txt) + '">Ingatkan via WA</a>');
    }
    return '<div class="row"><button class="check" role="checkbox" aria-checked="' + paid + '" aria-label="' + esc(m.name) + ' sudah transfer" data-act="toggle" data-id="' + esc(m.id) + '" data-r="' + r + '"' + (RO?' disabled':'') + '>' + icon.check + '</button>'
      + '<div class="who"><div class="name">' + esc(m.name) + '</div><div class="sub">' + sub.join("") + '</div></div>'
      + '<div class="amt">' + rp(m.amount) + '</div>'
      + '<div class="ops">' + (RO ? '' : '<button class="ghost" data-act="edit" data-id="' + esc(m.id) + '" aria-label="Ubah ' + esc(m.name) + '">Ubah</button>'
      + '<button class="ghost danger' + (ui.armed["del"+m.id]?' armed':'') + '" data-act="del" data-id="' + esc(m.id) + '">' + (ui.armed["del"+m.id] ? 'Hapus?' : 'Hapus') + '</button>') + '</div></div>';
  }).join("");
}

function viewHistory(){
  const R = totalRounds(), RO = readOnly();
  let h = '<section class="panel" aria-label="Riwayat"><div class="toolbar"><h2>Riwayat pembayaran</h2><div class="legend">'
    + '<span><span class="cell paid">✓</span> lunas</span><span><span class="cell late">!</span> belum (lewat)</span><span><span class="cell">·</span> belum</span><span><span class="cell paid win">★</span> penerima</span>'
    + '<button data-act="csv"' + (S.members.length?'':' disabled') + '>Unduh CSV</button></div></div>';
  if (!S.members.length) h += '<div class="empty">Belum ada anggota.</div>';
  else {
    h += '<div class="scroll"><table><thead><tr><th>Anggota</th>';
    for (let i=0;i<R;i++) h += '<th class="' + (i===S.current?'cur':'') + '">P' + (i+1) + '<small>' + fDate(roundDate(i), {day:"numeric", month:"short"}) + '</small></th>';
    h += '<th>Total</th></tr></thead><tbody>';
    S.members.forEach(m => {
      let tot = 0;
      h += '<tr><td><b>' + esc(m.name) + '</b></td>';
      for (let i=0;i<R;i++){
        const p = isPaid(i, m.id), win = winIds(i).includes(m.id); if (p) tot += Number(m.amount)||0;
        const cls = "cell" + (p ? " paid" : (i < S.current ? " late" : "")) + (win ? " win" : "");
        const sym = win ? "★" : (p ? "✓" : (i < S.current ? "!" : "·"));
        h += '<td><button class="' + cls + '" data-act="toggle" data-id="' + esc(m.id) + '" data-r="' + i + '" aria-label="' + esc(m.name) + ' putaran ' + (i+1) + (p?' lunas':' belum') + '"' + (RO?' disabled':'') + '>' + sym + '</button></td>';
      }
      h += '<td class="num">' + rp(tot) + '</td></tr>';
    });
    h += '<tr><td><b>Terkumpul</b></td>';
    let grand = 0;
    for (let i=0;i<R;i++){ const c = collected(i); grand += c; h += '<td class="num" style="font-size:12px">' + (c ? (c/1000).toLocaleString("id-ID") + 'rb' : '–') + '</td>'; }
    h += '<td class="num">' + rp(grand) + '</td></tr></tbody></table></div>';
  }
  h += '</section><section class="panel"><h2>Penerima per putaran</h2><div class="list">';
  for (let i=0;i<R;i++){
    const w = winnersOf(i);
    h += '<div class="row" style="grid-template-columns:auto 1fr auto"><span class="chip ' + (w.length?'gold':'') + '">P' + (i+1) + '</span><div class="who"><div class="name">' + (w.length ? esc(names(w)) : '<span class="muted">Belum dikocok</span>') + (w.length && w.length < slots(i) ? ' <span class="chip warn">' + (slots(i) - w.length) + ' slot kosong</span>' : '') + '</div><div class="sub">' + fDate(roundDate(i))
      + w.map(m => { const po = payoutOf(i, m.id); return po ? '<span class="chip ok">' + esc(m.name.split(" ")[0]) + ' ✓ ditransfer</span>' + (po.proof ? '<button class="btn-mini" data-act="viewProof" data-r="' + i + '" data-id="' + esc(m.id) + '">Bukti</button>' : '') : ''; }).join("") + '</div></div><div class="amt">' + rp(payout(i)) + (slots(i) > 1 ? '<div class="muted" style="font-size:12px">per orang</div>' : '') + '</div></div>';
  }
  h += '</div></section><section class="panel"><h2>Catatan aktivitas</h2><div class="log">'
    + (S.log.length ? S.log.map(l => '<div><time>' + new Date(l.t).toLocaleString("id-ID",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}) + '</time><span>' + esc(l.m) + '</span></div>').join("") : '<span class="muted">Belum ada aktivitas.</span>')
    + '</div></section>';
  return h;
}

function viewSettings(){
  let h = '<div class="two"><section class="panel"><h2>Pengaturan arisan</h2><div class="form">'
    + '<label class="f" style="grid-column:1/-1">Nama arisan<input id="s_name" maxlength="120" value="' + esc(S.name) + '"></label>'
    + '<label class="f">Iuran standar (Rp)<input id="s_amount" inputmode="numeric" value="' + esc(S.defaultAmount) + '"></label>'
    + '<label class="f">Periode<select id="s_cycle">' + Object.entries(cycleLabel).map(([k,l]) => '<option value="' + k + '"' + (S.cycle===k?' selected':'') + '>' + l + '</option>').join("") + '</select></label>'
    + '<label class="f">Tanggal kocokan pertama<input id="s_start" type="date" value="' + esc(S.startDate) + '"></label>'
    + '<label class="f">Pemenang per putaran<select id="s_k">' + [1,2,3,4,5].map(k => '<option value="' + k + '"' + (K()===k?' selected':'') + '>' + k + ' orang</option>').join("") + '</select></label>'
    + '<label class="f">Putaran berjalan<select id="s_current">' + Array.from({length: totalRounds()}, (_,i) => '<option value="' + i + '"' + (S.current===i?' selected':'') + '>Putaran ' + (i+1) + '</option>').join("") + '</select></label>'
    + '</div>' + kInfo() + '<div class="actions"><button data-act="applyAmount">' + (ui.armed.applyAmount ? 'Yakin ubah semua?' : 'Samakan nominal semua anggota') + '</button></div></section>';
  h += '<section class="panel"><h2>Cadangan data</h2><p class="muted" style="margin:0">Unduh atau salin data untuk disimpan. Tempel di kotak impor untuk memulihkan.</p>'
    + '<div class="actions"><button data-act="exportJson">Unduh cadangan (.json)</button><button data-act="copyJson">Salin data</button></div>'
    + '<label class="f">Impor data<textarea id="importBox" placeholder="Tempel data cadangan di sini"></textarea></label>'
    + '<div class="actions"><button data-act="importJson">Impor</button>'
    + '<button class="danger' + (ui.armed.reset?' armed':'') + '" data-act="reset">' + (ui.armed.reset ? 'Hapus semua data?' : 'Hapus semua data') + '</button></div></section>';
  h += viewPaySettings();
  if (mode === "remote") {
    h += '<section class="panel"><h2>Ganti PIN bendahara</h2><form id="pinForm" class="form" autocomplete="off">'
      + '<label class="f">PIN lama<input id="p_old" type="password" inputmode="numeric" required></label>'
      + '<label class="f">PIN baru<input id="p_new" type="password" inputmode="numeric" minlength="4" required></label>'
      + '<div class="actions" style="grid-column:1/-1"><button type="submit">Ganti PIN</button></div></form></section>';
  }
  return h + '</div>';
}

/* ---------- QR pembayaran ---------- */
function fileToQrDataUrl(file){ return fileToDataUrl(file); }
function fileToDataUrl(file){
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) return reject(new Error(ERR.invalid_image));
    if (file.size > 15 * 1024 * 1024) return reject(new Error("Gambar terlalu besar (maks 15 MB)."));
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      // Coba resolusi besar dulu supaya kotak QR tetap tajam; turunkan bila ukuran file terlalu besar.
      for (const max of [1400, 1000, 720]) {
        const sc = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement("canvas");
        c.width = Math.round(img.naturalWidth * sc); c.height = Math.round(img.naturalHeight * sc);
        const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
        g.imageSmoothingQuality = "high"; g.drawImage(img, 0, 0, c.width, c.height);
        for (const [type, q] of [["image/png"], ["image/jpeg", 0.92], ["image/jpeg", 0.82]]) {
          const out = c.toDataURL(type, q);
          if (out.length <= 600000) return resolve(out);
        }
      }
      reject(new Error("Gambar terlalu besar setelah dikompres. Coba potong gambarnya di sekitar QR saja."));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Gambar tidak bisa dibaca.")); };
    img.src = url;
  });
}
async function saveQr(dataUrl){
  if (!mustEdit()) return;
  ui.qrBusy = true; render();
  try {
    if (mode === "demo") { lsSet(DEMO_QR_KEY, dataUrl || null); qrData = dataUrl || null; }
    else {
      const res = await rpc("set_arisan_qr", { p_id: GID, p_pin: pin, p_qr: dataUrl || "" });
      if (!res || !res.ok) {
        const code = res && res.error;
        if (code === "invalid_pin" || code === "locked") logout();
        throw new Error(ERR[code] || "Gagal menyimpan gambar QR.");
      }
      qrData = dataUrl || null; qrHash = res.qr_hash || null;
      if (channel) channel.send({ type: "broadcast", event: "qr", payload: { qr_hash: qrHash } });
    }
    S.log.unshift({ t: Date.now(), m: dataUrl ? "Gambar QR pembayaran diperbarui" : "Gambar QR pembayaran dihapus" });
    ui.qrBusy = false; commit();
    toast(dataUrl ? "QR pembayaran tersimpan" : "QR pembayaran dihapus");
  } catch(e) { ui.qrBusy = false; render(); toast(e.message || "Gagal menyimpan gambar QR."); }
}
const cleanNo = n => String(n || "").replace(/[\s.\-]/g, "");
const hasPayInfo = () => S.pay.accounts.some(a => a.number.trim()) || !!qrData;
function payLines(){
  const acc = S.pay.accounts.filter(a => a.number.trim());
  if (!acc.length && !qrData) return "";
  return "\n\n*Transfer ke:*\n" + acc.map(a => "• " + (a.bank || "Rekening") + " " + a.number + (a.holder ? " a.n. " + a.holder : "")).join("\n")
    + (qrData ? (acc.length ? "\n" : "") + "• QRIS: scan di " + (mode === "remote" ? shareUrl() : "aplikasi arisan") : "")
    + (S.pay.note ? "\n" + S.pay.note : "");
}

/* ---------- transfer ke pemenang ---------- */
const payoutOf = (r, id) => (S.payouts[r] || {})[id] || null;
function payoutChip(r, id){
  const po = payoutOf(r, id);
  return po ? '<span class="chip ok">Sudah ditransfer ' + fShort(po.t) + '</span>' : '<span class="chip">Belum ditransfer</span>';
}
function proofSet(r, id, hash){ const po = (S.payouts[r] = S.payouts[r] || {}); po[id] = { t: (po[id] && po[id].t) || new Date().toISOString(), proof: hash || null }; }
async function saveProof(r, id, dataUrl){
  if (!mustEdit()) return;
  ui.proofBusy = r + ":" + id; render();
  try {
    let hash = null;
    if (mode === "demo") {
      if (dataUrl) { lsSet(demoProofKey(r, id), dataUrl); hash = "d" + dataUrl.length.toString(36) + dataUrl.slice(-6).replace(/\W/g, ""); }
      else lsSet(demoProofKey(r, id), null);
    } else {
      const res = await rpc("set_payout_proof", { p_id: GID, p_pin: pin, p_round: r, p_member: id, p_img: dataUrl || "" });
      if (!res || !res.ok) {
        const code = res && res.error;
        if (code === "invalid_pin" || code === "locked") logout();
        throw new Error(ERR[code] || "Gagal menyimpan bukti transfer.");
      }
      hash = res.hash || null;
    }
    if (hash) proofCache[hash] = dataUrl;
    ui.proofBusy = null;
    if (dataUrl) { proofSet(r, id, hash); commit("Bukti transfer untuk " + memberName(id) + " diunggah (Putaran " + (r+1) + ")"); toast("Bukti transfer tersimpan"); }
    else { const po = payoutOf(r, id); if (po) po.proof = null; commit("Bukti transfer untuk " + memberName(id) + " dihapus (Putaran " + (r+1) + ")"); toast("Bukti transfer dihapus"); }
  } catch(e) { ui.proofBusy = null; render(); toast(e.message || "Gagal menyimpan bukti transfer."); }
}
async function openProof(r, id){
  const po = payoutOf(r, id); if (!po || !po.proof) return;
  ui.modal = { r, id, img: proofCache[po.proof] || null, err: "" }; renderModal();
  if (ui.modal.img) return;
  try {
    const img = mode === "demo" ? lsGet(demoProofKey(r, id)) : await rpc("get_payout_proof", { p_id: GID, p_round: r, p_member: id });
    if (!ui.modal || ui.modal.id !== id) return;
    if (img) { proofCache[po.proof] = img; ui.modal.img = img; } else ui.modal.err = "Bukti transfer tidak ditemukan.";
  } catch(e) { if (ui.modal) ui.modal.err = "Gagal memuat bukti transfer."; }
  renderModal();
}
function renderModal(){
  let el = document.getElementById("modal");
  if (!ui.modal) { if (el) el.remove(); document.body.style.overflow = ""; return; }
  if (!el) { el = document.createElement("div"); el.id = "modal"; el.className = "modal"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); document.body.appendChild(el); document.body.style.overflow = "hidden"; }
  const { r, id, img, err } = ui.modal, po = payoutOf(r, id) || {};
  el.innerHTML = '<div class="modal-card"><div class="toolbar"><div><div class="eyebrow">Bukti transfer · Putaran ' + (r+1) + '</div><h2>' + esc(memberName(id)) + '</h2>'
    + '<div class="muted" style="font-size:13.5px">' + rp(payout(r)) + (po.t ? ' · ditransfer ' + fDate(new Date(po.t), {day:"numeric", month:"long", year:"numeric"}) : '') + '</div></div>'
    + '<button class="ghost" data-act="closeModal" aria-label="Tutup">Tutup ✕</button></div>'
    + '<div class="modal-body">' + (img ? '<img src="' + esc(img) + '" alt="Bukti transfer ke ' + esc(memberName(id)) + '">' : '<div class="empty">' + esc(err || "Memuat bukti…") + '</div>') + '</div>'
    + (img ? '<div class="actions"><button data-act="dlProof">Unduh bukti</button></div>' : '') + '</div>';
  const btn = el.querySelector('[data-act="closeModal"]'); if (btn) btn.focus();
}
function winnerRows(r, ws, notYet, RO){
  return '<div class="list">' + ws.map(m => {
    const po = payoutOf(r, m.id), busy = ui.proofBusy === r + ":" + m.id;
    let h = '<div class="winrow"><div class="who"><div class="name">' + esc(m.name) + ' <span class="muted num" style="font-weight:500;font-size:13px">' + rp(payout(r)) + '</span></div>'
      + '<div class="sub">' + payoutChip(r, m.id) + (po && po.proof ? '<button class="btn-mini" data-act="viewProof" data-r="' + r + '" data-id="' + esc(m.id) + '">Lihat bukti</button>' : (po ? '<span class="muted">tanpa bukti</span>' : '')) + '</div></div>';
    if (!RO) {
      const others = [];
      for (const k in S.winners) if (+k !== r) (S.winners[k] || []).forEach(id => { const o = S.members.find(x => x.id === id); if (o) others.push([o, +k]); });
      others.sort((a, b) => a[1] - b[1]);
      const fid = "proof_" + r + "_" + m.id;
      h += '<div class="ops">'
        + (po ? '<button class="ghost' + (ui.armed["po"+m.id]?' danger armed':'') + '" data-act="unpayout" data-id="' + esc(m.id) + '">' + (ui.armed["po"+m.id] ? 'Batalkan tanda?' : 'Batalkan tanda') + '</button>'
              : '<button class="primary" data-act="payout" data-id="' + esc(m.id) + '">Tandai sudah ditransfer</button>')
        + '<label class="btn" for="' + esc(fid) + '">' + (busy ? 'Mengunggah…' : (po && po.proof ? 'Ganti bukti' : 'Upload bukti')) + '</label>'
        + '<input type="file" id="' + esc(fid) + '" class="proofFile" data-r="' + r + '" data-id="' + esc(m.id) + '" accept="image/png,image/jpeg,image/webp" hidden' + (busy ? ' disabled' : '') + '>'
        + (po && po.proof ? '<button class="ghost danger' + (ui.armed["pf"+m.id]?' armed':'') + '" data-act="delProof" data-id="' + esc(m.id) + '">' + (ui.armed["pf"+m.id] ? 'Hapus bukti?' : 'Hapus bukti') + '</button>' : '')
        + '<select class="repSel" data-id="' + esc(m.id) + '" aria-label="Ganti ' + esc(m.name) + '" style="width:auto;max-width:170px"><option value="">Ganti pemenang…</option>'
        + (notYet.length ? '<optgroup label="Ganti dengan yang belum dapat">' + notYet.map(n => '<option value="n:' + esc(n.id) + '">' + esc(n.name) + '</option>').join("") + '</optgroup>' : '')
        + (others.length ? '<optgroup label="Tukar giliran dengan">' + others.map(([o, k]) => '<option value="s:' + esc(o.id) + ':' + k + '">' + esc(o.name) + ' (P' + (k+1) + ')</option>').join("") + '</optgroup>' : '')
        + '</select><button class="ghost danger' + (ui.armed["rm"+m.id]?' armed':'') + '" data-act="rmWin" data-id="' + esc(m.id) + '">' + (ui.armed["rm"+m.id] ? 'Hapus?' : 'Hapus pemenang') + '</button></div>';
    }
    return h + '</div>';
  }).join("") + '</div>';
}

function viewPay(r){
  const RO = readOnly();
  const acc = S.pay.accounts.filter(a => a.number.trim());
  if (!acc.length && !qrData) {
    return RO ? '' : '<div class="banner info"><span>Belum ada info rekening. Tambahkan nomor rekening atau QRIS supaya anggota bisa langsung transfer.</span><button data-act="goPay">Atur pembayaran</button></div>';
  }
  let h = '<section class="panel" aria-label="Info transfer"><div class="toolbar"><h2>Transfer iuran</h2>'
    + '<span class="chip acc">Putaran ' + (r+1) + ' · ' + rp(S.defaultAmount) + ' / orang</span></div>'
    + '<div class="pay-grid' + (qrData && acc.length ? '' : ' single') + '">';
  if (acc.length) {
    h += '<div class="accts">' + acc.map(a => '<div class="acct"><div class="eyebrow">' + esc(a.bank || "Rekening") + '</div>'
      + '<div class="no num">' + esc(a.number) + '</div>'
      + (a.holder ? '<div class="holder">a.n. ' + esc(a.holder) + '</div>' : '')
      + '<button data-act="copyNo" data-v="' + esc(cleanNo(a.number)) + '">Salin nomor</button></div>').join("")
      + (S.pay.note ? '<p class="pay-note">' + esc(S.pay.note) + '</p>' : '') + '</div>';
  }
  if (qrData) {
    h += '<figure class="qr"><img src="' + esc(qrData) + '" alt="QR code pembayaran ' + esc(S.name) + '">'
      + '<figcaption><b>Scan QRIS</b><span>Buka aplikasi bank atau e-wallet, lalu pilih scan QR. Kalau membuka halaman ini di HP, unduh gambarnya lalu pilih "scan dari galeri".</span></figcaption>'
      + '<button data-act="dlQr">Unduh gambar QR</button></figure>';
    if (!acc.length && S.pay.note) h += '<p class="pay-note">' + esc(S.pay.note) + '</p>';
  }
  return h + '</div></section>';
}

function viewPaySettings(){
  let h = '<section class="panel" id="paySettings" style="grid-column:1/-1"><h2>Info pembayaran</h2>'
    + '<p class="muted" style="margin:0">Ditampilkan ke semua anggota di halaman utama dan disertakan di pengingat WhatsApp.</p>'
    + '<datalist id="bankList">' + BANKS.map(b => '<option value="' + esc(b) + '">').join("") + '</datalist>'
    + '<div class="pay-edit">';
  h += '<div class="stack"><div class="eyebrow">Rekening & e-wallet</div>';
  h += S.pay.accounts.length ? S.pay.accounts.map(a => '<div class="acct-edit">'
      + '<label class="f">Bank / e-wallet<input id="pa_bank_' + esc(a.id) + '" data-acc="' + esc(a.id) + '" data-k="bank" list="bankList" maxlength="40" value="' + esc(a.bank) + '" placeholder="mis. BCA"></label>'
      + '<label class="f">Nomor rekening / HP<input id="pa_number_' + esc(a.id) + '" data-acc="' + esc(a.id) + '" data-k="number" inputmode="numeric" maxlength="40" value="' + esc(a.number) + '" placeholder="mis. 1234567890"></label>'
      + '<label class="f">Atas nama<input id="pa_holder_' + esc(a.id) + '" data-acc="' + esc(a.id) + '" data-k="holder" maxlength="80" value="' + esc(a.holder) + '" placeholder="mis. Siti Aminah"></label>'
      + '<button class="ghost danger' + (ui.armed["acc"+a.id]?' armed':'') + '" data-act="delAcc" data-id="' + esc(a.id) + '">' + (ui.armed["acc"+a.id] ? 'Hapus?' : 'Hapus') + '</button></div>').join("")
    : '<div class="muted">Belum ada rekening.</div>';
  h += '<div class="actions"><button data-act="addAcc">+ Tambah rekening</button></div>'
    + '<label class="f">Catatan untuk anggota (opsional)<textarea id="pay_note" maxlength="300" style="font-family:var(--f-body);font-size:14px;min-height:70px" placeholder="mis. Tulis nama di berita transfer. Batas transfer H-1 kocokan.">' + esc(S.pay.note) + '</textarea></label></div>';
  h += '<div class="stack"><div class="eyebrow">Gambar QRIS</div>'
    + (qrData ? '<figure class="qr qr-sm"><img src="' + esc(qrData) + '" alt="Pratinjau QR pembayaran"></figure>' : '<div class="qr-empty">Belum ada gambar QR</div>')
    + '<div class="actions"><label class="btn" for="qrFile">' + (ui.qrBusy ? 'Menyimpan…' : (qrData ? 'Ganti gambar' : 'Unggah gambar QR')) + '</label>'
    + '<input id="qrFile" type="file" accept="image/png,image/jpeg,image/webp" hidden' + (ui.qrBusy ? ' disabled' : '') + '>'
    + (qrData ? '<button class="ghost danger' + (ui.armed.delQr?' armed':'') + '" data-act="delQr">' + (ui.armed.delQr ? 'Yakin hapus QR?' : 'Hapus QR') + '</button>' : '') + '</div>'
    + '<p class="muted" style="margin:0;font-size:13px">Pakai screenshot QRIS dari aplikasi merchant atau foto yang jelas. Gambar otomatis diperkecil supaya ringan dibuka.</p></div>';
  return h + '</div></section>';
}

/* ---------- actions ---------- */
function mustEdit(){ if (readOnly()){ toast("Masuk sebagai bendahara untuk mengubah data"); return false; } return true; }
function memberName(id){ const m = S.members.find(x => x.id === id); return m ? m.name : "Anggota"; }
function addWinners(r, ids){ setRound(r, winIds(r).concat(ids)); commit(names(ids.map(id => S.members.find(m => m.id === id))) + " mendapat arisan putaran " + (r+1)); }
function kInfo(){
  const N = S.members.length, k = K(); if (!N) return '';
  const R = totalRounds(), rest = N % k;
  return '<p class="muted" style="margin:0;font-size:13.5px">' + N + ' anggota ÷ ' + k + ' pemenang = <b>' + R + ' putaran</b>. Tiap pemenang menerima <b class="num">' + rp(pot() / k) + '</b>'
    + (rest ? '. <span style="color:var(--warn)">Putaran terakhir hanya ' + rest + ' pemenang dan menerima ' + rp(pot() / rest) + ' per orang; tambah atau kurangi anggota supaya pas.</span>' : '.') + '</p>';
}
function roll(){
  const r = ui.round;
  const used = allWinnerIds();
  const cand = S.members.filter(m => !used.has(m.id));
  const n = Math.min(slots(r) - winIds(r).length, cand.length);
  if (n <= 0) return;
  const pool = cand.slice(), picks = [];
  for (let i = 0; i < n; i++) { const a = new Uint32Array(1); crypto.getRandomValues(a); picks.push(pool.splice(a[0] % pool.length, 1)[0]); }
  const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  ui.rolling = true; ui.rollCount = n; ui.rollName = cand[0].name; render();
  let t = 0;
  const iv = setInterval(() => { const el = $("#rollName"); t++; if (el) el.textContent = cand[t % cand.length].name; }, 80);
  setTimeout(() => { clearInterval(iv); ui.rolling = false; addWinners(r, picks.map(m => m.id)); toast("🎉 " + names(picks) + " dapat arisan!"); }, reduce ? 300 : 2200);
}
function reminderText(r){
  const unpaid = S.members.filter(m => !isPaid(r, m.id));
  const link = mode === "remote" ? "\n\nCek status: " + shareUrl() : "";
  return "*" + (S.name||"Arisan") + " — Putaran " + (r+1) + "*\nKocokan: " + fDate(roundDate(r), {weekday:"long", day:"numeric", month:"long"}) + "\n\nYang belum transfer:\n"
    + unpaid.map((m,i) => (i+1) + ". " + m.name + " (" + rp(m.amount) + ")").join("\n")
    + "\n\nSudah transfer " + (S.members.length - unpaid.length) + " dari " + S.members.length + " orang. Mohon segera transfer ya, terima kasih." + payLines() + link;
}
function summaryText(r){
  const w = winnersOf(r);
  return "*Rekap " + (S.name||"Arisan") + " — Putaran " + (r+1) + "*\n"
    + S.members.map(m => (isPaid(r, m.id) ? "✅ " : "⬜ ") + m.name + " — " + rp(m.amount)).join("\n")
    + "\n\nTerkumpul: " + rp(collected(r)) + " dari " + rp(pot())
    + (w.length ? "\nPenerima (" + rp(payout(r)) + (w.length > 1 ? " per orang" : "") + "):\n" + w.map(m => (payoutOf(r, m.id) ? "✅ " : "⏳ ") + m.name + (payoutOf(r, m.id) ? " — sudah ditransfer" + (payoutOf(r, m.id).proof ? ", bukti di link" : "") : " — belum ditransfer")).join("\n") : "\nPenerima: belum dikocok")
    + (mode === "remote" ? "\n\n" + shareUrl() : "");
}
/* ---------- laporan per anggota ---------- */
function memberReport(m){
  const amt = Number(m.amount) || 0, R = totalRounds(), due = Math.min(S.current + 1, R);
  let paidN = 0, paidDue = 0;
  const unpaidDue = [];
  for (let i = 0; i < R; i++) {
    if (isPaid(i, m.id)) { paidN++; if (i < due) paidDue++; }
    else if (i < due) unpaidDue.push(i);
  }
  const wr = wonRound(m.id), po = wr >= 0 ? payoutOf(wr, m.id) : null;
  const received = po ? payout(wr) : 0;
  const deposit = paidN * amt;
  return { m, amt, R, due, paidN, deposit, required: due * amt, arrears: unpaidDue.length * amt, unpaidDue,
    remaining: Math.max(0, R * amt - deposit), wr, received, scheduled: wr >= 0 ? payout(wr) : 0, transferred: !!po, net: received - deposit };
}
function cashSummary(){
  const R = totalRounds();
  let inflow = 0, outflow = 0;
  for (let i = 0; i < R; i++) {
    inflow += collected(i);
    winIds(i).forEach(id => { if (payoutOf(i, id)) outflow += payout(i); });
  }
  return { inflow, outflow, balance: inflow - outflow };
}
function statusOf(rep){
  if (rep.arrears > 0) return '<span class="chip warn">Nunggak ' + rep.unpaidDue.length + 'x</span>';
  return '<span class="chip ok">Lancar</span>';
}
function winOf(rep){
  if (rep.wr < 0) return '<span class="muted">Belum dapat</span>';
  return '<span class="chip gold">P' + (rep.wr+1) + '</span>' + (rep.transferred ? ' <span class="chip ok">diterima</span>' : ' <span class="chip">belum ditransfer</span>');
}
function viewReport(){
  const reps = S.members.map(memberReport);
  const cash = cashSummary();
  const arrearsTotal = reps.reduce((a, x) => a + x.arrears, 0), late = reps.filter(x => x.arrears > 0);
  const sortKey = ui.repSort || "name";
  const sorted = reps.slice().sort((a, b) => sortKey === "arrears" ? b.arrears - a.arrears || a.m.name.localeCompare(b.m.name)
    : sortKey === "round" ? ((a.wr < 0 ? 999 : a.wr) - (b.wr < 0 ? 999 : b.wr)) : a.m.name.localeCompare(b.m.name));
  let h = '<section class="panel" aria-label="Ringkasan kas"><div class="toolbar"><h2>Ringkasan kas</h2><span class="muted" style="font-size:13px">s.d. putaran ' + (S.current+1) + ' dari ' + totalRounds() + '</span></div>'
    + '<div class="stats cash"><div class="stat"><b>' + rp(cash.inflow) + '</b><span>Total iuran masuk</span></div>'
    + '<div class="stat"><b>' + rp(cash.outflow) + '</b><span>Sudah ditransfer ke pemenang</span></div>'
    + '<div class="stat"><b>' + rp(cash.balance) + '</b><span>Saldo di bendahara</span></div>'
    + '<div class="stat"><b' + (arrearsTotal ? ' style="color:var(--warn)"' : '') + '>' + rp(arrearsTotal) + '</b><span>Tunggakan · ' + late.length + ' orang</span></div></div>';
  if (late.length) h += '<p class="muted" style="margin:0;font-size:13.5px">Menunggak: ' + late.map(x => esc(x.m.name) + ' (' + x.unpaidDue.map(i => 'P' + (i+1)).join(", ") + ')').join(" · ") + '</p>';
  h += '</section>';

  h += '<section class="panel" aria-label="Laporan per anggota"><div class="toolbar"><h2>Laporan per anggota</h2><div class="seg" role="group" aria-label="Urutkan">'
    + [["name","Nama"],["arrears","Tunggakan"],["round","Giliran"]].map(([k,l]) => '<button data-act="repSort" data-v="' + k + '" aria-pressed="' + (sortKey===k) + '">' + l + '</button>').join("")
    + '<button data-act="repCsv"' + (reps.length ? '' : ' disabled') + '>Unduh CSV</button></div></div>';
  if (!reps.length) return h + '<div class="empty">Belum ada anggota.</div></section>';
  h += '<div class="scroll"><table class="report"><thead><tr><th>Anggota</th><th>Iuran</th><th>Setor</th><th>Total setor</th><th>Tunggakan</th><th>Sisa kewajiban</th><th>Giliran</th><th>Diterima</th><th>Status</th></tr></thead><tbody>';
  sorted.forEach(x => {
    h += '<tr><td><button class="linkish" data-act="repOpen" data-id="' + esc(x.m.id) + '" aria-expanded="' + (ui.repOpen === x.m.id) + '">' + esc(x.m.name) + '</button></td>'
      + '<td class="num">' + rp(x.amt) + '</td><td class="num">' + x.paidN + '/' + x.R + '</td><td class="num">' + rp(x.deposit) + '</td>'
      + '<td class="num"' + (x.arrears ? ' style="color:var(--warn);font-weight:600"' : '') + '>' + (x.arrears ? rp(x.arrears) : '–') + '</td>'
      + '<td class="num">' + rp(x.remaining) + '</td><td>' + winOf(x) + '</td>'
      + '<td class="num">' + (x.received ? rp(x.received) : (x.wr >= 0 ? '<span class="muted">' + rp(x.scheduled) + '</span>' : '–')) + '</td><td>' + statusOf(x) + '</td></tr>';
    if (ui.repOpen === x.m.id) h += '<tr class="detail"><td colspan="9">' + memberLedger(x) + '</td></tr>';
  });
  const tot = k => reps.reduce((a, x) => a + x[k], 0);
  h += '</tbody><tfoot><tr><td><b>Total</b></td><td></td><td></td><td class="num"><b>' + rp(tot("deposit")) + '</b></td><td class="num"><b>' + (tot("arrears") ? rp(tot("arrears")) : '–') + '</b></td><td class="num"><b>' + rp(tot("remaining")) + '</b></td><td></td><td class="num"><b>' + rp(tot("received")) + '</b></td><td></td></tr></tfoot></table></div>'
    + '<p class="muted" style="margin:0;font-size:13px">Klik nama untuk melihat rincian per putaran dan menyalin laporan pribadi untuk dikirim lewat WhatsApp. Angka "Diterima" berwarna abu-abu berarti giliran sudah ditentukan tapi belum ditransfer.</p></section>';
  return h;
}
function memberLedger(x){
  let h = '<div class="ledger"><div class="ledger-head"><div><b>' + esc(x.m.name) + '</b> · iuran ' + rp(x.amt) + ' / putaran'
    + (x.net !== 0 || x.received ? ' · posisi bersih <span class="num" style="color:' + (x.net >= 0 ? 'var(--ok)' : 'var(--ink)') + '">' + (x.net >= 0 ? '+' : '−') + rp(Math.abs(x.net)) + '</span>' : '') + '</div>'
    + '<button data-act="repCopy" data-id="' + esc(x.m.id) + '">Salin laporan untuk ' + esc(x.m.name.split(" ")[0]) + '</button></div><div class="ledger-grid">';
  for (let i = 0; i < x.R; i++) {
    const p = isPaid(i, x.m.id), past = i <= S.current, win = x.wr === i;
    h += '<div class="lg' + (p ? ' paid' : (past ? ' late' : '')) + (win ? ' win' : '') + '"><span class="eyebrow">P' + (i+1) + ' · ' + fDate(roundDate(i), {day:"numeric", month:"short"}) + '</span>'
      + '<b>' + (p ? 'Setor ' + fShort(S.payments[i][x.m.id]) : (past ? 'Belum setor' : '–')) + '</b>'
      + (win ? '<span>★ Giliran dapat ' + rp(payout(i)) + (x.transferred ? ' · diterima' : '') + '</span>' : '') + '</div>';
  }
  return h + '</div></div>';
}
function memberStatement(x){
  const lines = [];
  for (let i = 0; i < x.R; i++) {
    const p = isPaid(i, x.m.id), past = i <= S.current;
    lines.push((p ? "✅" : (past ? "❌" : "▫️")) + " P" + (i+1) + " (" + fDate(roundDate(i), {day:"numeric", month:"short"}) + ")" + (p ? " setor" : (past ? " belum setor" : "")) + (x.wr === i ? " ★ giliran dapat" : ""));
  }
  return "*Laporan " + (S.name || "Arisan") + "*\n" + x.m.name + " · iuran " + rp(x.amt) + "/putaran\n\n" + lines.join("\n")
    + "\n\nTotal setor: " + rp(x.deposit) + " (" + x.paidN + "/" + x.R + " putaran)"
    + (x.arrears ? "\nTunggakan: " + rp(x.arrears) + " (" + x.unpaidDue.map(i => "P" + (i+1)).join(", ") + ")" : "\nTunggakan: tidak ada")
    + "\nSisa kewajiban sampai akhir: " + rp(x.remaining)
    + (x.wr >= 0 ? "\nGiliran: putaran " + (x.wr+1) + ", " + rp(x.scheduled) + (x.transferred ? " (sudah diterima)" : " (belum ditransfer)") : "\nGiliran: belum dapat")
    + payLines() + (mode === "remote" ? "\n\nCek status: " + shareUrl() : "");
}
function reportCsv(){
  const q = v => '"' + String(v).replace(/"/g, '""') + '"';
  const head = ["Anggota","Iuran per putaran","Putaran disetor","Total putaran","Total setor","Tunggakan","Putaran nunggak","Sisa kewajiban","Giliran","Nominal giliran","Sudah diterima","Posisi bersih"];
  const rows = S.members.map(memberReport).map(x => [x.m.name, x.amt, x.paidN, x.R, x.deposit, x.arrears, x.unpaidDue.map(i => "P" + (i+1)).join(" "), x.remaining,
    x.wr >= 0 ? "P" + (x.wr+1) : "", x.wr >= 0 ? x.scheduled : "", x.received, x.net]);
  return "﻿" + [head].concat(rows).map(r => r.map(q).join(",")).join("\n");
}
function csvText(){
  const R = totalRounds(), q = v => '"' + String(v).replace(/"/g, '""') + '"';
  const head = ["Anggota","Nominal","No WA"].concat(Array.from({length:R}, (_,i) => "P" + (i+1) + " " + roundDate(i).toISOString().slice(0,10))).concat(["Dapat putaran"]);
  const rows = S.members.map(m => [m.name, m.amount, m.phone || ""].concat(Array.from({length:R}, (_,i) => isPaid(i, m.id) ? "lunas " + S.payments[i][m.id].slice(0,10) : "")).concat([wonRound(m.id) >= 0 ? wonRound(m.id)+1 : ""]));
  return "﻿" + [head].concat(rows).map(r => r.map(q).join(",")).join("\n");
}
const slug = () => (S.name || "arisan").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

app.addEventListener("click", e => {
  const b = e.target.closest("[data-act]"); if (!b || b.disabled) return;
  const act = b.dataset.act, id = b.dataset.id;
  switch(act){
    case "reload": location.reload(); break;
    case "tab": ui.tab = b.dataset.v; ui.editing = null; render(); break;
    case "goPay": ui.tab = "pengaturan"; render(); { const el = $("#paySettings"); if (el && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "start" }); } break;
    case "copyNo": copy(b.dataset.v, "Nomor " + b.dataset.v + " tersalin"); break;
    case "dlQr": if (qrData) downloadUrl("qris-" + slug() + (qrData.startsWith("data:image/png") ? ".png" : ".jpg"), qrData); break;
    case "addAcc": if (!mustEdit()) return; S.pay.accounts.push({ id: "a" + Date.now().toString(36), bank: "", number: "", holder: "" }); render(); { const el = $("#pa_bank_" + S.pay.accounts[S.pay.accounts.length-1].id); if (el) el.focus(); } break;
    case "delAcc": if (!mustEdit() || !arm("acc" + id)) return; { const a = S.pay.accounts.find(x => x.id === id); S.pay.accounts = S.pay.accounts.filter(x => x.id !== id); commit("Rekening " + ((a && a.bank) || "") + " dihapus"); } break;
    case "payout": if (!mustEdit()) return; proofSet(ui.round, id, (payoutOf(ui.round, id) || {}).proof); commit(memberName(id) + " sudah ditransfer " + rp(payout(ui.round)) + " (Putaran " + (ui.round+1) + ")"); break;
    case "unpayout": {
      if (!mustEdit() || !arm("po" + id)) return;
      const po = payoutOf(ui.round, id);
      if (po && po.proof) saveProof(ui.round, id, null);
      delete (S.payouts[ui.round] || {})[id];
      commit("Tanda transfer untuk " + memberName(id) + " dibatalkan (Putaran " + (ui.round+1) + ")"); break;
    }
    case "delProof": if (!mustEdit() || !arm("pf" + id)) return; saveProof(ui.round, id, null); break;
    case "viewProof": openProof(+b.dataset.r, id); break;
    case "delQr": if (!mustEdit() || !arm("delQr")) return; saveQr(null); break;
    case "filter": ui.filter = b.dataset.v; render(); break;
    case "prev": ui.round = Math.max(0, ui.round-1); render(); break;
    case "next": ui.round = Math.min(totalRounds()-1, ui.round+1); render(); break;
    case "share": copy(shareUrl(), "Link tersalin. Bagikan ke grup arisan."); break;
    case "openLogin": ui.login = true; ui.loginErr = ""; render(); { const f = $("#pin"); if (f) f.focus(); } break;
    case "closeLogin": ui.login = false; render(); break;
    case "logout": logout(); toast("Keluar dari mode bendahara"); break;
    case "toggle": {
      if (!mustEdit()) return;
      const r = +b.dataset.r, pm = paidMap(r);
      if (pm[id]) { delete pm[id]; commit(memberName(id) + " ditandai belum transfer (Putaran " + (r+1) + ")"); }
      else { pm[id] = new Date().toISOString(); commit(memberName(id) + " sudah transfer (Putaran " + (r+1) + ")"); }
      break;
    }
    case "allPaid": {
      if (!mustEdit() || !arm("allPaid")) return;
      const pm = paidMap(ui.round), now = new Date().toISOString();
      S.members.forEach(m => { if (!pm[m.id]) pm[m.id] = now; });
      commit("Semua anggota ditandai lunas (Putaran " + (ui.round+1) + ")"); break;
    }
    case "advance": if (!mustEdit() || !arm("advance")) return; S.current = Math.min(totalRounds()-1, S.current+1); ui.round = S.current; commit("Putaran " + (S.current+1) + " dimulai"); break;
    case "setCurrent": if (!mustEdit()) return; S.current = ui.round; commit("Putaran berjalan diubah ke " + (S.current+1)); break;
    case "remind": copy(reminderText(ui.round), "Pengingat tersalin, tempel di grup WA"); break;
    case "summary": copy(summaryText(ui.round), "Rekap tersalin"); break;
    case "repSort": ui.repSort = b.dataset.v; render(); break;
    case "repOpen": ui.repOpen = ui.repOpen === id ? null : id; render(); break;
    case "repCsv": download(slug() + "-laporan-anggota.csv", reportCsv(), "text/csv;charset=utf-8"); break;
    case "repCopy": { const m = S.members.find(x => x.id === id); if (m) copy(memberStatement(memberReport(m)), "Laporan " + m.name + " tersalin"); break; }
    case "csv": download(slug() + "-riwayat.csv", csvText(), "text/csv;charset=utf-8"); break;
    case "roll": {
      if (!mustEdit()) return;
      const unpaid = S.members.filter(m => !isPaid(ui.round, m.id)).length;
      if (unpaid && !arm("roll")) return;
      ui.armed = {}; roll(); break;
    }
    case "rmWin": if (!mustEdit() || !arm("rm" + id)) return; setRound(ui.round, winIds(ui.round).filter(x => x !== id)); commit(memberName(id) + " dihapus dari penerima putaran " + (ui.round+1)); break;
    case "edit": ui.editing = id; render(); { const f = $("#e_name"); if (f) f.focus(); } break;
    case "cancelEdit": ui.editing = null; render(); break;
    case "del": {
      if (!mustEdit() || !arm("del" + id)) return;
      const n = memberName(id);
      S.members = S.members.filter(m => m.id !== id);
      for (const k in S.payments) delete S.payments[k][id];
      for (const k in S.winners) setRound(k, (S.winners[k] || []).filter(x => x !== id));
      S.current = Math.min(S.current, totalRounds()-1);
      commit(n + " dihapus dari arisan"); break;
    }
    case "clearSample": S = blank({ name: "Arisan Baru" }); ui.round = 0; ui.filter = "semua"; ui.tab = "pengaturan"; commit("Arisan baru dibuat"); toast("Atur nama dan iuran, lalu tambahkan anggota"); break;
    case "applyAmount": if (!mustEdit() || !arm("applyAmount")) return; S.members.forEach(m => m.amount = S.defaultAmount); commit("Nominal semua anggota disamakan jadi " + rp(S.defaultAmount)); break;
    case "exportJson": download(slug() + "-cadangan.json", JSON.stringify(S, null, 2), "application/json"); break;
    case "copyJson": copy(JSON.stringify(S), "Data cadangan tersalin"); break;
    case "importJson": {
      if (!mustEdit()) return;
      try {
        const D = JSON.parse($("#importBox").value);
        if (!D || !Array.isArray(D.members) || typeof D.payments !== "object") throw 0;
        S = blank(Object.assign({}, D, { sample: false })); ui.round = S.current; commit("Data diimpor"); toast("Data berhasil diimpor");
      } catch(err){ toast("Data tidak dikenali. Gunakan file atau teks dari Cadangan data."); }
      break;
    }
    case "reset": if (!mustEdit() || !arm("reset")) return; S.members = []; S.payments = {}; S.winners = {}; S.current = 0; S.sample = false; ui.round = 0; commit("Semua data dihapus"); break;
  }
});

app.addEventListener("submit", async e => {
  e.preventDefault();
  const f = e.target;
  if (f.id === "createForm") {
    const name = $("#c_name").value.trim(), p1 = $("#c_pin").value, p2 = $("#c_pin2").value;
    if (p1.length < 4) { ui.createErr = ERR.pin_too_short; render(); return; }
    if (p1 !== p2) { ui.createErr = "PIN dan ulangan PIN tidak sama."; render(); return; }
    const data = blank({ name, defaultAmount: digits($("#c_amount").value) || 200000, cycle: $("#c_cycle").value, winnersPerRound: +$("#c_k").value || 1, startDate: $("#c_start").value || new Date().toISOString().slice(0,10), log: [{t: Date.now(), m: "Arisan dibuat"}] });
    ui.busy = true; ui.createErr = ""; render();
    try {
      const res = await rpc("create_arisan", { p_name: name, p_pin: p1, p_data: data });
      if (!res || !res.ok) throw new Error(ERR[res && res.error] || "Gagal membuat arisan.");
      lsSet(PIN_KEY(res.id), p1); rememberRecent(res.id, name);
      location.search = "?g=" + res.id;
    } catch(err) { ui.busy = false; ui.createErr = err.message || "Gagal membuat arisan."; render(); }
    return;
  }
  if (f.id === "loginForm") { const p = $("#pin").value; if (p) tryLogin(p, false); return; }
  if (f.id === "pinForm") {
    try {
      const res = await rpc("change_pin", { p_id: GID, p_old: $("#p_old").value, p_new: $("#p_new").value });
      if (res && res.ok) { pin = $("#p_new").value; lsSet(PIN_KEY(GID), pin); f.reset(); toast("PIN berhasil diganti"); }
      else toast(ERR[res && res.error] || "Gagal mengganti PIN.");
    } catch(err){ toast("Gagal tersambung."); }
    return;
  }
  if (!mustEdit()) return;
  if (f.id === "addForm") {
    const name = $("#m_name").value.trim(); if (!name) return;
    S.members.push({ id: uid(), name, amount: digits($("#m_amount").value) || S.defaultAmount, phone: normPhone($("#m_phone").value) });
    commit(name + " bergabung"); const n = $("#m_name"); if (n) n.focus();
  } else if (f.id === "editForm") {
    const m = S.members.find(x => x.id === f.dataset.id); if (!m) return;
    m.name = $("#e_name").value.trim() || m.name;
    m.amount = digits($("#e_amount").value) || m.amount;
    m.phone = normPhone($("#e_phone").value);
    ui.editing = null; commit("Data " + m.name + " diperbarui");
  }
});

app.addEventListener("input", e => {
  if (e.target.id === "q") { ui.q = e.target.value; const l = $("#list"); if (l) l.innerHTML = listRows(ui.round); }
});
document.addEventListener("click", e => {
  if (!ui.modal) return;
  const b = e.target.closest("[data-act]");
  if (e.target.id === "modal" || (b && b.dataset.act === "closeModal")) { ui.modal = null; renderModal(); }
  else if (b && b.dataset.act === "dlProof" && ui.modal.img) downloadUrl("bukti-transfer-" + slug() + "-p" + (ui.modal.r+1) + "-" + memberName(ui.modal.id).toLowerCase().replace(/[^a-z0-9]+/g, "-") + (ui.modal.img.startsWith("data:image/png") ? ".png" : ".jpg"), ui.modal.img);
});
document.addEventListener("keydown", e => { if (e.key === "Escape" && ui.modal) { ui.modal = null; renderModal(); } });
app.addEventListener("change", e => {
  const t = e.target;
  if (t.classList.contains("proofFile") && t.files && t.files[0]) {
    if (!mustEdit()) return;
    const r = +t.dataset.r, id = t.dataset.id;
    fileToDataUrl(t.files[0]).then(d => saveProof(r, id, d), err => toast(err.message));
    return;
  }
  if (t.id === "qrFile" && t.files && t.files[0]) {
    if (!mustEdit()) return;
    fileToQrDataUrl(t.files[0]).then(saveQr, err => toast(err.message));
    return;
  }
  if (t.dataset && t.dataset.acc) {
    if (!mustEdit()) return;
    const a = S.pay.accounts.find(x => x.id === t.dataset.acc); if (!a) return;
    a[t.dataset.k] = t.value.trim();
    commit(a.number ? "Info rekening " + (a.bank || "") + " diperbarui" : null);
    return;
  }
  if (t.id === "pay_note") { if (!mustEdit()) return; S.pay.note = t.value.trim(); commit("Catatan pembayaran diperbarui"); return; }
  if (t.id === "manualWin" && t.value) { if (!mustEdit()) return; addWinners(ui.round, [t.value]); return; }
  if (t.classList.contains("repSel") && t.value) {
    if (!mustEdit()) return;
    const r = ui.round, oldId = t.dataset.id, [kind, newId, other] = t.value.split(":");
    if (kind === "n") {
      setRound(r, winIds(r).map(x => x === oldId ? newId : x));
      commit(memberName(oldId) + " diganti " + memberName(newId) + " (Putaran " + (r+1) + ")");
    } else if (kind === "s") {
      const k = +other;
      setRound(r, winIds(r).map(x => x === oldId ? newId : x));
      setRound(k, winIds(k).map(x => x === newId ? oldId : x));
      commit(memberName(oldId) + " tukar giliran dengan " + memberName(newId) + " (P" + (r+1) + " ↔ P" + (k+1) + ")");
    }
    return;
  }
  if (t.id === "c_k") return;
  if (!t.id || !t.id.startsWith("s_") || !mustEdit()) return;
  if (t.id === "s_name") { S.name = t.value.trim() || "Arisan"; document.title = S.name + " · Buku Arisan"; commit("Nama arisan diubah"); }
  if (t.id === "s_amount") { S.defaultAmount = digits(t.value) || S.defaultAmount; commit("Iuran standar jadi " + rp(S.defaultAmount)); }
  if (t.id === "s_cycle") { S.cycle = t.value; commit("Periode jadi " + cycleLabel[S.cycle]); }
  if (t.id === "s_start") { if (t.value) { S.startDate = t.value; commit("Tanggal kocokan pertama diubah"); } }
  if (t.id === "s_k") { S.winnersPerRound = +t.value; S.current = Math.min(S.current, totalRounds()-1); ui.round = Math.min(ui.round, totalRounds()-1); commit("Pemenang per putaran jadi " + K() + " orang"); }
  if (t.id === "s_current") { S.current = +t.value; ui.round = S.current; commit("Putaran berjalan diubah ke " + (S.current+1)); }
});
window.addEventListener("beforeunload", e => { if (mode === "remote" && (dirty || saveTimer || saving)) { e.preventDefault(); e.returnValue = ""; } });

boot();
})();
