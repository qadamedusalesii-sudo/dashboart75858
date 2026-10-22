const express = require('express');
const path = require('path');
const cfg = require('./src/config');
const sync = require('./src/sync');

const app = express();
app.disable('x-powered-by');

app.get('/health', (req, res) => res.json({ ok: true, ...sync.status() }));

// Login/parol (Basic Auth). DASH_PASS berilmasa — ochiq (faqat sinov uchun).
app.use((req, res, next) => {
  if (!cfg.dashPass) return next();
  const h = req.headers.authorization || '';
  const [type, b64] = h.split(' ');
  if (type === 'Basic' && b64) {
    const [u, ...p] = Buffer.from(b64, 'base64').toString().split(':');
    if (u === cfg.dashUser && p.join(':') === cfg.dashPass) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Qadam dashboard", charset="UTF-8"').status(401).send('Login kerak');
});

app.get('/api/data', (req, res) => {
  const n = Math.min(Number(req.query.days) || cfg.daysBack + 1, 60);
  res.set('Cache-Control', 'no-store').json(sync.data(n));
});
app.get('/api/status', (req, res) => res.json(sync.status()));
app.post('/api/refresh', (req, res) => { sync.tick(); res.json({ started: true }); });

app.get('/vendor/d3.min.js', (req, res) => res.sendFile(path.join(__dirname, 'node_modules', 'd3', 'dist', 'd3.min.js')));
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html', maxAge: '5m' }));

app.listen(cfg.port, () => {
  console.log(`Qadam dashboard: http://localhost:${cfg.port}`);
  if (!cfg.dashPass) console.warn('DIQQAT: DASH_PASS berilmagan — dashboard parolsiz ochiq!');
  if (!cfg.amo.token) console.warn('DIQQAT: AMO_TOKEN berilmagan — sinxronizatsiya ishlamaydi');
  if (!cfg.pbx.apiKey) console.warn('DIQQAT: PBX_API_KEY berilmagan — qo\'ng\'iroqlar olinmaydi');
  if (cfg.amo.token) {
    sync.tick();
    setInterval(() => sync.tick(), cfg.syncMinutes * 60 * 1000);
  }
});
