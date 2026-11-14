// ══════════════════════════════════════════════════════════════════════
//  Ski Dashboard — v4.2.2 (_worker.js)
//  Cloudflare Worker — All-in-One Architecture
//
//  Architecture (inspired by UmiCare):
//    - /api/*  → handleApi()   (push subscribe, unsubscribe, test, stats, vapid-key)
//    - /*      → env.ASSETS.fetch(request)  (serves index.html, sw.js, icons, etc.)
//
//  Required Cloudflare bindings:
//    KV binding:   SKI_DATA        (namespace for push subscriptions)
//    ASSETS:       auto (wrangler assets binding)
//
//  Required environment secrets (set in Cloudflare Dashboard):
//    VAPID_PRIVATE_KEY   ← only the 'd' value (base64url)
//
//  Cron: */30 * * * *  (check snow conditions every 30 min)
// ══════════════════════════════════════════════════════════════════════

// ─── VAPID Key Material ───────────────────────────────────────────────────────
// Public key — safe to be in source code
const VAPID_PUBLIC_KEY = 'BOFt84jfiRV3tgCupl8Bhy47IyfbEaFlMprja18X6G9GmihJi_QapcWSgsKHSarYl3UIy4ElB6t9fDxmqEJM83w';
// X/Y coordinates of the public key (needed for JWK private key import)
const VAPID_KEY_X = '4W3ziN-JFXe2AK6mXwGHLjsjJ9sRoWUymuNrXxfob0Y';
const VAPID_KEY_Y = 'mihJi_QapcWSgsKHSarYl3UIy4ElB6t9fDxmqEJM83w';
// Private key 'd' value — set as Cloudflare secret: VAPID_PRIVATE_KEY
// Fallback for dev/testing only (remove in production)

// ─── City → Resort Config (v4.2.2) ─────────────────────────────────────────────
// 5 cities, 8 resorts each, sorted by fame/priority, all within 500 km radius
const CITY_RESORTS = {
  calgary: {
    name: 'Calgary',
    nameZh: '卡加利',
    center: { lat: 51.0447, lon: -114.0719 },
    resorts: [
      { id: 'louise',    name: 'Lake Louise',         emoji: '🏔️', lat: 51.4254, lon: -116.1773, alt: 2637, dist: 153 },
      { id: 'sunshine',  name: 'Sunshine Village',    emoji: '☀️', lat: 51.0630, lon: -115.7729, alt: 2730, dist: 118 },
      { id: 'nakiska',   name: 'Nakiska',             emoji: '🎿', lat: 50.9406, lon: -115.1531, alt: 2258, dist:  77, website: 'skinakiska.com' },
      { id: 'norquay',   name: 'Mt Norquay',          emoji: '⛷️', lat: 51.2035, lon: -115.5622, alt: 2133, dist: 106 },
      { id: 'castle',    name: 'Castle Mountain',     emoji: '🏰', lat: 49.4665, lon: -114.4073, alt: 2275, dist: 194 },
      { id: 'fernie',    name: 'Fernie Alpine Resort',emoji: '🦅', lat: 49.4577, lon: -115.0881, alt: 2068, dist: 189, website: 'skifernie.com' },
      { id: 'kickhorse', name: 'Kicking Horse',       emoji: '🐴', lat: 51.3000, lon: -117.0522, alt: 2450, dist: 205, website: 'kickinghorseresort.com' },
      { id: 'panorama',  name: 'Panorama Mountain',   emoji: '🌄', lat: 50.4625, lon: -116.2355, alt: 2395, dist: 165 },
    ]
  },
  ottawa: {
    name: 'Ottawa',
    nameZh: '渥太華',
    center: { lat: 45.4215, lon: -75.6972 },
    resorts: [
      { id: 'tremblant', name: 'Mont-Tremblant',      emoji: '🏔️', lat: 46.2135, lon: -74.5851, alt:  875, dist: 123 },
      { id: 'montblanc', name: 'Mont Blanc',          emoji: '⛷️', lat: 46.0759, lon: -74.8553, alt:  300, dist: 107 },
      { id: 'montstemarie', name: 'Mont Ste-Marie',   emoji: '🌲', lat: 46.2133, lon: -75.6167, alt:  400, dist:  86 },
      { id: 'calabogie', name: 'Calabogie Peaks',     emoji: '🎿', lat: 45.3028, lon: -76.7372, alt:  350, dist:  82 },
      { id: 'montchilly',name: 'Mont Chilly',         emoji: '❄️', lat: 45.5906, lon: -75.4181, alt:  230, dist:  60 },
      { id: 'edelweiss', name: 'Sommet Edelweiss',    emoji: '🌸', lat: 45.7058, lon: -75.8303, alt:  330, dist:  27 },
      { id: 'cascades',  name: 'Mont Cascades',       emoji: '🌊', lat: 45.6139, lon: -75.6139, alt:  200, dist:  31 },
      { id: 'fortune',   name: 'Camp Fortune',        emoji: '🍀', lat: 45.5175, lon: -75.8428, alt:  360, dist:  14 },
    ]
  },
  toronto: {
    name: 'Toronto',
    nameZh: '多倫多',
    center: { lat: 43.6532, lon: -79.3832 },
    resorts: [
      { id: 'blue',      name: 'Blue Mountain',       emoji: '🔵', lat: 44.5017, lon: -80.3170, alt:  721, dist: 120 },
      { id: 'tremblant', name: 'Mont-Tremblant',      emoji: '🏔️', lat: 46.2135, lon: -74.5851, alt:  875, dist: 473 },
      { id: 'horseshoe', name: 'Horseshoe Resort',    emoji: '🎠', lat: 44.5080, lon: -79.7061, alt:  391, dist: 100 },
      { id: 'mtstlouis', name: 'Mt St Louis Moonstone',emoji:'🌙', lat: 44.5847, lon: -79.7253, alt:  360, dist: 110 },
      { id: 'snowvalleyb',name: 'Snow Valley Barrie', emoji: '🌨️', lat: 44.2952, lon: -79.6539, alt:  300, dist:  89 },
      { id: 'lakeridge', name: 'Lakeridge',           emoji: '🏂', lat: 44.0142, lon: -78.9475, alt:  400, dist:  48 },
      { id: 'beavervlly',name: 'Beaver Valley',       emoji: '🦫', lat: 44.3503, lon: -80.5581, alt:  450, dist: 131 },
      { id: 'hidden',    name: 'Hidden Valley Highlands',emoji:'🌿',lat: 45.3453, lon: -79.1564, alt:  300, dist: 189 },
    ]
  },
  edmonton: {
    name: 'Edmonton',
    nameZh: '埃德蒙頓',
    center: { lat: 53.5461, lon: -113.4938 },
    resorts: [
      { id: 'marmot',    name: 'Marmot Basin',        emoji: '🦦', lat: 52.9079, lon: -118.0630, alt: 2612, dist: 306 },
      { id: 'louise',    name: 'Lake Louise',         emoji: '🏔️', lat: 51.4254, lon: -116.1773, alt: 2637, dist: 298 },
      { id: 'sunshine',  name: 'Sunshine Village',    emoji: '☀️', lat: 51.0630, lon: -115.7729, alt: 2730, dist: 314 },
      { id: 'kickhorse', name: 'Kicking Horse',       emoji: '🐴', lat: 51.3000, lon: -117.0522, alt: 2450, dist: 344, website: 'kickinghorseresort.com' },
      { id: 'nakiska',   name: 'Nakiska',             emoji: '🎿', lat: 50.9406, lon: -115.1531, alt: 2258, dist: 311, website: 'skinakiska.com' },
      { id: 'snowvalleye',name: 'Snow Valley (Edmonton)',emoji:'🌨️',lat: 53.5099, lon: -113.6312, alt: 650, dist:   9 },
      { id: 'sunridge',  name: 'Sunridge Ski Area',   emoji: '🏂', lat: 53.5792, lon: -113.3528, alt: 660, dist:   7 },
      { id: 'rabbithill',name: 'Rabbit Hill',         emoji: '🐇', lat: 53.3826, lon: -113.7012, alt: 760, dist:  22 },
    ]
  },
  vancouver: {
    name: 'Vancouver',
    nameZh: '溫哥華',
    center: { lat: 49.2827, lon: -123.1207 },
    resorts: [
      { id: 'whistler',  name: 'Whistler Blackcomb',  emoji: '🎿', lat: 50.1163, lon: -122.9574, alt: 2182, dist:  93 },
      { id: 'bigwhite',  name: 'Big White',           emoji: '⚪', lat: 49.7321, lon: -118.9367, alt: 2319, dist: 306 },
      { id: 'sunpeaks',  name: 'Sun Peaks',           emoji: '☀️', lat: 50.8824, lon: -119.8936, alt: 2080, dist: 292 },
      { id: 'silverstar',name: 'Silver Star',         emoji: '⭐', lat: 50.3583, lon: -119.0611, alt: 1915, dist: 316 },
      { id: 'grouse',    name: 'Grouse Mountain',     emoji: '🦅', lat: 49.3757, lon: -123.0786, alt:  916, dist:  11 },
      { id: 'cypress',   name: 'Cypress Mountain',    emoji: '🌲', lat: 49.3954, lon: -123.2036, alt:  1440, dist: 14 },
      { id: 'seymour',   name: 'Mt Seymour',          emoji: '🏔️', lat: 49.3793, lon: -122.9468, alt:  1454, dist: 16 },
      { id: 'sasquatch', name: 'Sasquatch Mountain',  emoji: '🦶', lat: 49.3886, lon: -121.8886, alt:  1068, dist: 89 },
    ]
  }
};

