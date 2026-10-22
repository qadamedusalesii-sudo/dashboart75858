// Kunlik hisob: amoCRM + onlinePBX -> menejer × kun qatorlari va kamchiliklar ro'yxati.
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const amo = require('./amo');
const pbx = require('./pbx');

const WORK_HOURS = Number(process.env.WORK_HOURS || 8);
const DAY = 86400;
const SLOT = 900; // 15 daqiqa

// ---------- vaqt yordamchilari ----------
// "Kun" = UTC sutkasi = Toshkent 05:00 -> ertasi 05:00
const dayOf = (t) => new Date(t * 1000).toISOString().slice(0, 10);
const dayStart = (d) => Date.parse(d + 'T00:00:00Z') / 1000;
const hm = (t) => new Date((t + cfg.tzOffsetHours * 3600) * 1000).toISOString().slice(11, 16);
const tkHour = (t) => new Date((t + cfg.tzOffsetHours * 3600) * 1000).getUTCHours();
const now = () => Math.floor(Date.now() / 1000);
const r1 = (x) => Math.round(x * 10) / 10;

// ---------- saqlash ----------
const dir = (...p) => path.join(cfg.dataDir, ...p);
function ensureDirs() { fs.mkdirSync(dir('days'), { recursive: true }); }
function writeDay(d, obj) { ensureDirs(); const f = dir('days', d + '.json'); fs.writeFileSync(f + '.tmp', JSON.stringify(obj)); fs.renameSync(f + '.tmp', f); }
function readDay(d) { try { return JSON.parse(fs.readFileSync(dir('days', d + '.json'), 'utf8')); } catch (e) { return null; } }
function listDays() { try { return fs.readdirSync(dir('days')).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map((f) => f.slice(0, 10)).sort(); } catch (e) { return []; } }

// ---------- sabab turlari (reglament) ----------
const low = (s) => String(s || '').toLowerCase();
function reasonCat(r) {
  r = low(r);
  if (!r) return 'none';
  if (r.includes('lanib')) return 'ndz'; // Bog'lanib bo'lmadi
  if (r.includes('konsult')) return 'kndz'; // Konsultatsiyadan keyin 3 martta NDZ
  if (r.includes('дублик') || r.includes('тест')) return 'dubl';
  if (r.includes('noto') && r.includes('raqam')) return 'wrong';
  if (r.includes('boshqa sabab')) return 'other';
  return 'talk'; // suhbat talab qiladigan sabablar (Qimmat, Bemaqsad, ...)
}
function badComment(z) {
  z = String(z || '').trim();
  if (!z) return true;
  if (/^[\d\W_]+$/u.test(z)) return true;
  if (['ndz', 'ндз'].includes(low(z))) return true;
  return (z.match(/\p{L}/gu) || []).length < 4;
}
const talked = (c) => c[2] === 4 || (c[2] === 0 && c[1] > 0);
const mins1 = (s) => Math.round(s / 6) / 10;

// ---------- menejer nomi va ichki raqam ----------
function managerIndex(users) {
  const ex = new Set(cfg.amo.excludeUserIds.map(String));
  const ok = (id) => users[id] && !ex.has(String(id));
  const ext2name = {};
  for (const u of Object.values(users)) {
    if (!u.active || ex.has(String(u.id))) continue;
    for (const x of u.name.match(/\b\d{3}\b/g) || []) if (!ext2name[x]) ext2name[x] = u.name;
  }
  Object.assign(ext2name, cfg.extMap);
  const teamByName = {};
  for (const u of Object.values(users)) teamByName[u.name] = u.team;
  return { ok, name: (id) => users[id]?.name, ext2name, teamByName };
}

