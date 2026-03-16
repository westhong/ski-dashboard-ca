// ══════════════════════════════════════════════════════════════════════
//  Ski Dashboard — Cloudflare Worker v4.1.0
//  Push Notification Backend  (v4.1.0 unified)
//
//  Required KV binding:   SUBSCRIPTIONS  → namespace: SKI_SUBS
//  Optional env var:      VAPID_SUBJECT  (default: mailto:admin@westech.com.hk)
//
//  VAPID keys are now hardcoded in the worker (safer, no env-var mis-match)
//
//  Routes:
//    GET  /api/vapid-public-key   return public key for frontend
//    POST /api/subscribe          save push subscription
//    POST /api/unsubscribe        remove push subscription
//    GET  /api/check-snow         manual trigger
//    GET  /api/test-push          send test push to all subscribers
//    GET  /api/stats              subscriber count + last check
//    GET  /api/debug-jwt          show generated JWT (for diagnosis)
//    GET  /api/key-check          verify VAPID key import works
//    GET  /api/clear-subs         delete ALL subscriptions (reset)
//
//  Cron: */30 * * * *  (every 30 min)
// ══════════════════════════════════════════════════════════════════════

// ─── VAPID Key Material (P-256, hardcoded for reliability) ───────────────────
const VAPID_PUBLIC_KEY  = 'BOFt84jfiRV3tgCupl8Bhy47IyfbEaFlMprja18X6G9GmihJi_QapcWSgsKHSarYl3UIy4ElB6t9fDxmqEJM83w';
const VAPID_PRIVATE_JWK = {
  kty: 'EC', crv: 'P-256',
  d: '0prnHx1EljFOb4oPLlppsTtAJhbWbXJSzaJWErqDNPQ',
  x: '4W3ziN-JFXe2AK6mXwGHLjsjJ9sRoWUymuNrXxfob0Y',
  y: 'mihJi_QapcWSgsKHSarYl3UIy4ElB6t9fDxmqEJM83w',
};

// ─── Resort Config ───────────────────────────────────────────────────────────
const RESORTS = [
  { id: 'nakiska',  name: 'Nakiska',         emoji: '🏔️', lat: 50.9406, lon: -115.1531, alt: 2258, page: 0 },
  { id: 'sunshine', name: 'Sunshine Village', emoji: '☀️', lat: 51.0630, lon: -115.7729, alt: 2730, page: 1 },
  { id: 'louise',   name: 'Lake Louise',      emoji: '🏔️', lat: 51.4254, lon: -116.1773, alt: 2637, page: 2 },
  { id: 'norquay',  name: 'Norquay',          emoji: '⛷️', lat: 51.2035, lon: -115.5622, alt: 2133, page: 3 },
];

// ─── Alert Thresholds ────────────────────────────────────────────────────────
const ALERTS = {
  POWDER_ALERT:    { key: 'snow_powder',    cm: 10,  enabled: true },
  EPIC_POWDER:     { key: 'snow_epic',      cm: 20,  enabled: true },
  COLD_WARNING:    { key: 'cold_warn',    tempC: -25, enabled: true },
  EXTREME_COLD:    { key: 'cold_extreme', tempC: -32, enabled: true },
  WIND_HIGH:       { key: 'wind_high',   kmh: 60,   enabled: true },
  WIND_EXTREME:    { key: 'wind_extreme',kmh: 90,   enabled: true },
  BLIZZARD:        { key: 'blizzard',    snowCm: 5, windKmh: 50, enabled: true },
  PERFECT_SKI_DAY: { key: 'perfect',     enabled: true },
  STORM_INCOMING:  { key: 'storm_forecast', totalCm: 25, enabled: true },
};

const DEDUP_TTL = { snow:72000, cold:43200, wind:21600, blizzard:21600, perfect:86400, storm:86400 };

