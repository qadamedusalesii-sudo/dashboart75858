// Barcha sozlamalar muhit o'zgaruvchilaridan (Railway > Variables) olinadi.
const list = (v, def) => (v ? String(v).split(',').map((x) => x.trim()).filter(Boolean) : def);
const num = (v, def) => (v === undefined || v === '' ? def : Number(v));

let extMap = {};
try { extMap = JSON.parse(process.env.EXT_MAP || '{}'); } catch (e) { console.warn('EXT_MAP JSON emas, e\'tiborsiz qoldirildi'); }

module.exports = {
  port: num(process.env.PORT, 3000),
  dataDir: process.env.DATA_DIR || './data',
  daysBack: num(process.env.DAYS_BACK, 35),
  syncMinutes: num(process.env.SYNC_MINUTES, 10),
  dashUser: process.env.DASH_USER || 'qadam',
  dashPass: process.env.DASH_PASS || '',

  amo: {
    domain: process.env.AMO_DOMAIN || 'qadamsales.amocrm.ru',
    token: process.env.AMO_TOKEN || '',
    reasonFieldId: num(process.env.AMO_REASON_FIELD_ID, 936109),
    commentFieldId: num(process.env.AMO_COMMENT_FIELD_ID, 936111),
    // Savdo voronkalari (yangi lid, bosqichlar, to'lovlar shu yerda hisoblanadi)
    salesPipelines: list(process.env.SALES_PIPELINES, ['6909890', '11071910', '9055770', '10734414', '11220998', '9055778', '8425422', '9888398', '10630306', '6945010', '6945006']).map(Number),
    // R6 (yangi lidga reaksiya) tekshiriladigan voronkalar — Reanimatsiya va Kommyuniti'siz
    r6Pipelines: list(process.env.R6_PIPELINES, ['6909890', '11071910', '9055770', '10734414', '11220998', '9055778', '8425422', '9888398', '10630306']).map(Number),
    excludeUserIds: list(process.env.EXCLUDE_USER_IDS, ['9723882']).map(String),
    minIntervalMs: num(process.env.AMO_MIN_INTERVAL_MS, 160), // ~6 so'rov/soniya (amoCRM limiti 7)
  },

  pbx: {
    domain: process.env.PBX_DOMAIN || 'pbx18476.onpbx.ru',
    apiKey: process.env.PBX_API_KEY || '',
    base: (process.env.PBX_API_BASE || 'https://api2.onlinepbx.ru').replace(/\/$/, ''),
  },

  extMap,
  tzOffsetHours: 5, // Toshkent
  dayStartHour: 5, // kun 05:00 dan 05:00 gacha (Toshkent) = UTC sutkasi
};