// ---------- bitta kunni hisoblash ----------
async function computeDay(d, ctx) {
  const { users, idx, LV, pls } = ctx;
  const from = dayStart(d);
  const to = Math.min(from + DAY - 1, now());
  if (to < from) return null;
  const sales = new Set(cfg.amo.salesPipelines);
  const r6p = new Set(cfg.amo.r6Pipelines);
  const managerIds = Object.values(users).filter((u) => u.active && idx.ok(u.id)).map((u) => u.id);

  const R = {}; // name -> row accumulator
  const row = (name) => R[name] = R[name] || {
    manager: name, team: idx.teamByName[name] || 'PBX', day: d,
    new_leads: 0, taken: 0, qualified: 0, invoiced: 0, invoiced_sum: 0, paid: 0, paid_sum: 0, closed: 0,
    calls: 0, connected: 0, talk_sec: 0, first_call: null, crm_actions: 0, pts: [], slots: new Set(),
  };
  const errors = [];
  const addErr = (uid, day, leadId, rule, text) => { const n = idx.name(uid); if (!n || !idx.ok(uid)) return; errors.push({ day, manager: n, lead_id: leadId, rule, problem: text }); };

  // 1) yangi lidlar
  const created = await amo.leadsCreated(from, to);
  for (const l of created) if (sales.has(l.pl) && idx.ok(l.u)) row(idx.name(l.u)).new_leads++;

  // 2) bosqich o'tishlari (shu kunda) + yopilishlar
  const lvEntries = Object.entries(LV).filter(([, l]) => l >= 2 || l === -1).map(([k]) => k.split(':').map(Number));
  const sev = await amo.events({ from, to, types: ['lead_status_changed'], valueAfter: lvEntries });
  const byLead = {};
  for (const e of sev) {
    if (cfg.amo.excludeUserIds.includes(String(e.created_by))) continue;
    const v = e.value_after?.[0]?.lead_status; if (!v) continue;
    (byLead[e.entity_id] = byLead[e.entity_id] || []).push({ t: e.created_at, by: e.created_by, lv: LV[v.pipeline_id + ':' + v.id] || 0 });
  }
  const known = {}; for (const l of created) known[l.id] = l;
  const need = Object.keys(byLead).map(Number).filter((id) => !known[id]);
  for (const l of await amo.leadsByIds(need)) known[l.id] = l;

  const closes = []; // [leadId, closerId, t]
  for (const [id, evs] of Object.entries(byLead)) {
    const l = known[id]; if (!l || !sales.has(l.pl)) continue;
    evs.sort((a, b) => a.t - b.t);
    const seen = {}; let lastClose = null;
    for (const e of evs) { if (e.lv === -1) { lastClose = e; continue; } for (let L = 2; L <= e.lv; L++) seen[L] = 1; }
    if (idx.ok(l.u)) {
      const r = row(idx.name(l.u));
      if (seen[2]) r.taken++;
      if (seen[3]) r.qualified++;
      if (seen[4]) { r.invoiced++; r.invoiced_sum += l.price; }
      if (seen[5]) { r.paid++; r.paid_sum += l.price; }
    }
    if (lastClose && idx.ok(lastClose.by)) { row(idx.name(lastClose.by)).closed++; closes.push([Number(id), lastClose.by, lastClose.t]); }
  }

  // 3) CRM faolligi (menejer harakatlari)
  const types = ['lead_status_changed', 'task_completed', 'task_added', 'common_note_added', 'task_result_added', 'entity_responsible_changed', 'outgoing_chat_message', 'incoming_chat_message', 'lead_added', 'contact_added', 'outgoing_call', 'incoming_call'];
  const act = await amo.events({ from, to, types, createdBy: managerIds });
  for (const e of act) {
    if (!idx.ok(e.created_by)) continue;
    const r = row(idx.name(e.created_by));
    r.crm_actions++; r.pts.push(e.created_at); r.slots.add(Math.floor(e.created_at / SLOT));
  }

  // 4) onlinePBX qo'ng'iroqlari
  let pbxOk = true;
  try {
    const calls = await pbx.calls(from, to);
    for (const c of calls) {
      const ext = pbx.extOf(c); if (!ext) continue;
      const name = idx.ext2name[ext] || `ext ${ext} (faqat PBX)`;
      const r = row(name);
      const st = Number(c.start_stamp) || 0; const talk = Number(c.user_talk_time) || 0;
      if (c.accountcode === 'outbound') { r.calls++; if (!r.first_call || st < r.first_call) r.first_call = st; }
      else if (talk > 0) r.calls++;
      if (talk > 0) { r.connected++; r.talk_sec += talk; }
      const end = st + Math.max(talk, 0);
      r.pts.push(st, end);
      for (let s = Math.floor(st / SLOT); s <= Math.floor(end / SLOT); s++) r.slots.add(s);
    }
  } catch (e) { pbxOk = false; console.error('[pbx]', d, e.message); }

  // 5) reglament xatolari (R1–R9) — shu kuni yopilgan lidlar va yangi lidlar (R6)
  const r6Leads = created.filter((l) => r6p.has(l.pl) && idx.ok(l.u) && !(l.st === 143 && reasonCat(l.reason) === 'dubl'));
  const notes = await amo.callNotes([...closes.map((c) => c[0]), ...r6Leads.map((l) => l.id)]);
  for (const [id, by, t] of closes) {
    const l = known[id];
    const cs = (notes[id] || []).filter((c) => c[0] <= t + 60);
    const n = cs.length; const mx = Math.max(0, ...cs.filter(talked).map((c) => c[1]));
    const cat = reasonCat(l.reason); const rn = l.reason || '(sababsiz)';
    if (cat === 'none') addErr(by, d, id, 'R5', 'Yopilish sababi tanlanmagan');
    if (cat === 'ndz' && n < 6) addErr(by, d, id, 'R1', `"${rn}" — 6 ta qo'ng'iroq kerak, ${n} ta qilingan`);
    if (cat === 'ndz' && mx >= 60) addErr(by, d, id, 'R2', `"${rn}" qo'yilgan, lekin ${mins1(mx)} daq gaplashilgan`);
    if (mx >= 360 && (['ndz', 'dubl', 'wrong'].includes(cat) || low(l.reason).includes('bemaqsad'))) addErr(by, d, id, 'R3', `${Math.round(mx / 60)} daq suhbat bo'lgan, lekin "${rn}" deb yopilgan (Квал bo'lishi kerak edi)`);
    if (badComment(l.comment)) addErr(by, d, id, 'R4', `Yopilish izohi bo'sh yoki ma'nosiz${l.comment ? ': "' + String(l.comment).slice(0, 40) + '"' : ''}`);
    if (cat === 'talk' && n === 0) addErr(by, d, id, 'R7', `"${rn}" — bitta ham qo'ng'iroqsiz qo'yilgan`);
    if (cat === 'wrong' && mx >= 60) addErr(by, d, id, 'R8', `"Noto'g'ri raqam", lekin ${mins1(mx)} daq gaplashilgan`);
    if (cat === 'kndz' && mx < 360) addErr(by, d, id, 'R9', `"Konsultatsiyadan keyin NDZ", lekin eng uzun suhbat ${mins1(mx)} daq (6+ kerak)`);
  }
  const tnow = now();
  for (const l of r6Leads) {
    const h = tkHour(l.ca);
    let deadline;
    if (h >= 9 && h < 19) deadline = l.ca + 600;
    else { // ertasi (yoki shu) kun 13:00 Toshkent
      const tk = new Date((l.ca + cfg.tzOffsetHours * 3600) * 1000);
      if (h >= 19) tk.setUTCDate(tk.getUTCDate() + 1);
      tk.setUTCHours(13, 0, 0, 0);
      deadline = Math.floor(tk.getTime() / 1000) - cfg.tzOffsetHours * 3600;
    }
    const fc = (notes[l.id] || []).map((c) => c[0]).filter((x) => x >= l.ca - 60).sort((a, b) => a - b)[0];
    if (!fc) { if (tnow > deadline) addErr(l.u, d, l.id, 'R6', `Yangi lidga umuman qo'ng'iroq qilinmagan (lid ${hm(l.ca)} da kelgan)`); }
    else if (fc > deadline) { const m = Math.round((fc - l.ca) / 60); addErr(l.u, d, l.id, 'R6', `Yangi lidga kech qo'ng'iroq: ${hm(l.ca)} da kelgan, ${hm(fc)} da qo'ng'iroq (${m >= 120 ? Math.round(m / 60) + ' soat' : m + ' daq'} o'tib)`); }
  }

  // 6) ish vaqti ko'rsatkichlari
  const rows = Object.values(R).map((r) => {
    const pts = r.pts.filter(Boolean).sort((a, b) => a - b);
    const first = pts[0], last = pts[pts.length - 1];
    let longest = 0, gaps30 = 0;
    for (let i = 1; i < pts.length; i++) { const g = pts[i] - pts[i - 1]; if (g > longest) longest = g; if (g >= 1800) gaps30++; }
    const active = r.slots.size * 0.25;
    const span = first ? (last - first) / 3600 : 0;
    return {
      manager: r.manager, team: r.team, day: d,
      new_leads: r.new_leads, taken: r.taken, qualified: r.qualified, invoiced: r.invoiced, invoiced_sum: r.invoiced_sum,
      paid: r.paid, paid_sum: r.paid_sum, closed: r.closed,
      calls: r.calls, connected: r.connected, talk_min: Math.round(r.talk_sec / 60), first_call: r.first_call ? hm(r.first_call) : '',
      arrived: first ? hm(first) : '', left: last ? hm(last) : '',
      active_hours: r1(active), span_hours: r1(span), idle_hours: r1(Math.max(0, span - active)),
      short_hours: r1(Math.max(0, WORK_HOURS - active)), work_norm: WORK_HOURS,
      longest_gap_min: Math.round(longest / 60), gaps_30: gaps30, crm_actions: r.crm_actions,
    };
  });
  return { day: d, updated: new Date().toISOString(), pbx_ok: pbxOk, kunlik: rows, xatolar: errors };
}