// ─── Main Fetch Handler ───────────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    const url  = new URL(request.url);
    const path = url.pathname;
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    const json = (data, status=200) =>
      new Response(JSON.stringify(data, null, 2), {
        status, headers: { ...cors, 'Content-Type': 'application/json' }
      });

    try {
      if (path === '/api/vapid-public-key' && request.method === 'GET')
        return json({ publicKey: VAPID_PUBLIC_KEY });

      if (path === '/api/subscribe' && request.method === 'POST') {
        const sub = await request.json();
        if (!sub.endpoint) return json({ error: 'missing endpoint' }, 400);
        const key = 'sub_' + await hashStr(sub.endpoint);
        await env.SUBSCRIPTIONS.put(key, JSON.stringify(sub), { expirationTtl: 60*60*24*90 });
        console.log('[Worker] Subscribed:', key, sub.endpoint.slice(-20));
        return json({ ok: true, message: '訂閱成功' });
      }

      if (path === '/api/unsubscribe' && request.method === 'POST') {
        const sub = await request.json();
        const key = 'sub_' + await hashStr(sub.endpoint);
        await env.SUBSCRIPTIONS.delete(key);
        return json({ ok: true, message: '已取消訂閱' });
      }

      if (path === '/api/check-snow' && request.method === 'GET') {
        const results = await runAlertChecks(env);
        return json(results);
      }

      if (path === '/api/test-push' && request.method === 'GET') {
        const subs = await getAllSubs(env);
        const results = [];
        for (const sub of subs) {
          try {
            await sendPush(env, sub, {
              title: '❄️ 測試通知 — Ski Dashboard',
              body:  '通知功能正常！新雪>10cm、極寒、強風等警報已就緒 🎿',
              tag:   'test',
              url:   '/'
            });
            results.push({ ok: true, ep: sub.endpoint.slice(-16) });
          } catch(e) {
            results.push({ ok: false, ep: sub.endpoint.slice(-16), err: e.message });
          }
        }
        return json({ sent: results.filter(r=>r.ok).length, total: subs.length, results });
      }

      if (path === '/api/stats' && request.method === 'GET') {
        const subs = await getAllSubs(env);
        const lastCheck = await env.SUBSCRIPTIONS.get('meta_last_check');
        return json({ subscribers: subs.length, lastCheck: lastCheck||'never',
          resorts: RESORTS.map(r=>r.name), alerts: Object.keys(ALERTS) });
      }

      // ── Debug: show generated JWT ─────────────────────────────────────────
      if (path === '/api/debug-jwt' && request.method === 'GET') {
        try {
          const testEndpoint = 'https://web.push.apple.com/test';
          const jwt = await buildVapidJwt(testEndpoint, env);
          const parts = jwt.split('.');
          const header  = JSON.parse(atob(parts[0].replace(/-/g,'+').replace(/_/g,'/')));
          const payload = JSON.parse(atob(parts[1].replace(/-/g,'+').replace(/_/g,'/')));
          return json({
            ok: true,
            jwt: jwt,
            header, payload,
            sig_length: parts[2].length,
            public_key: VAPID_PUBLIC_KEY.slice(0,16) + '...',
          });
        } catch(e) {
          return json({ ok: false, error: e.message, stack: e.stack });
        }
      }

      // ── Debug: verify key import works ────────────────────────────────────
      if (path === '/api/key-check' && request.method === 'GET') {
        try {
          const key = await importVapidKey();
          const testMsg = new TextEncoder().encode('hello');
          const sig = await crypto.subtle.sign({ name:'ECDSA', hash:{name:'SHA-256'} }, key, testMsg);
          return json({
            ok: true,
            key_imported: true,
            sig_bytes: new Uint8Array(sig).length,
            public_key_prefix: VAPID_PUBLIC_KEY.slice(0,20),
          });
        } catch(e) {
          return json({ ok: false, error: e.message });
        }
      }

      // ── Clear all subscriptions ───────────────────────────────────────────
      if (path === '/api/clear-subs' && request.method === 'GET') {
        const list = await env.SUBSCRIPTIONS.list();
        let deleted = 0;
        for (const k of list.keys) {
          await env.SUBSCRIPTIONS.delete(k.name);
          deleted++;
        }
        return json({ ok: true, deleted, message: 'All subscriptions cleared. Please re-subscribe.' });
      }

      return new Response('Not Found', { status: 404, headers: cors });

    } catch(e) {
      console.error('[Worker] Error:', e);
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runAlertChecks(env));
  }
};

