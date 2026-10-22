// onlinePBX HTTP API (api2.onlinepbx.ru): auth.json -> key_id:key, keyin mongo_history/search.json
const cfg = require('./config');

let session = null; // { header }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(path, body, auth = true) {
  const url = `${cfg.pbx.base}/${cfg.pbx.domain}/${path}`;
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
  if (auth) headers['x-pbx-authentication'] = session.header;
  const r = await fetch(url, { method: 'POST', headers, body: new URLSearchParams(body).toString() });
  if (r.status === 429) { await sleep(2000); return post(path, body, auth); }
  const text = await r.text();
  try { return JSON.parse(text); } catch (e) { throw new Error(`onlinePBX ${r.status}: ${text.slice(0, 200)}`); }
}

async function login(force) {
  if (!cfg.pbx.apiKey) throw new Error('PBX_API_KEY berilmagan');
  const body = { auth_key: cfg.pbx.apiKey };
  if (force) body.new = 'true';
  const j = await post('auth.json', body, false);
  if (String(j.status) !== '1' || !j.data?.key) throw new Error('onlinePBX avtorizatsiya xatosi: ' + JSON.stringify(j).slice(0, 200));
  session = { header: `${j.data.key_id}:${j.data.key}` };
}

async function call(path, body) {
  if (!session) await login();
  let j = await post(path, body);
  if (j.isNotAuth) { await login(true); j = await post(path, body); }
  if (String(j.status) !== '1') throw new Error(`onlinePBX ${path}: ${JSON.stringify(j).slice(0, 200)}`);
  return j.data;
}

// [from, to] oralig'idagi barcha qo'ng'iroqlar. Bir so'rovda 1 haftagacha; xavfsizlik uchun 6 soatlik bo'laklarda.
async function calls(from, to) {
  const out = [];
  const seen = new Set();
  for (let a = from; a <= to; a += 6 * 3600) {
    const b = Math.min(to, a + 6 * 3600 - 1);
    const data = await call('mongo_history/search.json', { start_stamp_from: a, start_stamp_to: b });
    for (const c of Array.isArray(data) ? data : []) {
      if (seen.has(c.uuid)) continue;
      seen.add(c.uuid);
      out.push(c);
    }
  }
  return out;
}

const isExt = (x) => /^\d{2,4}$/.test(String(x ?? ''));

// Qo'ng'iroqni ichki raqamga bog'lash: chiquvchi — caller_id_number; kiruvchi — javob bergan foydalanuvchi (events) yoki destination_number
function extOf(c) {
  const ac = String(c.accountcode || '');
  if (ac === 'outbound') return isExt(c.caller_id_number) ? String(c.caller_id_number) : null;
  if (ac === 'inbound' || ac === 'missed') {
    const ans = (c.events || []).filter((e) => e.type === 'user' && Number(e.answered_stamp) > 0 && isExt(e.number));
    if (ans.length) return String(ans[ans.length - 1].number);
    return isExt(c.destination_number) ? String(c.destination_number) : null;
  }
  return null; // local va boshqalar hisobga olinmaydi
}

module.exports = { calls, extOf };