// ---------- gigiyena (joriy holat) ----------
async function hygiene(ctx) {
  const { idx, LV, pls } = ctx;
  const t = now();
  const H = {}; const items = [];
  const h = (uid) => { const n = idx.name(uid); if (!n || !idx.ok(uid)) return null; return H[n] = H[n] || { overdue_tasks: 0, open_leads: 0, leads_no_task: 0, ojop_stale: 0, new_untaken: 0 }; };
  const today = dayOf(t);
  const add = (uid, leadId, rule, text) => { const n = idx.name(uid); if (n && idx.ok(uid)) items.push({ day: today, manager: n, lead_id: leadId, rule, problem: text }); };

  const tasks = await amo.openTasks();
  for (const k of tasks) {
    if (k.till && k.till < t) {
      const x = h(k.u); if (!x) continue; x.overdue_tasks++;
      if (k.et === 'leads') add(k.u, k.eid, 'G1', `Muddati o'tgan vazifa (${Math.max(1, Math.round((t - k.till) / 86400))} kun)`);
    }
  }
  const open = await amo.openLeads(pls);
  for (const l of open) {
    const x = h(l.u); if (!x) continue;
    x.open_leads++;
    const lv = LV[l.pl + ':' + l.st];
    if (!l.task) { x.leads_no_task++; add(l.u, l.id, 'G2', 'Ochiq lid, lekin vazifa qo\'yilmagan'); }
    if (lv === 4 && t - l.ua > 7 * 86400) { x.ojop_stale++; add(l.u, l.id, 'G3', `ОЖОП'da ${Math.round((t - l.ua) / 86400)} kundan beri harakatsiz`); }
    if (lv === 1 && t - l.ca > 3600 && cfg.amo.r6Pipelines.includes(l.pl)) { x.new_untaken++; add(l.u, l.id, 'G4', `Yangi lid ${Math.round((t - l.ca) / 3600)} soatdan beri olinmagan`); }
  }
  return { at: new Date().toISOString(), by: H, items };
}