// ═══════════════════════════════════════════════════════════════════════════
//  Alert Logic
// ═══════════════════════════════════════════════════════════════════════════
async function runAlertChecks(env) {
  const results = { checked: [], notified: [], errors: [] };
  const subs = await getAllSubs(env);
  if (subs.length === 0) {
    await env.SUBSCRIPTIONS.put('meta_last_check', new Date().toISOString());
    return { ...results, message: 'No subscribers', subs: 0 };
  }

  for (const resort of RESORTS) {
    try {
      const wx = await fetchWeather(resort.lat, resort.lon, resort.alt);
      const alerts = await checkAlerts(wx, resort, env);
      results.checked.push({ resort: resort.name, snow24h: wx.snow24h, tempFeels: wx.tempFeels, wind: wx.windSpeed });
      for (const alert of alerts) {
        for (const sub of subs) {
          try {
            await sendPush(env, sub, alert);
            results.notified.push({ resort: resort.name, alert: alert.tag });
          } catch(e) {
            results.errors.push({ resort: resort.name, err: e.message });
          }
        }
      }
    } catch(e) {
      results.errors.push({ resort: resort.name, err: e.message });
    }
  }

  await env.SUBSCRIPTIONS.put('meta_last_check', new Date().toISOString());
  return results;
}