// Default city (Calgary — current production)
const DEFAULT_CITY = 'calgary';

// Flat RESORTS list used by existing alert/notify logic (Calgary as default)
const RESORTS = CITY_RESORTS[DEFAULT_CITY].resorts;

// ─── Alert Thresholds ─────────────────────────────────────────────────────────
const ALERTS = {
  POWDER_ALERT:    { key: 'snow_powder',    cm: 10,  enabled: true },
  EPIC_POWDER:     { key: 'snow_epic',      cm: 20,  enabled: true },
  COLD_WARNING:    { key: 'cold_warn',    tempC: -25, enabled: true },
  EXTREME_COLD:    { key: 'cold_extreme', tempC: -32, enabled: true },
  WIND_HIGH:       { key: 'wind_high',   kmh: 60,   enabled: true },
  WIND_EXTREME:    { key: 'wind_extreme',kmh: 90,   enabled: true },
  BLIZZARD:        { key: 'blizzard',    snowCm: 5, windKmh: 50, enabled: true },
  PERFECT_SKI_DAY: { key: 'perfect',     enabled: true },
  STORM_INCOMING:  { key: 'storm',       enabled: true },
};

// ─── CORS Headers ─────────────────────────────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

// ══════════════════════════════════════════════════════════════════════
//  MAIN ENTRY POINT
// ══════════════════════════════════════════════════════════════════════
export default {
  // ── HTTP fetch handler ──────────────────────────────────────────────
  async fetch(request, env) {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    // Route /api/* to our handler
    if (url.pathname.startsWith('/api/')) {
      return handleApi(request, env, url);
    }

    // Everything else → serve static assets (index.html, sw.js, icons, manifest.json)
    return env.ASSETS.fetch(request);
  },

  // ── Cron trigger: check snow every 30 min ──────────────────────────
  async scheduled(event, env, ctx) {
    ctx.waitUntil(checkSnowAndNotify(env));
  },
};

// ══════════════════════════════════════════════════════════════════════
//  API ROUTER
// ══════════════════════════════════════════════════════════════════════
async function handleApi(request, env, url) {
  const path   = url.pathname.replace(/^\/api/, '') || '/';
  const method = request.method;
  const KV     = env.SKI_DATA;

  // GET /api/vapid-public-key — frontend fetches this at startup
  if (path === '/vapid-public-key' && method === 'GET') {
    return json({ key: VAPID_PUBLIC_KEY });
  }

  // POST /api/subscribe — save push subscription
  if (path === '/subscribe' && method === 'POST') {
    const sub = await request.json();
    const endpoint = sub.endpoint || '';
    if (!endpoint.startsWith('http')) {
      return json({ error: 'Invalid subscription: endpoint missing or truncated' }, 400);
    }
    // Store using last 16 chars of endpoint as key (avoids storing full URL as KV key)
    const subKey = 'push:' + endpoint.slice(-16);
    await KV.put(subKey, JSON.stringify(sub));
    // Also store count index
    const keys = await KV.list({ prefix: 'push:' });
    return json({ ok: true, total: keys.keys.length });
  }

  // POST /api/unsubscribe — remove push subscription
  if (path === '/unsubscribe' && method === 'POST') {
    const sub = await request.json();
    const endpoint = sub.endpoint || '';
    const subKey = 'push:' + endpoint.slice(-16);
    await KV.delete(subKey);
    return json({ ok: true });
  }

  // GET /api/test-push — send test push to all subscribers
  if (path === '/test-push' && method === 'GET') {
    const results = await sendToAll(env, KV, {
      title: '❄️ Ski Dashboard 測試',
      body: '推送系統正常運作！ v4.2.2 ✅',
      icon: '/icon-192.png',
      tag: 'ski-test',
      url: '/',
    });
    return json(results);
  }

  // GET /api/check-snow — manual trigger snow check
  if (path === '/check-snow' && method === 'GET') {
    const result = await checkSnowAndNotify(env);
    return json({ ok: true, result });
  }

  // GET /api/snow?city=calgary — live snow reports with normalized model (v4.2.2)
  if (path === '/snow' && method === 'GET') {
    const cityKey = url.searchParams.get('city') || DEFAULT_CITY;
    const cityData = CITY_RESORTS[cityKey];
    if (!cityData) return json({ error: `Unknown city: ${cityKey}`, known: Object.keys(CITY_RESORTS) }, 400);

    const cacheKey = `snow:${cityKey}:v2`;
    const cached = await KV.get(cacheKey);
    if (cached) {
      return new Response(cached, { status: 200, headers: { 'Content-Type': 'application/json', ...CORS } });
    }

    const fetchedAt = new Date().toISOString();
    const resorts = [];
    for (const resort of cityData.resorts) {
      resorts.push(await getNormalizedSnowReport(resort, fetchedAt));
    }

    const payload = JSON.stringify({
      city: cityKey,
      name: cityData.name,
      nameZh: cityData.nameZh,
      fetchedAt,
      cacheTtlSeconds: 1800,
      resorts,
    }, null, 2);

    await KV.put(cacheKey, payload, { expirationTtl: 1800 });
    return new Response(payload, { status: 200, headers: { 'Content-Type': 'application/json', ...CORS } });
  }

  // GET /api/weather?resort=louise — multi-model mountain weather at resort elevation (v4.3.0)
  if (path === '/weather' && method === 'GET') {
    const id = url.searchParams.get('resort') || '';
    if (!findResortById(id)) return json({ error: `Unknown resort: ${id}` }, 400);
    const ck = `weather:${id}:v1`;
    const cached = await KV.get(ck);
    if (cached) return new Response(cached, { status: 200, headers: { 'Content-Type': 'application/json', ...CORS } });
    try {
      const data = await getMountainWeather(id);
      const body = JSON.stringify(data);
      await KV.put(ck, body, { expirationTtl: 1200 });
      return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json', ...CORS } });
    } catch (e) {
      return json({ error: 'weather unavailable', detail: String(e.message || e) }, 502);
    }
  }

  // GET /api/stats — subscriber count + last check
  if (path === '/stats' && method === 'GET') {
    const keys = await KV.list({ prefix: 'push:' });
    const lastCheck = await KV.get('meta:lastCheck');
    return json({
      version: 'v4.3.1',
      subscribers: keys.keys.length,
      lastCheck,
      resorts: RESORTS.map(r => r.name),
      alerts: Object.keys(ALERTS),
    });
  }

  // GET /api/debug — show subscriber endpoints (first 60 chars)
  if (path === '/debug' && method === 'GET') {
    const keys = await KV.list({ prefix: 'push:' });
    const subs = await Promise.all(keys.keys.map(async k => {
      const raw = await KV.get(k.name);
      if (!raw) return null;
      const s = JSON.parse(raw);
      return { key: k.name, endpoint: s.endpoint ? s.endpoint.substring(0, 60) + '...' : 'MISSING' };
    }));
    return json({ version: 'v4.2.2', count: subs.length, subs: subs.filter(Boolean) });
  }

  return json({ version: 'v4.2.2', error: 'Not found' }, 404);
}


function isoOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const cleaned = String(value).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return cleaned ? Number(cleaned[0]) : null;
}

function cleanHtmlText(value) {
  if (!value) return null;
  return String(value)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&rsquo;/g, '’')
    .replace(/&lsquo;/g, '‘')
    .replace(/&ldquo;/g, '“')
    .replace(/&rdquo;/g, '”')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&deg;/g, '°')
    .replace(/&comma;/g, ',')
    .replace(/&NewLine;/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || null;
}

function buildBaseSnowReport(resort, fetchedAt, source) {
  return {
    id: resort.id,
    name: resort.name,
    emoji: resort.emoji,
    dist: resort.dist,
    status: 'unavailable',
    source,
    updatedAt: null,
    fetchedAt,
    metrics: {
      overnightCm: null,
      last24hCm: null,
      last48hCm: null,
      last7dCm: null,
      baseCm: null,
      seasonCm: null,
      liftsOpen: null,
      liftsTotal: null,
      runsOpen: null,
      runsTotal: null,
      groomedRuns: null,
    },
    rawSummary: null,
    notes: [],
  };
}

const BROWSER_HEADERS = {
  // v4.3.1: identify ourselves honestly instead of imitating a browser
  'User-Agent': 'ski-dashboard-ca/4.3.1 (+https://dashboard.westech.com.hk)',
  'Accept-Language': 'en-CA,en;q=0.9',
};

async function fetchText(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      'User-Agent': 'ski-dashboard-ca/4.2.2 (+https://dashboard.westech.com.hk)',
      'Accept': init.accept || 'text/html,application/json;q=0.9,*/*;q=0.8',
      ...(init.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'ski-dashboard-ca/4.2.2 (+https://dashboard.westech.com.hk)',
      'Accept': 'application/json,text/plain;q=0.9,*/*;q=0.8',
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

function toCount(open, total) {
  const a = numberOrNull(open);
  const b = numberOrNull(total);
  return [a, b];
}

function maybeDecode(value) {
  if (typeof value !== 'string') return value;
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

function parseLegacySaveDate(value) {
  const decoded = maybeDecode(value);
  return isoOrNull(decoded);
}

function parsePanoramaCurrentTime(value) {
  if (!value) return null;
  const match = String(value).trim().match(/(\d{1,2}):(\d{2})(AM|PM)\s+(\d{1,2})\s+([A-Za-z]+),\s+(\d{4})/i);
  if (!match) return null;
  let [, hh, mm, meridiem, dd, monthName, yyyy] = match;
  let hour = Number(hh) % 12;
  if (/PM/i.test(meridiem)) hour += 12;
  const monthIndex = ['january','february','march','april','may','june','july','august','september','october','november','december'].indexOf(monthName.toLowerCase());
  if (monthIndex < 0) return null;
  const iso = new Date(Date.UTC(Number(yyyy), monthIndex, Number(dd), hour + 6, Number(mm), 0));
  return Number.isNaN(iso.getTime()) ? null : iso.toISOString();
}

function extractMetricByLabel(html, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`<h4[^>]*class="[^"]*margin-bottom-0[^"]*">\\s*([^<]+)\\s*(?:<sup[^>]*>.*?<\\/sup>)?\\s*<\\/h4>\\s*<p[^>]*>\\s*${escaped}\\s*<\\/p>`, 'i'));
  return numberOrNull(match && match[1]);
}

function extractRatioMetricByLabel(html, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`<h4[^>]*class="[^"]*margin-bottom-0[^"]*">\\s*(\\d+)\\s*<sup[^>]*>\\s*\\/\\s*(\\d+)\\s*<\\/sup>\\s*<\\/h4>\\s*<p[^>]*>\\s*${escaped}\\s*<\\/p>`, 'i'));
  return match ? [numberOrNull(match[1]), numberOrNull(match[2])] : [null, null];
}

// ══════════════════════════════════════════════════════════════════════
//  MULTI-MODEL MOUNTAIN WEATHER (v4.3.0)
//  Open-Meteo evaluated AT RESORT ELEVATION (the old front-end used the 1.5 km
//  valley grid cell, which made summit forecasts ~7-10 C too warm) + 4 NWP models
//  (GEM/HRDPS, ECMWF IFS, GFS, ICON) + MET Norway. Consensus = median; spread
//  exposes disagreement honestly instead of hiding it.
// ══════════════════════════════════════════════════════════════════════
const WX_MODELS = ['gem_seamless', 'ecmwf_ifs025', 'gfs_seamless', 'icon_seamless'];
const WX_BASE_ALT = { louise: 1646, sunshine: 1660, nakiska: 1525, norquay: 1630, castle: 1400, fernie: 1070, kickhorse: 1190, panorama: 1150 };
const SKI_H0 = 9, SKI_H1 = 16;