// ---------- orkestratsiya ----------
let ctxCache = null, ctxAt = 0;
async function context() {
  if (ctxCache && Date.now() - ctxAt < 30 * 60 * 1000) return ctxCache;
  const users = await amo.users();
  const pls = await amo.pipelines();
  ctxCache = { users, pls, LV: amo.levelMap(pls), idx: managerIndex(users) };
  ctxAt = Date.now();
  return ctxCache;
}

let hygCache = null, hygAt = 0;
async function syncDay(d, { withHygiene = false } = {}) {
  const ctx = await context();
  const res = await computeDay(d, ctx);
  if (!res) return null;
  if (withHygiene) {
    if (!hygCache || Date.now() - hygAt > 30 * 60 * 1000) { hygCache = await hygiene(ctx); hygAt = Date.now(); }
    attachHygiene(res, hygCache);
  } else {
    const prev = readDay(d);
    if (prev && prev.hygiene) attachHygiene(res, prev.hygiene);
  }
  writeDay(d, res);
  return res;
}

function attachHygiene(res, hyg) {
  res.hygiene = hyg;
  const names = new Set(res.kunlik.map((r) => r.manager));
  for (const r of res.kunlik) Object.assign(r, { overdue_tasks: 0, open_leads: 0, leads_no_task: 0, ojop_stale: 0, new_untaken: 0 }, hyg.by[r.manager] || {});
  for (const [n, v] of Object.entries(hyg.by)) if (!names.has(n)) res.kunlik.push({ manager: n, team: '', day: res.day, ...v });
  res.xatolar = res.xatolar.filter((e) => !/^G/.test(e.rule)).concat(hyg.items.map((i) => ({ ...i, day: res.day })));
}