async function fetchWeather(lat, lon, alt) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&elevation=${alt}`
    + `&hourly=snowfall&daily=snowfall_sum,apparent_temperature_min,apparent_temperature_max,windspeed_10m_max`
    + `&current_weather=true&forecast_days=3&timezone=auto&windspeed_unit=kmh`;
  const r = await fetch(url);
  const d = await r.json();

  const snow24h = (d.daily?.snowfall_sum?.[0] || 0) + (d.daily?.snowfall_sum?.[1] || 0) * 0.2;
  const snow48h = (d.daily?.snowfall_sum?.[0] || 0) + (d.daily?.snowfall_sum?.[1] || 0);
  const snow2day = (d.daily?.snowfall_sum?.[0] || 0) + (d.daily?.snowfall_sum?.[1] || 0) + (d.daily?.snowfall_sum?.[2] || 0);
  const tempFeels = d.daily?.apparent_temperature_min?.[0] ?? d.current_weather?.temperature ?? 0;
  const windSpeed = d.daily?.windspeed_10m_max?.[0] ?? d.current_weather?.windspeed ?? 0;

  return { snow24h, snow48h, snow2day, tempFeels, windSpeed };
}

async function checkAlerts(wx, resort, env) {
  const alerts = [];
  const now = Math.floor(Date.now()/1000);

  async function dedupCheck(key, ttl) {
    const stored = await env.SUBSCRIPTIONS.get(`dedup_${resort.id}_${key}`);
    if (stored && (now - parseInt(stored)) < ttl) return false;
    await env.SUBSCRIPTIONS.put(`dedup_${resort.id}_${key}`, String(now), { expirationTtl: ttl });
    return true;
  }

  // ❄️ Powder
  if (wx.snow24h >= 20 && await dedupCheck('snow_epic', DEDUP_TTL.snow))
    alerts.push({ title: `❄️ 史詩粉雪！${resort.emoji} ${resort.name}`, body: `24h 降雪 ${wx.snow24h.toFixed(1)} cm — 超級粉雪日！🏆`, tag: 'epic_powder', url: `/?page=${resort.page}` });
  else if (wx.snow24h >= 10 && await dedupCheck('snow_powder', DEDUP_TTL.snow))
    alerts.push({ title: `🎿 新鮮粉雪！${resort.emoji} ${resort.name}`, body: `24h 降雪 ${wx.snow24h.toFixed(1)} cm — 快去滑雪！❄️`, tag: 'powder_alert', url: `/?page=${resort.page}` });

  // 🌡️ Temperature
  if (wx.tempFeels <= -32 && await dedupCheck('cold_extreme', DEDUP_TTL.cold))
    alerts.push({ title: `🥶 極端嚴寒！${resort.emoji} ${resort.name}`, body: `體感溫度 ${wx.tempFeels.toFixed(0)}°C — 請做好保暖措施！⚠️`, tag: 'extreme_cold', url: `/?page=${resort.page}` });
  else if (wx.tempFeels <= -25 && await dedupCheck('cold_warn', DEDUP_TTL.cold))
    alerts.push({ title: `❄️ 嚴寒警告 ${resort.emoji} ${resort.name}`, body: `體感溫度 ${wx.tempFeels.toFixed(0)}°C — 注意保暖！🧣`, tag: 'cold_warning', url: `/?page=${resort.page}` });

  // 💨 Wind
  if (wx.windSpeed >= 90 && await dedupCheck('wind_extreme', DEDUP_TTL.wind))
    alerts.push({ title: `🌪️ 超強風！${resort.emoji} ${resort.name}`, body: `風速 ${wx.windSpeed.toFixed(0)} km/h — 纜車可能關閉！⚠️`, tag: 'wind_extreme', url: `/?page=${resort.page}` });
  else if (wx.windSpeed >= 60 && await dedupCheck('wind_high', DEDUP_TTL.wind))
    alerts.push({ title: `💨 強風警告 ${resort.emoji} ${resort.name}`, body: `風速 ${wx.windSpeed.toFixed(0)} km/h — 注意安全！`, tag: 'wind_high', url: `/?page=${resort.page}` });

  // 🌨️ Blizzard
  if (wx.snow24h >= 5 && wx.windSpeed >= 50 && await dedupCheck('blizzard', DEDUP_TTL.blizzard))
    alerts.push({ title: `🌨️ 暴風雪警告！${resort.emoji} ${resort.name}`, body: `積雪 ${wx.snow24h.toFixed(0)} cm + 風速 ${wx.windSpeed.toFixed(0)} km/h — 注意安全！`, tag: 'blizzard', url: `/?page=${resort.page}` });

  // ⛅ Storm forecast
  if (wx.snow2day >= 25 && await dedupCheck('storm_forecast', DEDUP_TTL.storm))
    alerts.push({ title: `⛅ 大雪預報！${resort.emoji} ${resort.name}`, body: `未來3日預計降雪 ${wx.snow2day.toFixed(0)} cm — 準備好了嗎？🎿`, tag: 'storm_incoming', url: `/?page=${resort.page}` });

  // 🎿 Perfect ski day
  const hour = new Date().getUTCHours() + (-7); // MST approx
  const isMorning = (hour >= 6 && hour <= 10);
  if (isMorning && wx.snow24h >= 5 && wx.tempFeels >= -18 && wx.tempFeels <= -8 && wx.windSpeed < 30 && await dedupCheck('perfect', DEDUP_TTL.perfect))
    alerts.push({ title: `🌟 完美滑雪日！${resort.emoji} ${resort.name}`, body: `新雪 ${wx.snow24h.toFixed(0)} cm，溫度適中，微風 — 絕佳條件！`, tag: 'perfect_ski_day', url: `/?page=${resort.page}` });

  return alerts;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Web Push (RFC 8291 aes128gcm + RFC 8292 VAPID)
// ═══════════════════════════════════════════════════════════════════════════
async function sendPush(env, subscription, payload) {
  const endpoint    = subscription.endpoint;
  const p256dh      = b64Decode(subscription.keys.p256dh);
  const auth        = b64Decode(subscription.keys.auth);
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const encrypted    = await encryptPayload(payloadBytes, p256dh, auth);
  const vapidJwt     = await buildVapidJwt(endpoint, env);
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization':    `vapid t=${vapidJwt},k=${VAPID_PUBLIC_KEY}`,
      'Content-Encoding': 'aes128gcm',
      'Content-Type':     'application/octet-stream',
      'TTL':              '86400',
    },
    body: encrypted
  });
  if (!resp.ok && resp.status !== 201) {
    const body = await resp.text().catch(() => '');
    throw new Error(`${resp.status} ${body}`);
  }
  return resp;
}

// ─── Import VAPID private key ─────────────────────────────────────────────────
let _cachedVapidKey = null;
async function importVapidKey() {
  if (_cachedVapidKey) return _cachedVapidKey;
  _cachedVapidKey = await crypto.subtle.importKey(
    'jwk',
    VAPID_PRIVATE_JWK,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
  return _cachedVapidKey;
}

// ─── Build VAPID JWT (RFC 8292) ───────────────────────────────────────────────
async function buildVapidJwt(endpoint, env) {
  const origin  = new URL(endpoint).origin;
  const now     = Math.floor(Date.now() / 1000);
  const subject = (env && env.VAPID_SUBJECT) || 'mailto:west.wong@westech.com.hk';

  // Build header and claims
  const headerObj  = { typ: 'JWT', alg: 'ES256' };
  const claimsObj  = { aud: origin, exp: now + 43200, sub: subject };  // 12h

  const headerB64  = b64urlStr(JSON.stringify(headerObj));
  const claimsB64  = b64urlStr(JSON.stringify(claimsObj));
  const sigInput   = `${headerB64}.${claimsB64}`;

  // Sign
  const privKey  = await importVapidKey();
  const sigBuf   = await crypto.subtle.sign(
    { name: 'ECDSA', hash: { name: 'SHA-256' } },
    privKey,
    new TextEncoder().encode(sigInput)
  );
  const sigB64   = b64urlBuf(new Uint8Array(sigBuf));
  return `${sigInput}.${sigB64}`;
}

// ─── RFC 8291 aes128gcm Encryption ───────────────────────────────────────────
async function encryptPayload(plain, rcvPub, authSecret) {
  const eph        = await crypto.subtle.generateKey({ name:'ECDH', namedCurve:'P-256' }, true, ['deriveKey','deriveBits']);
  const ephPubRaw  = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  const rcvKey     = await crypto.subtle.importKey('raw', rcvPub, { name:'ECDH', namedCurve:'P-256' }, false, []);
  const sharedBits = await crypto.subtle.deriveBits({ name:'ECDH', public: rcvKey }, eph.privateKey, 256);
  const shared     = new Uint8Array(sharedBits);
  const salt       = crypto.getRandomValues(new Uint8Array(16));

  const prk = await hkdf(authSecret, shared,
    cat(new TextEncoder().encode('WebPush: info\x00'), rcvPub, ephPubRaw), 32);
  const cek = await hkdf(salt, prk, new TextEncoder().encode('Content-Encoding: aes128gcm\x00'), 16);
  const iv  = await hkdf(salt, prk, new TextEncoder().encode('Content-Encoding: nonce\x00'), 12);

  const aesKey = await crypto.subtle.importKey('raw', cek, { name:'AES-GCM' }, false, ['encrypt']);
  const padded = cat(plain, new Uint8Array([2]));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name:'AES-GCM', iv, tagLength:128 }, aesKey, padded));

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096, false);
  return cat(salt, rs, new Uint8Array([65]), ephPubRaw, cipher);
}

async function hkdf(salt, ikm, info, len) {
  const sk  = await crypto.subtle.importKey('raw', salt, { name:'HMAC', hash:'SHA-256' }, false, ['sign']);
  const prk = new Uint8Array(await crypto.subtle.sign('HMAC', sk, ikm));
  const pk  = await crypto.subtle.importKey('raw', prk, { name:'HMAC', hash:'SHA-256' }, false, ['sign']);
  const okm = new Uint8Array(await crypto.subtle.sign('HMAC', pk, cat(info, new Uint8Array([1]))));
  return okm.slice(0, len);
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function cat(...arrays) {
  const total = arrays.reduce((s,a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

// base64url encode a binary string → for JSON (ASCII only)
function b64urlStr(str) {
  return btoa(str).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}

// base64url encode a Uint8Array → for binary data (signature, etc.)
function b64urlBuf(buf) {
  let binary = '';
  for (let i = 0; i < buf.byteLength; i++) binary += String.fromCharCode(buf[i]);
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}

function b64Decode(str) {
  const pad = str + '==='.slice((str.length + 3) % 4);
  const bin = atob(pad.replace(/-/g,'+').replace(/_/g,'/'));
  return new Uint8Array([...bin].map(c => c.charCodeAt(0)));
}

async function hashStr(str) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  let binary = '';
  const bytes = new Uint8Array(h);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'').slice(0,16);
}

async function getAllSubs(env) {
  const list = await env.SUBSCRIPTIONS.list({ prefix: 'sub_' });
  const subs = [];
  for (const k of list.keys) {
    try {
      const v = await env.SUBSCRIPTIONS.get(k.name);
      if (v) subs.push(JSON.parse(v));
    } catch {}
  }
  return subs;
}
