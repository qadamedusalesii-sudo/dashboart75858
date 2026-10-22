// amoCRM API v4 mijoz: uzoq muddatli token, limit (≈6 so'rov/s), qayta urinish.
const cfg = require('./config');

const BASE = () => process.env.AMO_BASE || `https://${cfg.amo.domain}`;
let last = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function throttle() {
  const wait = last + cfg.amo.minIntervalMs - Date.now();
  last = Math.max(Date.now(), last + cfg.amo.minIntervalMs);
  if (wait > 0) await sleep(wait);
}

async function get(path) {
  if (!cfg.amo.token) throw new Error('AMO_TOKEN berilmagan');
  for (let attempt = 0; attempt < 8; attempt++) {
    await throttle();
    let r;
    try {
      r = await fetch(BASE() + path, { headers: { Authorization: `Bearer ${cfg.amo.token}` } });
    } catch (e) {
      await sleep(1500 * (attempt + 1));
      continue;
    }
    if (r.status === 204) return null;
    if (r.status === 429 || r.status >= 500) { await sleep(1500 * (attempt + 1)); continue; }
    if (r.status === 401) throw new Error('amoCRM token noto\'g\'ri yoki muddati o\'tgan (401)');
    if (!r.ok) throw new Error(`amoCRM ${r.status}: ${path.slice(0, 120)} — ${(await r.text()).slice(0, 200)}`);
    return r.json();
  }
  throw new Error('amoCRM javob bermadi: ' + path.slice(0, 120));
}

// Sahifalab hammasini olish. key — _embedded ichidagi kalit.
async function all(path, key, limit = 250, maxPages = 2000) {
  const out = [];
  const sep = path.includes('?') ? '&' : '?';
  for (let page = 1; page <= maxPages; page++) {
    const j = await get(`${path}${sep}limit=${limit}&page=${page}`);
    const arr = j?._embedded?.[key] || [];
    out.push(...arr);
    if (arr.length < limit) break;
  }
  return out;
}

const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
const cf = (l, id) => (l.custom_fields_values || []).find((f) => f.field_id === id)?.values?.map((v) => v.value).join('|') || '';

async function users() {
  const acc = await get('/api/v4/account?with=users_groups');
  const groups = {};
  for (const g of acc?._embedded?.users_groups || []) groups[g.id] = g.name;
  const list = await all('/api/v4/users', 'users', 250);
  const out = {};
  for (const u of list) {
    out[u.id] = {
      id: u.id,
      name: String(u.name || '').replace(/\s+/g, ' ').trim(),
      team: groups[u.rights?.group_id] || (u.rights?.group_id ? 'group_' + u.rights.group_id : ''),
      active: u.rights?.is_active !== false,
    };
  }
  return out;
}

async function pipelines() {
  const j = await get('/api/v4/leads/pipelines');
  return j?._embedded?.pipelines || [];
}

// Bosqich darajasi: 2 взято, 3 квал, 4 счет (ОЖОП/Оформление), 5 to'lov (Часть оплачена / 142), -1 закрыто, 1 yangi
function levelMap(pls) {
  const lv = {};
  for (const p of pls) {
    if (!cfg.amo.salesPipelines.includes(p.id)) continue;
    for (const s of p._embedded?.statuses || []) {
      const n = String(s.name || '').toLowerCase();
      let l = 0;
      if (s.id === 142 || n.includes('часть опл')) l = 5;
      else if (s.id === 143) l = -1;
      else if (n.includes('ожоп') || n.includes('оформлен')) l = 4;
      else if (n.includes('квалиф')) l = 3;
      else if (n.includes('взято')) l = 2;
      else if (n.includes('новый') || n.includes('неразобр')) l = 1;
      lv[p.id + ':' + s.id] = l;
    }
  }
  return lv;
}

const leadRow = (l) => ({
  id: l.id, u: l.responsible_user_id, pl: l.pipeline_id, st: l.status_id, price: l.price || 0,
  ca: l.created_at, ua: l.updated_at, task: l.closest_task_at || 0,
  reason: cf(l, cfg.amo.reasonFieldId), comment: cf(l, cfg.amo.commentFieldId),
});

async function leadsCreated(from, to) {
  const l = await all(`/api/v4/leads?filter[created_at][from]=${from}&filter[created_at][to]=${to}`, 'leads');
  return l.map(leadRow);
}

async function leadsByIds(ids) {
  const out = [];
  for (const c of chunk([...new Set(ids)], 200)) {
    const j = await get(`/api/v4/leads?limit=250&${c.map((x) => 'filter[id][]=' + x).join('&')}`);
    out.push(...(j?._embedded?.leads || []).map(leadRow));
  }
  return out;
}

// Ochiq lidlar (gigiyena uchun): savdo voronkalaridagi yopilmagan bosqichlar
async function openLeads(pls) {
  const ents = [];
  for (const p of pls) {
    if (!cfg.amo.salesPipelines.includes(p.id)) continue;
    for (const s of p._embedded?.statuses || []) if (s.id !== 142 && s.id !== 143) ents.push([p.id, s.id]);
  }
  const out = [];
  for (const c of chunk(ents, 40)) {
    const q = c.map(([p, s], i) => `filter[statuses][${i}][pipeline_id]=${p}&filter[statuses][${i}][status_id]=${s}`).join('&');
    out.push(...(await all(`/api/v4/leads?${q}`, 'leads')).map(leadRow));
  }
  return out;
}

async function openTasks() {
  const t = await all('/api/v4/tasks?filter[is_completed]=0', 'tasks');
  return t.map((x) => ({ id: x.id, u: x.responsible_user_id, till: x.complete_till, et: x.entity_type, eid: x.entity_id }));
}

// Hodisalar. createdBy — 10 tadan guruhlanadi (amoCRM cheklovi).
async function events({ from, to, types, createdBy, valueAfter }) {
  const base = [`filter[created_at][from]=${from}`, `filter[created_at][to]=${to}`];
  for (const t of types || []) base.push('filter[type][]=' + t);
  if (valueAfter) valueAfter.forEach(([p, s], i) => base.push(`filter[value_after][leads_statuses][${i}][pipeline_id]=${p}&filter[value_after][leads_statuses][${i}][status_id]=${s}`));
  const groups = createdBy && createdBy.length ? chunk(createdBy, 10) : [null];
  const out = [];
  for (const g of groups) {
    const q = [...base, ...(g ? g.map((i) => 'filter[created_by][]=' + i) : [])].join('&');
    out.push(...(await all(`/api/v4/events?${q}`, 'events', 100)));
  }
  return out;
}

// Lidlar bo'yicha qo'ng'iroq eslatmalari: {leadId: [[created_at, duration, call_status]]}
async function callNotes(leadIds) {
  const out = {};
  for (const c of chunk([...new Set(leadIds)], 40)) {
    const q = c.map((x) => 'filter[entity_id][]=' + x).join('&');
    const notes = await all(`/api/v4/leads/notes?filter[note_type][]=call_in&filter[note_type][]=call_out&${q}`, 'notes', 250, 20);
    for (const n of notes) (out[n.entity_id] = out[n.entity_id] || []).push([n.created_at, n.params?.duration || 0, n.params?.call_status || 0]);
  }
  return out;
}

module.exports = { get, users, pipelines, levelMap, leadsCreated, leadsByIds, openLeads, openTasks, events, callNotes };
