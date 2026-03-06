// ══════════════════════════════════════════════════════════════════════
//  Ski Dashboard — Version 2  (_worker.js)
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
const VAPID_PUBLIC_KEY = 'BPlXPfKewlablRFBzorXCvjst2chjXrZ7WkxuNXjx_jya0CMZPskAivdrG1cXOr9-o5pPpn6TQFDLOJkYJp95EU';
// X/Y coordinates of the public key (needed for JWK private key import)
const VAPID_KEY_X = '-Vc98p7CVpuVEUHOitcK-Oy3ZyGNetntaTG41ePH-PI';
const VAPID_KEY_Y = 'a0CMZPskAivdrG1cXOr9-o5pPpn6TQFDLOJkYJp95EU';
// Private key 'd' value — set as Cloudflare secret: VAPID_PRIVATE_KEY
// Fallback for dev/testing only (remove in production)
const VAPID_PRIVATE_FALLBACK = 'ulsPZAXPlmPjuX3BIoOFMIaALD9Z4lYB7A5-IMhT2OY';

// ─── Resort Config ────────────────────────────────────────────────────────────
const RESORTS = [
  { id: 'nakiska',  name: 'Nakiska',         emoji: '🏔️', lat: 50.9406, lon: -115.1531, alt: 2258, page: 0 },
  { id: 'sunshine', name: 'Sunshine Village', emoji: '☀️', lat: 51.0630, lon: -115.7729, alt: 2730, page: 1 },
  { id: 'louise',   name: 'Lake Louise',      emoji: '🏔️', lat: 51.4254, lon: -116.1773, alt: 2637, page: 2 },
  { id: 'norquay',  name: 'Norquay',          emoji: '⛷️', lat: 51.2035, lon: -115.5622, alt: 2133, page: 3 },
];

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
      body: '推送系統正常運作！ v2.0 ✅',
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

  // GET /api/stats — subscriber count + last check
  if (path === '/stats' && method === 'GET') {
    const keys = await KV.list({ prefix: 'push:' });
    const lastCheck = await KV.get('meta:lastCheck');
    return json({
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
    return json({ count: subs.length, subs: subs.filter(Boolean) });
  }

  return json({ error: 'Not found' }, 404);
}

// ══════════════════════════════════════════════════════════════════════
//  SNOW CHECK & NOTIFY
// ══════════════════════════════════════════════════════════════════════
async function checkSnowAndNotify(env) {
  const KV = env.SKI_DATA;
  const keys = await KV.list({ prefix: 'push:' });
  if (keys.keys.length === 0) return { skipped: 'no subscribers' };

  const results = [];
  for (const resort of RESORTS) {
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
          url: `/?page=${resort.page}`,
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
  const VAPID_PRIVATE = (env && env.VAPID_PRIVATE_KEY) || VAPID_PRIVATE_FALLBACK;
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
