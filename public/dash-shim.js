// Kichik "dash" muhiti: sahifa kodi Claude dashboard'idagidek ishlashi uchun.
// Ma'lumot /api/data dan olinadi va har 2 daqiqada yangilanadi.
(function () {
  const sources = {}; const calcs = []; const subs = []; let results = {}; let status = 'loading';
  const KEEP = ['team', 'view', '_sort'];
  const defaults = { day: null, team: null, status: null, view: 'cards', _sort: null, _q: null, err_m: null, err_r: null };
  let params = { ...defaults };
  try { const saved = JSON.parse(localStorage.getItem('qd_params') || '{}'); for (const k of KEEP) if (k in saved) params[k] = saved[k]; } catch (e) {}

  let queued = false;
  function notify() {
    if (queued) return; queued = true;
    requestAnimationFrame(() => { queued = false; for (const f of subs) { try { f(); } catch (e) { console.error(e); } } });
  }
  function run() {
    results = { ...sources };
    for (const c of calcs) {
      try { results[c.id] = c.fn(...c.inputs.map((i) => results[i] || [])); } catch (e) { console.error('calc', c.id, e); results[c.id] = null; }
    }
    notify();
  }

  window.dash = {
    data(id) {
      if (status !== 'ok') return { status, data: [], message: '', refreshing: false, meta: [] };
      const d = results[id];
      return d == null ? { status: 'error', data: [], message: '' } : { status: 'ok', data: d, columns: d[0] ? Object.keys(d[0]) : [], refreshing: false, meta: [] };
    },
    onData(fn) { subs.push(fn); try { fn(); } catch (e) { console.error(e); } },
    calc(id, o) { calcs.push({ id, inputs: o.inputs, fn: o.fn }); if (status === 'ok') run(); },
    loader() {},
    colors: ['#b02a2a', '#7a1f1f', '#d9822b', '#3d7a5a', '#4a6fa5', '#8a5a9e', '#a3a3a3', '#5c1717'],
    params() { return { ...params }; },
    setParams(o) {
      Object.assign(params, o);
      try { const s = {}; for (const k of KEEP) s[k] = params[k]; localStorage.setItem('qd_params', JSON.stringify(s)); } catch (e) {}
      notify();
    },
    resetParams() { params = { ...defaults }; notify(); },
    setLink(name) { try { history.replaceState(null, '', '#' + name); } catch (e) {} },
    refresh() { load(); },
  };

  async function load() {
    try {
      const r = await fetch('api/data', { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status);
      const j = await r.json();
      sources.kunlik = j.kunlik; sources.xatolar = j.xatolar;
      status = j.kunlik.length ? 'ok' : 'loading';
      const el = document.querySelector('.lx-updated');
      if (el) el.textContent = j.updated ? 'Yangilandi: ' + new Date(j.updated).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tashkent' }) + (j.pbx_ok ? '' : ' · onlinePBX ulanmadi') : "Ma'lumot yig'ilmoqda…";
      run();
    } catch (e) {
      console.error(e);
      if (status !== 'ok') { status = 'error'; notify(); }
    }
  }
  window.addEventListener('resize', notify);
  window.addEventListener('DOMContentLoaded', () => { load(); setInterval(load, 2 * 60 * 1000); });
})();
