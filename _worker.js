// ══════════════════════════════════════════════════════════════════════
//  Ski Dashboard — v4.2.1 (_worker.js)
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

// ─── City → Resort Config (v4.2.1) ─────────────────────────────────────────────
// 5 cities, 8 resorts each, sorted by fame/priority, all within 500 km radius
const CITY_RESORTS = {
  calgary: {
    name: 'Calgary',
    nameZh: '卡加利',
    center: { lat: 51.0447, lon: -114.0719 },
    resorts: [
      { id: 'louise',    name: 'Lake Louise',         emoji: '🏔️', lat: 51.4254, lon: -116.1773, alt: 2637, dist: 153 },
      { id: 'sunshine',  name: 'Sunshine Village',    emoji: '☀️', lat: 51.0630, lon: -115.7729, alt: 2730, dist: 118 },
      { id: 'nakiska',   name: 'Nakiska',             emoji: '🎿', lat: 50.9406, lon: -115.1531, alt: 2258, dist:  77 },
      { id: 'norquay',   name: 'Mt Norquay',          emoji: '⛷️', lat: 51.2035, lon: -115.5622, alt: 2133, dist: 106 },
      { id: 'castle',    name: 'Castle Mountain',     emoji: '🏰', lat: 49.4665, lon: -114.4073, alt: 2275, dist: 194 },
      { id: 'fernie',    name: 'Fernie Alpine Resort',emoji: '🦅', lat: 49.4577, lon: -115.0881, alt: 2068, dist: 189 },
      { id: 'kickhorse', name: 'Kicking Horse',       emoji: '🐴', lat: 51.3000, lon: -117.0522, alt: 2450, dist: 205 },
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
      { id: 'kickhorse', name: 'Kicking Horse',       emoji: '🐴', lat: 51.3000, lon: -117.0522, alt: 2450, dist: 344 },
      { id: 'nakiska',   name: 'Nakiska',             emoji: '🎿', lat: 50.9406, lon: -115.1531, alt: 2258, dist: 311 },
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
      body: '推送系統正常運作！ v4.2.1 ✅',
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

  // GET /api/snow?city=calgary — live snow reports with normalized model (v4.2.1)
  if (path === '/snow' && method === 'GET') {
    const cityKey = url.searchParams.get('city') || DEFAULT_CITY;
    const cityData = CITY_RESORTS[cityKey];
    if (!cityData) return json({ error: `Unknown city: ${cityKey}`, known: Object.keys(CITY_RESORTS) }, 400);

    const cacheKey = `snow:${cityKey}:v1`;
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

  // GET /api/stats — subscriber count + last check
  if (path === '/stats' && method === 'GET') {
    const keys = await KV.list({ prefix: 'push:' });
    const lastCheck = await KV.get('meta:lastCheck');
    return json({
      version: 'v4.2.1',
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
    return json({ version: 'v4.2.1', count: subs.length, subs: subs.filter(Boolean) });
  }

  return json({ version: 'v4.2.1', error: 'Not found' }, 404);
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

async function fetchText(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      'User-Agent': 'ski-dashboard-ca/4.2.0 (+https://dashboard.westech.com.hk)',
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
      'User-Agent': 'ski-dashboard-ca/4.2.0 (+https://dashboard.westech.com.hk)',
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

async function getSunshineSnowReport(resort, fetchedAt) {
  const source = { name: 'Sunshine Village official API', type: 'json', url: 'https://www.skibanff.com/wp-json/sunshine/v1/snow-reports', official: true };
  const report = buildBaseSnowReport(resort, fetchedAt, source);
  const [snow, lifts] = await Promise.all([
    fetchJson('https://www.skibanff.com/wp-json/sunshine/v1/snow-reports'),
    fetchJson('https://www.skibanff.com/wp-json/sunshine/v1/lifts'),
  ]);
  report.status = 'live';
  report.updatedAt = isoOrNull(snow.timestamp?.replace(' ', 'T') + '-06:00') || isoOrNull(snow.updatedText);
  report.metrics.overnightCm = numberOrNull(snow.overnight?.metric);
  report.metrics.last24hCm = numberOrNull(snow.past24Hours?.metric);
  report.metrics.last48hCm = null;
  report.metrics.last7dCm = numberOrNull(snow.historical?.metric || snow.paris_xdays?.metric);
  report.metrics.baseCm = numberOrNull(snow.settledBase?.metric || snow.paris_base?.metric);
  report.metrics.seasonCm = numberOrNull(snow.seasonTotal?.metric || snow.paris_snowfall?.metric);
  report.metrics.liftsOpen = numberOrNull(lifts?.lifts?.open);
  report.metrics.liftsTotal = numberOrNull(lifts?.lifts?.max);
  report.metrics.runsOpen = numberOrNull(lifts?.runs?.open);
  report.metrics.runsTotal = numberOrNull(lifts?.runs?.max);
  report.metrics.groomedRuns = null;
  report.rawSummary = cleanHtmlText(snow.summary);
  report.notes.push('Official JSON endpoint used for snow totals and lift/run status.');
  return report;
}

async function getLakeLouiseSnowReport(resort, fetchedAt) {
  const source = { name: 'Lake Louise official conditions page', type: 'html', url: 'https://www.skilouise.com/snow-conditions/', official: true };
  const report = buildBaseSnowReport(resort, fetchedAt, source);
  const html = await fetchText(source.url);
  const metaDate = html.match(/article:modified_time" content="([^"]+)"/i);
  report.updatedAt = isoOrNull(metaDate && metaDate[1]);

  const sectionMatch = html.match(/obj-condition-body[\s\S]{0,2000}?<h4 class="obj-title[^>]*>([\s\S]*?)<\/p>/i);
  if (sectionMatch) report.rawSummary = cleanHtmlText(sectionMatch[1]);

  const pairs = [...html.matchAll(/<div class="obj-condition-item[\s\S]*?<strong[^>]*>([^<]+)<\/strong><small[^>]*>(cm|m|in)<\/small>[\s\S]*?<span class="obj-text d-block">\s*([^<]+?)\s*<\/span>/gi)]
    .map((m) => ({ value: numberOrNull(m[1]), label: cleanHtmlText(m[3]) }));
  for (const pair of pairs) {
    const label = (pair.label || '').toLowerCase();
    if (label.includes('overnight')) report.metrics.overnightCm = pair.value;
    else if (label.includes('24')) report.metrics.last24hCm = pair.value;
    else if (label.includes('48')) report.metrics.last48hCm = pair.value;
    else if (label.includes('7 day')) report.metrics.last7dCm = pair.value;
    else if (label.includes('snow base')) report.metrics.baseCm = pair.value;
    else if (label.includes('season')) report.metrics.seasonCm = pair.value;
  }

  const textSummary = cleanHtmlText(html);
  const liftsMatch = textSummary && textSummary.match(/All\s+(\d+)\s+lifts\s+are\s+spinning/i);
  const runsMatch = textSummary && textSummary.match(/(\d+)\s+open\s+runs/i);
  if (liftsMatch) {
    report.metrics.liftsOpen = Number(liftsMatch[1]);
    report.metrics.liftsTotal = Number(liftsMatch[1]);
  }
  if (runsMatch) report.metrics.runsOpen = Number(runsMatch[1]);
  report.status = (report.metrics.overnightCm !== null || report.metrics.last24hCm !== null || report.metrics.baseCm !== null) ? 'live' : 'unavailable';
  if (report.status !== 'live') report.notes.push('Official Lake Louise page loaded, but expected condition metrics were not detected.');
  else report.notes.push('Parsed from official Lake Louise conditions page HTML.');
  return report;
}

async function getNorquaySnowReport(resort, fetchedAt) {
  const source = { name: 'Mt Norquay official conditions page', type: 'html', url: 'https://banffnorquay.com/winter/conditions/', official: true };
  const report = buildBaseSnowReport(resort, fetchedAt, source);
  const html = await fetchText(source.url);
  const updatedMatch = html.match(/Conditions update for ([^.]+\.)/i);
  report.updatedAt = isoOrNull(updatedMatch ? updatedMatch[1].replace(/\.$/, '') : null);
  const summaryMatch = html.match(/<h3><b>Daily Update<\/b><\/h3>[\s\S]*?<p[^>]*><b>Conditions update for[\s\S]*?<\/p>([\s\S]*?)<\/div>/i);
  if (summaryMatch) report.rawSummary = cleanHtmlText(summaryMatch[1]);

  const snowValues = [...html.matchAll(/<p class="snow-height">([^<]+)<\/p>\s*<p class="snow-details">([^<]+)<\/p>/gi)].map((m) => ({ value: numberOrNull(m[1]), label: cleanHtmlText(m[2]) }));
  for (const pair of snowValues) {
    const label = (pair.label || '').toLowerCase();
    if (label.includes('overnight')) report.metrics.overnightCm = pair.value;
    else if (label.includes('24')) report.metrics.last24hCm = pair.value;
    else if (label.includes('7')) report.metrics.last7dCm = pair.value;
    else if (label.includes('lower mountain')) report.metrics.baseCm = pair.value;
    else if (label.includes('year to date')) report.metrics.seasonCm = pair.value;
  }
  const text = cleanHtmlText(html) || '';
  if (/all lifts are running/i.test(text)) {
    report.metrics.liftsOpen = 6;
    report.metrics.liftsTotal = 6;
    report.notes.push('Lift count inferred from current Mt Norquay winter lift network when official copy says all lifts are running.');
  }
  if (/groomed runs are in excellent shape/i.test(text)) {
    report.notes.push('Official update indicates groomed runs are in excellent shape, but no groomed-run count is published on page.');
  }
  report.status = (report.metrics.overnightCm !== null || report.metrics.baseCm !== null) ? 'live' : 'unavailable';
  if (report.status !== 'live') report.notes.push('Official Mt Norquay page loaded, but expected snow metrics were not detected.');
  return report;
}

async function getCastleSnowReport(resort, fetchedAt) {
  const source = { name: 'Castle Mountain official conditions page', type: 'html', url: 'https://www.skicastle.ca/snow-report-conditions-new/', official: true };
  const report = buildBaseSnowReport(resort, fetchedAt, source);
  const html = await fetchText(source.url);
  const text = cleanHtmlText(html) || '';
  const updated = text.match(/Last updated:\s*([^|]+?)\s+MT/i);
  report.updatedAt = isoOrNull(updated && updated[1] && !updated[1].includes('-') ? updated[1] : null);
  report.rawSummary = 'Official Castle Mountain conditions page is reachable, but current snow/lift details are withheld behind a password-protected block and exposed values are blank.';
  report.notes.push('Official source exists, but published values are blank / password-gated at fetch time. Returning unavailable rather than inventing data.');
  return report;
}

const SNOW_REPORT_ADAPTERS = {
  louise: getLakeLouiseSnowReport,
  sunshine: getSunshineSnowReport,
  norquay: getNorquaySnowReport,
  castle: getCastleSnowReport,
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
