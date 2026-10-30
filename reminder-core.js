/* Buku Arisan — inti pesan pengingat WhatsApp.
 * Dipakai bersama oleh aplikasi (pratinjau di Pengaturan) dan oleh
 * scripts/send-reminder.mjs (pengiriman terjadwal), jadi isi pesan selalu sama.
 * Semua tanggal dihitung sebagai tanggal kalender (UTC) supaya tidak bergeser zona waktu.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ReminderCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const MONTHS = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
  const DAYS = ["Minggu","Senin","Selasa","Rabu","Kamis","Jumat","Sabtu"];
  const DAY_OPTIONS = [7, 3, 2, 1, 0];
  const DEFAULTS = { enabled: false, days: [3, 1], group: true, personal: true, treasurer: true };

  const rp = n => "Rp " + Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const parseYmd = s => { const [y, m, d] = String(s || "").split("-").map(Number); return Date.UTC(y || 2026, (m || 1) - 1, d || 1); };

  function settings(data) {
    const r = Object.assign({}, DEFAULTS, (data && data.reminder) || {});
    r.days = (Array.isArray(r.days) ? r.days : DEFAULTS.days).map(Number).filter(d => DAY_OPTIONS.includes(d)).sort((a, b) => b - a);
    return r;
  }
  function K(data) { return Math.min(10, Math.max(1, parseInt(data.winnersPerRound, 10) || 1)); }
  function totalRounds(data) { return Math.max(1, Math.ceil((data.members || []).length / K(data))); }
  function slots(data, r) { const n = (data.members || []).length; return Math.max(1, Math.min(K(data), n - K(data) * r)); }
  function pot(data) { return (data.members || []).reduce((a, m) => a + (Number(m.amount) || 0), 0); }
  function roundDate(data, i) {
    const d = new Date(parseYmd(data.startDate));
    if (data.cycle === "mingguan") d.setUTCDate(d.getUTCDate() + 7 * i);
    else if (data.cycle === "2mingguan") d.setUTCDate(d.getUTCDate() + 14 * i);
    else d.setUTCMonth(d.getUTCMonth() + i);
    return d;
  }
  const fmtDate = d => DAYS[d.getUTCDay()] + ", " + d.getUTCDate() + " " + MONTHS[d.getUTCMonth()];
  const isPaid = (data, r, id) => !!(data.payments && data.payments[r] && data.payments[r][id]);
  const firstName = n => String(n || "").trim().split(/\s+/)[0] || n;
  const when = left => left === 0 ? "HARI INI" : left === 1 ? "BESOK" : left + " hari lagi";

  function payBlock(data, opts) {
    const pay = (data && data.pay) || {};
    const acc = (pay.accounts || []).filter(a => String(a.number || "").trim());
    const lines = acc.map(a => "• " + (a.bank || "Rekening") + " " + a.number + (a.holder ? " a.n. " + a.holder : ""));
    if (opts.hasQr) lines.push("• QRIS: scan di link di bawah");
    if (!lines.length) return "";
    return "\n\n*Transfer ke:*\n" + lines.join("\n") + (pay.note ? "\n" + pay.note : "");
  }

  /* Rencana pengingat untuk satu hari.
   * opts: { today: "YYYY-MM-DD", url, hasQr, force } */
  function build(data, opts) {
    opts = opts || {};
    const cfg = settings(data);
    const members = data.members || [];
    const R = totalRounds(data);
    const r = Math.min(Math.max(0, data.current || 0), R - 1);
    const due = roundDate(data, r);
    const left = Math.round((due.getTime() - parseYmd(opts.today)) / 86400000);
    const unpaid = members.filter(m => !isPaid(data, r, m.id));
    const paidN = members.length - unpaid.length;
    const short = unpaid.reduce((a, m) => a + (Number(m.amount) || 0), 0);
    const name = data.name || "Arisan";
    const link = opts.url ? "\n\nCek status & QRIS: " + opts.url : "";
    const pb = payBlock(data, opts);

    let reason = "";
    if (!cfg.enabled) reason = "Pengingat otomatis belum diaktifkan di Pengaturan.";
    else if (!members.length) reason = "Belum ada anggota.";
    else if (left < 0) reason = "Tanggal kocokan putaran " + (r + 1) + " sudah lewat; mulai putaran berikutnya di aplikasi.";
    else if (!opts.force && !cfg.days.includes(left)) reason = "Hari ini H-" + left + "; jadwal kirim: " + cfg.days.map(d => d === 0 ? "hari-H" : "H-" + d).join(", ") + ".";
    const shouldSend = !reason;
    const label = left < 0 ? "lewat " + (-left) + " hari" : left === 0 ? "hari-H" : "H-" + left;

    const head = "*Pengingat " + name + " — Putaran " + (r + 1) + "*\nKocokan: " + fmtDate(due) + " (" + when(Math.max(0, left)) + ")\n";
    const group = unpaid.length
      ? head + "\nYang belum transfer (" + unpaid.length + " dari " + members.length + "):\n"
        + unpaid.map((m, i) => (i + 1) + ". " + m.name + " — " + rp(m.amount)).join("\n")
        + "\n\nMohon segera transfer ya, terima kasih 🙏" + pb + link
      : head + "\nSemua " + members.length + " anggota sudah transfer. Terima kasih! 🎉" + link;

    const personal = unpaid.filter(m => String(m.phone || "").replace(/\D/g, "").length >= 9).map(m => ({
      id: m.id, name: m.name, phone: String(m.phone).replace(/\D/g, "").replace(/^0/, "62"),
      message: "Halo " + firstName(m.name) + ", pengingat iuran *" + name + "* putaran " + (r + 1) + " sebesar *" + rp(m.amount) + "*.\n"
        + "Kocokan: " + fmtDate(due) + " (" + when(Math.max(0, left)) + ")." + pb + link
        + "\n\nAbaikan pesan ini kalau sudah transfer. Terima kasih 🙏"
    }));
    const noPhone = unpaid.filter(m => !personal.some(p => p.id === m.id)).map(m => m.name);

    const treasurer = "*Rekap otomatis " + name + " — Putaran " + (r + 1) + "*\n"
      + "Kocokan " + fmtDate(due) + " (" + label + ")\n"
      + "Sudah transfer: " + paidN + "/" + members.length + "\n"
      + "Kurang: " + rp(short) + " dari " + rp(pot(data))
      + (unpaid.length ? "\nBelum: " + unpaid.map(m => m.name).join(", ") : "")
      + (noPhone.length ? "\nTidak bisa dijapri (tanpa nomor WA): " + noPhone.join(", ") : "");

    return { cfg, shouldSend, reason, round: r, due, dueText: fmtDate(due), left, label, unpaid, paidN,
      group: cfg.group ? group : null, personal: cfg.personal && unpaid.length ? personal : [], noPhone,
      treasurer: cfg.treasurer ? treasurer : null };
  }

  /* Tanggal kirim berikutnya (untuk ditampilkan di aplikasi). */
  function nextSend(data, today) {
    const cfg = settings(data);
    if (!cfg.enabled || !(data.members || []).length) return null;
    const R = totalRounds(data), t = parseYmd(today);
    for (let r = Math.min(data.current || 0, R - 1); r < R; r++) {
      const due = roundDate(data, r);
      for (const d of cfg.days) {
        const at = due.getTime() - d * 86400000;
        if (at >= t) return { round: r, date: new Date(at), label: d === 0 ? "hari-H" : "H-" + d, dateText: fmtDate(new Date(at)) };
      }
    }
    return null;
  }

  return { build, nextSend, settings, DAY_OPTIONS, DEFAULTS, fmtDate, rp };
});