let running = false;
async function tick() {
  if (running) return; running = true;
  try {
    const today = dayOf(now());
    await syncDay(today, { withHygiene: true });
    // kecha tugaganidan keyin bir marta yakuniy hisob
    const y = dayOf(now() - DAY); const yd = readDay(y);
    if (!yd || Date.parse(yd.updated) / 1000 < dayStart(today) + 600) await syncDay(y);
    // yetishmayotgan kunlarni to'ldirish
    for (let i = 2; i <= cfg.daysBack; i++) { const dd = dayOf(now() - i * DAY); if (!readDay(dd)) { await syncDay(dd); } }
    // eski kunlarni o'chirish
    const keep = new Set(Array.from({ length: cfg.daysBack + 1 }, (_, i) => dayOf(now() - i * DAY)));
    for (const dd of listDays()) if (!keep.has(dd)) fs.unlinkSync(dir('days', dd + '.json'));
    lastError = null;
  } catch (e) { lastError = e.message; console.error('[sync]', e); }
  finally { running = false; lastRun = new Date().toISOString(); }
}
let lastError = null, lastRun = null;
const status = () => ({ running, lastRun, lastError, days: listDays() });

function data(daysN) {
  const days = listDays().slice(-daysN);
  const out = { kunlik: [], xatolar: [], updated: null, pbx_ok: true };
  for (const d of days) {
    const j = readDay(d); if (!j) continue;
    out.kunlik.push(...j.kunlik); out.xatolar.push(...j.xatolar);
    if (!out.updated || j.updated > out.updated) out.updated = j.updated;
    if (d === days[days.length - 1]) out.pbx_ok = j.pbx_ok !== false;
  }
  return out;
}

module.exports = { syncDay, tick, status, data, computeDay, managerIndex, reasonCat, badComment, _ctx: () => ctxCache };