function findResortById(id) {
  for (const city of Object.values(CITY_RESORTS)) {
    const r = city.resorts.find((x) => x.id === id);
    if (r) return r;
  }
  return null;
}
function median(a) {
  const v = a.filter((x) => x !== null && x !== undefined && !Number.isNaN(x)).sort((p, q) => p - q);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
const r1 = (x) => (x === null || x === undefined ? null : Math.round(x * 10) / 10);
function mean(a) { const v = a.filter((x) => x !== null && x !== undefined); return v.length ? v.reduce((p, q) => p + q, 0) / v.length : null; }
function maxOf(a) { const v = a.filter((x) => x !== null && x !== undefined); return v.length ? Math.max(...v) : null; }
function minOf(a) { const v = a.filter((x) => x !== null && x !== undefined); return v.length ? Math.min(...v) : null; }

function agreement(values, tight, loose) {
  const v = values.filter((x) => x !== null && x !== undefined);
  if (v.length < 2) return 'single';
  const spread = Math.max(...v) - Math.min(...v);
  return spread <= tight ? 'high' : spread <= loose ? 'medium' : 'low';
}

function summarizeDay(hourly, modelNames, date) {
  // hourly: { time:[], <var>_<model>:[] } ; returns per-model + consensus for a local date
  const idxAll = [], idxSki = [];
  hourly.time.forEach((t, i) => {
    if (t.slice(0, 10) !== date) return;
    idxAll.push(i);
    const h = Number(t.slice(11, 13));
    if (h >= SKI_H0 && h <= SKI_H1) idxSki.push(i);
  });
  const per = {};
  for (const m of modelNames) {
    const col = (v, idx) => idx.map((i) => (hourly[`${v}_${m}`] ? hourly[`${v}_${m}`][i] : null));
    const t = col('temperature_2m', idxSki);
    const idxAm = idxSki.filter((i) => Number(hourly.time[i].slice(11, 13)) <= 11);
    const idxPm = idxSki.filter((i) => Number(hourly.time[i].slice(11, 13)) >= 13);
    if (t.every((x) => x === null || x === undefined)) continue;
    per[m] = {
      tempAvg: r1(mean(t)), tempAm: r1(mean(col('temperature_2m', idxAm))), tempPm: r1(mean(col('temperature_2m', idxPm))),
      windAvg: r1(mean(col('wind_speed_10m', idxSki))), gustMax: r1(maxOf(col('wind_gusts_10m', idxSki))),
      snowDayCm: r1(col('snowfall', idxAll).reduce((p, q) => p + (q || 0), 0)),
      snowSkiCm: r1(col('snowfall', idxSki).reduce((p, q) => p + (q || 0), 0)),
      cloudAvg: r1(mean(col('cloud_cover', idxSki))),
      freezingLevelM: r1(mean(col('freezing_level_height', idxSki))),
    };
  }
  return per;
}

function consensus(per, extraMet) {
  const models = { ...per };
  if (extraMet) models.metno = extraMet;
  const pick = (k, src = models) => Object.values(src).map((x) => x[k]);
  const snowSrc = per; // MET Norway has no snowfall field in compact
  return {
    tempAvgC: r1(median(pick('tempAvg'))), tempAmC: r1(median(pick('tempAm'))), tempPmC: r1(median(pick('tempPm'))),
    windAvgKmh: r1(median(pick('windAvg'))), gustMaxKmh: r1(maxOf(pick('gustMax'))),
    snowDayCm: r1(median(pick('snowDayCm', snowSrc))), snowDayRangeCm: [r1(minOf(pick('snowDayCm', snowSrc))), r1(maxOf(pick('snowDayCm', snowSrc)))],
    cloudAvgPct: r1(median(pick('cloudAvg'))), freezingLevelM: r1(median(pick('freezingLevelM'))),
    agreement: {
      temp: agreement(pick('tempAvg'), 3, 6),
      wind: agreement(pick('windAvg'), 8, 18),
      snow: agreement(pick('snowDayCm', snowSrc), 2, 6),
    },
    perModel: models,
  };
}

async function fetchMetNo(lat, lon, alt) {
  try {
    const res = await fetch(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&altitude=${Math.round(alt)}`, {
      headers: { 'User-Agent': 'ski-dashboard-ca/4.3.1 (+https://dashboard.westech.com.hk)' },
    });
    if (!res.ok) return null;
    const j = await res.json();
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Edmonton', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' });
    const byDate = {};
    for (const e of j.properties.timeseries) {
      const p = Object.fromEntries(fmt.formatToParts(new Date(e.time)).map((x) => [x.type, x.value]));
      const date = `${p.year}-${p.month}-${p.day}`; const h = Number(p.hour);
      const d = e.data.instant.details; const pr = e.data.next_1_hours?.details?.precipitation_amount ?? null;
      (byDate[date] = byDate[date] || []).push({ h, t: d.air_temperature, w: d.wind_speed * 3.6, g: d.wind_speed_of_gust != null ? d.wind_speed_of_gust * 3.6 : null, c: d.cloud_area_fraction, pr });
    }
    const out = {};
    for (const [date, rows] of Object.entries(byDate)) {
      const ski = rows.filter((x) => x.h >= SKI_H0 && x.h <= SKI_H1);
      if (!ski.length) continue;
      out[date] = { tempAvg: r1(mean(ski.map((x) => x.t))), tempAm: r1(mean(ski.filter((x) => x.h <= 11).map((x) => x.t))), tempPm: r1(mean(ski.filter((x) => x.h >= 13).map((x) => x.t))),
        windAvg: r1(mean(ski.map((x) => x.w))), gustMax: r1(maxOf(ski.map((x) => x.g))), cloudAvg: r1(mean(ski.map((x) => x.c))),
        precipMm: r1(rows.reduce((p, q) => p + (q.pr || 0), 0)) };
    }
    return out;
  } catch (e) { return null; }
}

async function getMountainWeather(resortId) {
  const resort = findResortById(resortId);
  if (!resort) return null;
  const summit = resort.alt, base = WX_BASE_ALT[resortId] || Math.max(600, resort.alt - 800);
  const url = 'https://api.open-meteo.com/v1/forecast'
    + `?latitude=${resort.lat},${resort.lat}&longitude=${resort.lon},${resort.lon}&elevation=${summit},${base}`
    + '&hourly=temperature_2m,wind_speed_10m,wind_gusts_10m,snowfall,cloud_cover,freezing_level_height'
    + `&models=${WX_MODELS.join(',')}&timezone=America%2FEdmonton&forecast_days=4&wind_speed_unit=kmh`;
  const [omRes, met] = await Promise.all([
    fetch(url, { headers: { 'User-Agent': 'ski-dashboard-ca/4.3.1 (+https://dashboard.westech.com.hk)' } }),
    fetchMetNo(resort.lat, resort.lon, summit),
  ]);
  if (!omRes.ok) throw new Error(`Open-Meteo ${omRes.status}`);
  const arr = await omRes.json();
  const [sum, bas] = Array.isArray(arr) ? arr : [arr];
  const dates = [...new Set(sum.hourly.time.map((t) => t.slice(0, 10)))].slice(0, 3);
  const wd = ['日', '一', '二', '三', '四', '五', '六'];
  const days = dates.map((date) => {
    const perS = summarizeDay(sum.hourly, WX_MODELS, date);
    const perB = bas ? summarizeDay(bas.hourly, WX_MODELS, date) : {};
    return {
      date, weekday: '週' + wd[new Date(date + 'T12:00:00Z').getUTCDay()],
      skiHours: `${SKI_H0}:00–${SKI_H1}:00`,
      summit: consensus(perS, met && met[date] ? met[date] : null),
      base: consensus(perB, null),
    };
  });
  const used = Object.keys(days[0]?.summit?.perModel || {});
  return {
    resortId, name: resort.name, fetchedAt: new Date().toISOString(),
    elevations: { summitM: summit, baseM: base }, modelsUsed: used, metNorway: !!met,
    method: '指定山頂／山腳海拔的多模型預報（GEM/HRDPS、ECMWF、GFS、ICON + MET Norway），取中位數並標示分歧。',
    days,
  };
}

async function getNormalizedSnowReport(resort, fetchedAt) {
  const adapter = SNOW_REPORT_ADAPTERS[resort.id] || getUnavailableSnowReport;
  try {
    return await adapter(resort, fetchedAt);
  } catch (error) {
    const base = buildBaseSnowReport(resort, fetchedAt, {
      name: 'Adapter Error',
      type: 'internal',
      url: null,
      official: false,
    });
    base.status = 'error';
    base.notes.push(`Snow adapter failed: ${error.message}`);
    return base;
  }
}

async function getUnavailableSnowReport(resort, fetchedAt) {
  const report = buildBaseSnowReport(resort, fetchedAt, {
    name: 'No live official adapter',
    type: 'none',
    url: null,
    official: false,
  });
  report.notes.push('Phase 1 live snow adapter is not available for this resort yet.');
  return report;
}

// ─── text helpers (v4.3.0) ─────────────────────────────────────────────────
function htmlToText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&sol;/g, '/').replace(/&period;/g, '.').replace(/&comma;/g, ',')
    .replace(/&colon;/g, ':').replace(/&rsquo;/g, '’').replace(/&#038;/g, '&')
    .replace(/&deg;/g, '°').replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ').trim();
}

// Convert a wall-clock time in America/Edmonton to an ISO UTC string (DST-safe).
function edmontonIso(y, mo, d, h, mi) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  for (const off of [6, 7]) {
    const t = guess + off * 3600000;
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Edmonton', hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(t));
    const g = (k) => Number(parts.find((x) => x.type === k).value);
    if (g('year') === y && g('month') === mo && g('day') === d && g('hour') === h && g('minute') === mi) return new Date(t).toISOString();
  }
  return null;
}
const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
function parseEdmontonStamp(text) {
  // "October 31, 2026 | 10:31 am"  or  "October 31st, 2026 8:18 AM"
  const m = String(text || '').match(/([A-Z][a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\s*\|?\s*(?:at\s+)?(\d{1,2}):(\d{2})\s*([ap]m)/i);
  if (!m || !MONTHS[m[1].toLowerCase()]) return null;
  let h = Number(m[4]) % 12; if (/pm/i.test(m[6])) h += 12;
  return edmontonIso(Number(m[3]), MONTHS[m[1].toLowerCase()], Number(m[2]), h, Number(m[5]));
}

// Parse "<n> cm <n> in <Label>" triplets inside a text slice.
function parseSnowTriplets(slice) {
  const out = {};
  for (const m of String(slice).matchAll(/(\d+(?:\.\d+)?)\s*cm\s+[\d.]+\s*in\s+([A-Za-z0-9 ]+?)(?=\s+\d+(?:\.\d+)?\s*cm|\s+Mid Mountain|\s+Note:|$)/g)) {
    out[m[2].trim().toLowerCase()] = Number(m[1]);
  }
  return out;
}
// Sunshine layout: "<Label> <n> cm <n> in" (label BEFORE value, unlike Lake Louise)
function parseLabelFirstSnow(slice) {
  const out = {};
  for (const m of String(slice).matchAll(/(24\s*hr|24\s*hours?|7\s*days?|settled base|base|cumulative)\s+(\d+(?:\.\d+)?)\s*cm/gi)) {
    out[m[1].replace(/\s+/g, ' ').trim().toLowerCase()] = Number(m[2]);
  }
  return out;
}
function pickKey(o, ...keys) { for (const k of keys) if (o[k] !== undefined) return o[k]; return null; }

async function getSunshineSnowReport(resort, fetchedAt) {
  const source = { name: 'Sunshine Village official Current Conditions', type: 'html', url: 'https://www.skibanff.com/the-mountain/mountain-report/current-conditions', official: true };
  const report = buildBaseSnowReport(resort, fetchedAt, source);
  const text = htmlToText(await fetchText(source.url, { headers: BROWSER_HEADERS }));

  const upd = text.match(/Current Conditions Updated:\s*[A-Za-z]+,\s*([A-Za-z]+ \d{1,2}(?:st|nd|rd|th)?,\s*\d{4}\s+\d{1,2}:\d{2}\s*[AP]M)/i);
  report.updatedAt = upd ? parseEdmontonStamp(upd[1]) : null;

  const summary = text.match(/Summary\s+(.+?)\s+Upper Mountain Snow Report/i);
  if (summary) report.rawSummary = summary[1];

  const up = text.match(/Upper Mountain Snow Report\s+(.+?)\s+Mid Mountain Snow Report/i);
  const mid = text.match(/Mid Mountain Snow Report\s+(.+?)\s+Extended Forecast/i);
  if (!up) throw new Error('Upper Mountain Snow Report block not found (page layout changed?)');
  const U = parseLabelFirstSnow(up[1]);
  const M = mid ? parseLabelFirstSnow(mid[1]) : {};

  report.metrics.overnightCm = null; // Sunshine does not publish a separate overnight figure
  report.metrics.last24hCm = pickKey(U, '24hr', '24 hours', '24h');
  report.metrics.last7dCm = pickKey(U, '7 day', '7 days');
  report.metrics.baseCm = pickKey(U, 'base', 'settled base');
  report.metrics.seasonCm = pickKey(U, 'cumulative');
  report.extras = {
    upperMountain: { last24hCm: pickKey(U, '24hr', '24 hours'), last7dCm: pickKey(U, '7 day', '7 days'), baseCm: pickKey(U, 'base'), seasonCm: pickKey(U, 'cumulative') },
    midMountain: { last24hCm: pickKey(M, '24 hours', '24hr'), last7dCm: pickKey(M, '7 days', '7 day'), baseCm: pickKey(M, 'settled base', 'base'), seasonCm: pickKey(M, 'cumulative') },
  };

  // Official RWDI mountain forecast (freezing level, ridge wind) - resort-side numbers
  const fc = text.match(/Extended Forecast\s+Forecast updated:\s*(.+?)\s+Weather forecasting data provided by RWDI/i);
  if (fc) {
    const days = [];
    const re = /(Today|Tonight|Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\s+(-?\d+)\s*°C\s+\d+\s*°F\s+(High|Low)(?:\s+(-?\d+)\s*°C\s+\d+\s*°F\s+(High|Low))?\s+(.+?)\s+Freezing level:\s*(\d+)\s*m.*?Ridge wind\s+([A-Z]+)\s*:\s*(\d+)\s*km\/h\s+.*?Precipitation:\s*(\w+)/gi;
    for (const m of fc[1].matchAll(re)) {
      days.push({ day: m[1], temp1: Number(m[2]), kind1: m[3], temp2: m[4] != null ? Number(m[4]) : null, kind2: m[5] || null, desc: m[6].trim(), freezingLevelM: Number(m[7]), ridgeWindDir: m[8], ridgeWindKmh: Number(m[9]), precip: m[10] });
    }
    report.extras.officialForecast = { provider: 'RWDI (via skibanff.com)', updatedText: fc[1].split(/\s+Imperial/)[0], days };
  }

  const ok = [report.metrics.last24hCm, report.metrics.last7dCm, report.metrics.baseCm, report.metrics.seasonCm].some((v) => v !== null);
  report.status = ok ? 'live' : 'unavailable';
  report.notes.push(ok ? '數據來自 Sunshine 官方 Current Conditions 頁（上山雪量為主，中山另見 extras）。' : '頁面已載入但找不到雪量欄位。');
  return report;
}

async function getLakeLouiseSnowReport(resort, fetchedAt) {
  const source = { name: 'Lake Louise official conditions page', type: 'html', url: 'https://www.skilouise.com/snow-conditions/', official: true };
  const report = buildBaseSnowReport(resort, fetchedAt, source);
  const text = htmlToText(await fetchText(source.url, { headers: BROWSER_HEADERS }));

  const upBlock = text.match(/Upper Mountain Snowfall\s+(.+?)\s+Mid Mountain Snowfall/i);
  const midBlock = text.match(/Mid Mountain Snowfall\s+(.+?)\s+Note:/i);
  if (!upBlock) throw new Error('Upper Mountain Snowfall block not found (page layout changed?)');
  report.updatedAt = parseEdmontonStamp(upBlock[1]);
  const U = parseSnowTriplets(upBlock[1]);
  const M = midBlock ? parseSnowTriplets(midBlock[1]) : {};

  report.metrics.overnightCm = pickKey(U, 'overnight');
  report.metrics.last24hCm = pickKey(U, 'last 24 hours');
  report.metrics.last48hCm = pickKey(U, 'last 48 hours');
  report.metrics.last7dCm = pickKey(U, 'last 7 days');
  report.metrics.baseCm = pickKey(U, 'base');
  report.metrics.seasonCm = pickKey(U, 'this season');
  report.extras = {
    upperMountain: { overnightCm: pickKey(U, 'overnight'), last24hCm: pickKey(U, 'last 24 hours'), last48hCm: pickKey(U, 'last 48 hours'), last7dCm: pickKey(U, 'last 7 days'), baseCm: pickKey(U, 'base'), seasonCm: pickKey(U, 'this season') },
    midMountain: { overnightCm: pickKey(M, 'overnight'), last24hCm: pickKey(M, 'last 24 hours'), last48hCm: pickKey(M, 'last 48 hours'), last7dCm: pickKey(M, 'last 7 days'), baseCm: pickKey(M, 'base'), seasonCm: pickKey(M, 'this season') },
  };

  const lr = text.match(/(\d+)\s+Lifts Open\s+(\d+)\s+Runs Open\s+(\d+)\s+Groomed/i);
  if (lr) { report.metrics.liftsOpen = Number(lr[1]); report.metrics.runsOpen = Number(lr[2]); report.metrics.groomedRuns = Number(lr[3]); }
  const status = text.match(/LIFT \/ RUN STATUS\s+(.+?)\s+\d+\s+Lifts Open/i);
  const opening = text.match(/(We[’']re Opening [^.]*\.)/i);
  const hours = text.match(/(Winter lift hours are [^.]*\.)/i);
  const whatsOpen = text.match(/What[’']s Open on [A-Za-z]+\s+(First chair is at [^.]*\.\s*[^.]*Juniper[^.]*\.)/i) || text.match(/(First chair is at [^:]*:\s*Skiing and snowboarding:[^.]*\.)/i);
  const parts = [];
  if (opening) parts.push(opening[1].trim());
  if (whatsOpen) parts.push(whatsOpen[1].replace(/\s+/g, ' ').trim());
  if (hours) parts.push(hours[1].trim());
  if (status) parts.push(status[1].trim());
  report.rawSummary = parts.join(' ｜ ') || null;
  report.extras.openingNotice = parts.length ? parts : null;

  const ok = report.metrics.overnightCm !== null || report.metrics.last24hCm !== null || report.metrics.baseCm !== null;
  report.status = ok ? 'live' : 'unavailable';
  report.notes.push(ok ? '數據來自 Lake Louise 官方頁（上山 Upper Mountain 為主，中山另見 extras）。' : '頁面已載入但找不到雪量欄位。');
  return report;
}

async function getNorquaySnowReport(resort, fetchedAt) {
  // v4.3.1: Mt Norquay's website terms (banffnorquay.com/terms-conditions/ §12) prohibit scraping, so this
  // adapter no longer fetches anything. The card shows "unavailable" and links to the official page.
  const source = { name: 'Mt Norquay official conditions page', type: 'link', url: 'https://banffnorquay.com/conditions/', official: true };
  const report = buildBaseSnowReport(resort, fetchedAt, source);
  report.notes.push('Mt Norquay terms do not allow automated collection. Open the official page for current conditions.');
  return report;
}

async function getCastleSnowReport(resort, fetchedAt) {
  // v4.3.1: the old /snow-report-conditions-new/ page hid its values; /snowreport/ publishes them.
  const source = { name: 'Castle Mountain official snow report', type: 'html', url: 'https://www.skicastle.ca/snowreport/', official: true };
  const report = buildBaseSnowReport(resort, fetchedAt, source);
  const text = cleanHtmlText(await fetchText(source.url, { headers: BROWSER_HEADERS })) || '';
  const at = text.search(/Mid Mountain/i);
  const table = at >= 0 ? text.slice(at) : text;   // the detailed table: label first, then number
  const num = (re) => { const m = table.match(re); return m ? numberOrNull(m[1]) : null; };
  report.metrics.overnightCm = num(/Fresh Snow \(12 hrs\)\s+(\d+(?:\.\d+)?)/i);
  report.metrics.last24hCm = num(/Fresh Snow \(24 hrs\)\s+(\d+(?:\.\d+)?)/i);
  report.metrics.last48hCm = num(/Fresh Snow \(48 hrs\)\s+(\d+(?:\.\d+)?)/i);
  report.metrics.last7dCm = num(/Last 7 days\s+(\d+(?:\.\d+)?)/i);
  report.metrics.seasonCm = num(/Total Snowfall this season\s+(\d+(?:\.\d+)?)/i);
  report.metrics.baseCm = num(/Snow Base\s+(\d+(?:\.\d+)?)/i);
  const lifts = text.match(/(\d+) of (\d+) lifts open/i);
  if (lifts) { report.metrics.liftsOpen = Number(lifts[1]); report.metrics.liftsTotal = Number(lifts[2]); }
  const runs = text.match(/(\d+) of (\d+) Trails open/i);
  if (runs) { report.metrics.runsOpen = Number(runs[1]); report.metrics.runsTotal = Number(runs[2]); }
  const u = text.match(/Last updated:\s*(\d{4})-(\d{2})-(\d{2})\s*-\s*(\d{2}):(\d{2})\s*MT/i);
  if (u) report.updatedAt = edmontonIso(+u[1], +u[2], +u[3], +u[4], +u[5]);
  report.status = (report.metrics.baseCm !== null || report.metrics.last24hCm !== null) ? 'live' : 'unavailable';
  if (report.status !== 'live') report.notes.push('Official Castle page loaded, but expected snow metrics were not detected.');
  return report;
}

async function getRcrSnowReport(resort, fetchedAt) {
  const baseUrl = `https://www.${resort.website}/wp-content/themes/kallyas-child/reportData`;
  const source = { name: `${resort.name} official RCR reportData`, type: 'json', url: `${baseUrl}/snowReport.json`, official: true };
  const report = buildBaseSnowReport(resort, fetchedAt, source);
  const [snow, lifts] = await Promise.all([
    fetchJson(`${baseUrl}/snowReport.json`),
    fetchJson(`${baseUrl}/liftReport.json`),
  ]);

  report.updatedAt = parseLegacySaveDate(lifts?.saveDate) || parseLegacySaveDate(snow?.saveDate);
  report.metrics.overnightCm = numberOrNull(snow?.newSnowOvernight);
  report.metrics.last24hCm = numberOrNull(snow?.newSnow24);
  report.metrics.last48hCm = numberOrNull(snow?.newSnow48);
  report.metrics.last7dCm = numberOrNull(snow?.newSnow7days);
  report.metrics.baseCm = numberOrNull(snow?.snowPack);
  report.metrics.seasonCm = numberOrNull(snow?.newSnowYTD);
  report.metrics.runsOpen = numberOrNull(snow?.runsOpen);
  report.metrics.groomedRuns = numberOrNull(snow?.runsGroomed);

  const liftStatuses = Object.entries(lifts || {})
    .filter(([key]) => /^liftStatus/i.test(key))
    .map(([, value]) => maybeDecode(value));
  if (liftStatuses.length) {
    report.metrics.liftsTotal = liftStatuses.length;
    report.metrics.liftsOpen = liftStatuses.filter((value) => /open/i.test(value || '')).length;
  } else {
    report.metrics.liftsOpen = numberOrNull(snow?.liftsOperating);
  }

  report.rawSummary = [
    maybeDecode(snow?.lowerMntWeatherConditions) ? `下山天氣 ${maybeDecode(snow.lowerMntWeatherConditions)}` : null,
    maybeDecode(snow?.upperMntWeatherConditions) ? `上山天氣 ${maybeDecode(snow.upperMntWeatherConditions)}` : null,
    maybeDecode(snow?.lowerMtnConditions) ? `下山雪況 ${maybeDecode(snow.lowerMtnConditions)}` : null,
    maybeDecode(snow?.upperMtnConditions) ? `上山雪況 ${maybeDecode(snow.upperMtnConditions)}` : null,
  ].filter(Boolean).join('｜') || null;

  report.status = (report.metrics.baseCm !== null || report.metrics.last24hCm !== null || report.metrics.liftsOpen !== null) ? 'live' : 'unavailable';
  report.notes.push('Official RCR reportData JSON used for snow totals, lift status, run counts, and freshness timestamp.');
  return report;
}

async function getPanoramaSnowReport(resort, fetchedAt) {
  const source = { name: 'Panorama Today official HTML', type: 'html', url: 'https://www.panoramaresort.com/panorama-today', official: true };
  const report = buildBaseSnowReport(resort, fetchedAt, source);
  const [todayHtml, dailyHtml] = await Promise.all([
    fetchText(source.url),
    fetchText('https://www.panoramaresort.com/panorama-today/daily-snow-report'),
  ]);

  const currentTime = todayHtml.match(/<h5 class="brand-subheader blue-text margin-bottom-0">Current Weather<\/h5>\s*<p class="small light-text">([^<]+)<\/p>/i);
  report.updatedAt = parsePanoramaCurrentTime(currentTime && currentTime[1]);
  report.metrics.overnightCm = extractMetricByLabel(dailyHtml, 'Overnight');
  report.metrics.last24hCm = extractMetricByLabel(dailyHtml, '24 Hours');
  report.metrics.last48hCm = extractMetricByLabel(dailyHtml, '48 Hours');
  report.metrics.last7dCm = extractMetricByLabel(dailyHtml, '7 Days');
  report.metrics.seasonCm = extractMetricByLabel(dailyHtml, 'Season');
  [report.metrics.runsOpen, report.metrics.runsTotal] = extractRatioMetricByLabel(todayHtml, 'Trails Open');
  [report.metrics.liftsOpen, report.metrics.liftsTotal] = extractRatioMetricByLabel(todayHtml, 'Lifts Open');
  report.metrics.groomedRuns = extractMetricByLabel(todayHtml, 'Groomed Runs');

  const weatherRows = [...todayHtml.matchAll(/summary-current__location[\s\S]{0,260}?<h4>(.*?)<sup[\s\S]{0,120}?<div class="temp">[\s\S]{0,80}?(-?\d+)°/gi)]
    .map((m) => `${cleanHtmlText(m[1])} ${m[2]}°C`)
    .filter(Boolean);
  report.rawSummary = weatherRows.length ? `Panorama Today：${weatherRows.join('｜')}` : 'Panorama Today lifts / trails / weather block parsed from official HTML.';

  report.status = (report.metrics.last24hCm !== null || report.metrics.liftsOpen !== null || report.metrics.runsOpen !== null) ? 'live' : 'unavailable';
  report.notes.push('Official Panorama Today HTML parsed for timestamp, lifts, trails, groomed runs, and current weather; daily snow report HTML parsed for snowfall totals.');
  return report;
}

const SNOW_REPORT_ADAPTERS = {
  louise: getLakeLouiseSnowReport,
  sunshine: getSunshineSnowReport,
  nakiska: getRcrSnowReport,
  norquay: getNorquaySnowReport,
  castle: getCastleSnowReport,
  fernie: getRcrSnowReport,
  kickhorse: getRcrSnowReport,
  panorama: getPanoramaSnowReport,
};

// ══════════════════════════════════════════════════════════════════════
//  SNOW CHECK & NOTIFY
// ══════════════════════════════════════════════════════════════════════
async function checkSnowAndNotify(env) {
  const KV = env.SKI_DATA;
  const keys = await KV.list({ prefix: 'push:' });
  if (keys.keys.length === 0) return { skipped: 'no subscribers' };

  // Build deduplicated resort list from all cities
  const allResorts = Object.values(CITY_RESORTS).flatMap(c => c.resorts);
  const seenIds = new Set();
  const uniqueResorts = allResorts.filter(r => { if (seenIds.has(r.id)) return false; seenIds.add(r.id); return true; });

  const results = [];
  for (const resort of uniqueResorts) {
    try {
      const data = await fetchWeather(resort);
      if (!data) continue;
      const alerts = checkAlerts(resort, data, ALERTS);
      for (const alert of alerts) {
        // Check if we already sent this alert recently (deduplicate with 3h TTL)
        const dedupeKey = `sent:${resort.id}:${alert.key}`;
        const alreadySent = await KV.get(dedupeKey);
        if (alreadySent) continue;

        // Send to all subscribers
        const payload = {
          title: `${resort.emoji} ${resort.name} ${alert.title}`,
          body: alert.body,
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          tag: `ski-${resort.id}-${alert.key}`,
          resort: resort.name,
          url: '/',
        };
        const sent = await sendToAll(env, KV, payload);
        results.push({ resort: resort.name, alert: alert.key, sent });

        // Mark as sent for 3 hours
        await KV.put(dedupeKey, '1', { expirationTtl: 10800 });
      }
    } catch (e) {
      results.push({ resort: resort.name, error: e.message });
    }
  }

  await KV.put('meta:lastCheck', new Date().toISOString());
  return results;
}

async function fetchWeather(resort) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${resort.lat}&longitude=${resort.lon}&hourly=snowfall,windspeed_10m,temperature_2m&current_weather=true&timezone=America%2FDenver&forecast_days=1`;
  const r = await fetch(url);
  if (!r.ok) return null;
  const d = await r.json();
  const cw = d.current_weather || {};
  // Get current hour's snowfall
  const nowHour = new Date().getUTCHours();
  const snowfall = d.hourly?.snowfall?.[nowHour] || 0;
  return {
    temp: cw.temperature,
    wind: cw.windspeed,
    snowfall_cm: snowfall * 10, // mm to cm approx
  };
}

function checkAlerts(resort, data, ALERTS) {
  const triggered = [];
  const { temp, wind, snowfall_cm } = data;

  if (ALERTS.EPIC_POWDER.enabled && snowfall_cm >= ALERTS.EPIC_POWDER.cm) {
    triggered.push({ key: 'snow_epic', title: '🎿 史詩粉雪！', body: `新雪 ${snowfall_cm.toFixed(1)} cm，出發！` });
  } else if (ALERTS.POWDER_ALERT.enabled && snowfall_cm >= ALERTS.POWDER_ALERT.cm) {
    triggered.push({ key: 'snow_powder', title: '❄️ 粉雪警報', body: `新雪 ${snowfall_cm.toFixed(1)} cm` });
  }
  if (ALERTS.EXTREME_COLD.enabled && temp <= ALERTS.EXTREME_COLD.tempC) {
    triggered.push({ key: 'cold_extreme', title: '🥶 極寒警告', body: `氣溫 ${temp}°C，注意保暖！` });
  } else if (ALERTS.COLD_WARNING.enabled && temp <= ALERTS.COLD_WARNING.tempC) {
    triggered.push({ key: 'cold_warn', title: '🌡️ 低溫提示', body: `氣溫 ${temp}°C` });
  }
  if (ALERTS.WIND_EXTREME.enabled && wind >= ALERTS.WIND_EXTREME.kmh) {
    triggered.push({ key: 'wind_extreme', title: '💨 極強風', body: `風速 ${wind} km/h，纜車可能暫停` });
  } else if (ALERTS.WIND_HIGH.enabled && wind >= ALERTS.WIND_HIGH.kmh) {
    triggered.push({ key: 'wind_high', title: '💨 強風警告', body: `風速 ${wind} km/h` });
  }
  return triggered;
}

// ══════════════════════════════════════════════════════════════════════
//  SEND TO ALL SUBSCRIBERS
// ══════════════════════════════════════════════════════════════════════
async function sendToAll(env, KV, payload) {
  const keys = await KV.list({ prefix: 'push:' });
  let sent = 0, failed = 0;
  const results = [];

  for (const k of keys.keys) {
    const raw = await KV.get(k.name);
    if (!raw) continue;
    const sub = JSON.parse(raw);
    try {
      const { status, body } = await sendWebPush(env, sub, payload);
      if (status >= 200 && status < 300) {
        sent++;
        results.push({ ok: true, ep: sub.endpoint?.slice(-16) });
      } else if (status === 410 || status === 404) {
        // Subscription expired — clean up
        await KV.delete(k.name);
        failed++;
        results.push({ ok: false, ep: sub.endpoint?.slice(-16), err: `${status} expired, removed` });
      } else {
        failed++;
        results.push({ ok: false, ep: sub.endpoint?.slice(-16), err: `${status} ${body}` });
      }
    } catch (e) {
      failed++;
      results.push({ ok: false, ep: k.name, err: e.message });
    }
  }

  return { sent, failed, total: sent + failed, results };
}

// ══════════════════════════════════════════════════════════════════════
//  WEB PUSH HELPERS  (ported from UmiCare _worker.js — proven working)
// ══════════════════════════════════════════════════════════════════════
function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
function fromB64url(s) {
  const p = s.replace(/-/g, '+').replace(/_/g, '/');
  const b = atob(p + '='.repeat((4 - p.length % 4) % 4));
  return Uint8Array.from(b, c => c.charCodeAt(0));
}
function concat(...bufs) {
  const total = bufs.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const b of bufs) { out.set(b, off); off += b.length; }
  return out;
}
async function hkdf(salt, ikm, info, len) {
  const saltKey = await crypto.subtle.importKey('raw', salt, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const prk = new Uint8Array(await crypto.subtle.sign('HMAC', saltKey, ikm));
  const infoBytes = typeof info === 'string' ? new TextEncoder().encode(info) : info;
  const hmacKey = await crypto.subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const t = new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, concat(infoBytes, new Uint8Array([1]))));
  return t.slice(0, len);
}

async function sendWebPush(env, subscription, payload) {
  const VAPID_PUBLIC  = VAPID_PUBLIC_KEY;
  const VAPID_PRIVATE = (env && env.VAPID_PRIVATE_KEY);
  const subject       = ((env && env.VAPID_SUBJECT) || 'mailto:west.wong@westech.com.hk').trim();

  const endpoint = subscription.endpoint;
  const p256dh   = subscription.keys.p256dh;
  const auth     = subscription.keys.auth;

  // ── 1. VAPID JWT ─────────────────────────────────────────────────────
  const audience = new URL(endpoint).origin;
  const now = Math.floor(Date.now() / 1000);
  const enc = s => btoa(JSON.stringify(s)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  const jwtHeader = enc({ typ: 'JWT', alg: 'ES256' });
  const jwtClaims = enc({ aud: audience, exp: now + 43200, sub: subject });
  const sigInput  = jwtHeader + '.' + jwtClaims;

  const privKey = await crypto.subtle.importKey('jwk', {
    kty: 'EC', crv: 'P-256',
    d: VAPID_PRIVATE,
    x: VAPID_KEY_X,
    y: VAPID_KEY_Y,
  }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);

  const sigBytes = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privKey,
    new TextEncoder().encode(sigInput)
  );
  const jwt = sigInput + '.' + b64url(sigBytes);
  const vapidHeader = `vapid t=${jwt},k=${VAPID_PUBLIC}`;

  // ── 2. Payload encryption (RFC 8291 / RFC 8188 aes128gcm) ────────────
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const senderKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']
  );
  const senderPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', senderKeyPair.publicKey));

  const uaPubRaw = fromB64url(p256dh);
  const uaPubKey = await crypto.subtle.importKey('raw', uaPubRaw,
    { name: 'ECDH', namedCurve: 'P-256' }, false, []);

  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: uaPubKey }, senderKeyPair.privateKey, 256
  );
  const sharedSecret = new Uint8Array(sharedBits);
  const authSecret   = fromB64url(auth);

  const ikmInfo = concat(
    new TextEncoder().encode('WebPush: info\x00'),
    uaPubRaw,
    senderPubRaw
  );
  const ikm = await hkdf(authSecret, sharedSecret, ikmInfo, 32);

  const cek   = await hkdf(salt, ikm, new TextEncoder().encode('Content-Encoding: aes128gcm\x00'), 16);
  const nonce = await hkdf(salt, ikm, new TextEncoder().encode('Content-Encoding: nonce\x00'), 12);

  const plaintext = concat(new TextEncoder().encode(JSON.stringify(payload)), new Uint8Array([0x02]));
  const aesKey    = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce }, aesKey, plaintext
  ));

  const rs = 4096;
  const header8188 = new Uint8Array(21 + senderPubRaw.length);
  header8188.set(salt, 0);
  new DataView(header8188.buffer).setUint32(16, rs, false);
  header8188[20] = senderPubRaw.length;
  header8188.set(senderPubRaw, 21);

  const bodyBuf = concat(header8188, ciphertext);

  // ── 3. Send ───────────────────────────────────────────────────────────
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': vapidHeader,
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'TTL': '86400',
    },
    body: bodyBuf,
  });
  const respBody = await resp.text().catch(() => '');
  return { status: resp.status, body: respBody };
}
