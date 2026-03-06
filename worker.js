// ══════════════════════════════════════════════════════════════════════
//  Ski Dashboard — Cloudflare Worker v2.0
//  Push Notification Backend
//
//  Required KV binding:   SUBSCRIPTIONS  (namespace: SKI_SUBS)
//  Required env vars:
//    VAPID_PUBLIC_KEY      base64url uncompressed P-256 public key
//    VAPID_PRIVATE_KEY_D   base64url private scalar d
//    VAPID_PRIVATE_KEY_X   base64url public x
//    VAPID_PRIVATE_KEY_Y   base64url public y
//    VAPID_SUBJECT         mailto:admin@westech.com.hk
//
//  Routes:
//    GET  /api/vapid-public-key   return public key for frontend
//    POST /api/subscribe          save push subscription
//    POST /api/unsubscribe        remove push subscription
//    GET  /api/check-snow         manual trigger (testing)
//    GET  /api/test-push          send test push to all subscribers
//    GET  /api/stats              show subscriber count + last check results
//
//  Cron: */30 * * * *  (every 30 min)
// ══════════════════════════════════════════════════════════════════════

// ─── Resort Config ───────────────────────────────────────────────────────────
const RESORTS = [
  { id: 'nakiska',  name: 'Nakiska',         emoji: '🏔️', lat: 50.9406, lon: -115.1531, alt: 2258, page: 0 },
  { id: 'sunshine', name: 'Sunshine Village', emoji: '☀️', lat: 51.0630, lon: -115.7729, alt: 2730, page: 1 },
  { id: 'louise',   name: 'Lake Louise',      emoji: '🏔️', lat: 51.4254, lon: -116.1773, alt: 2637, page: 2 },
  { id: 'norquay',  name: 'Norquay',          emoji: '⛷️', lat: 51.2035, lon: -115.5622, alt: 2133, page: 3 },
];

// ─── Alert Thresholds ────────────────────────────────────────────────────────
const ALERTS = {
  // ❄️ Snow
  POWDER_ALERT:        { key: 'snow_powder',    cm: 10,  enabled: true },   // new snow ≥ 10 cm
  EPIC_POWDER:         { key: 'snow_epic',      cm: 20,  enabled: true },   // new snow ≥ 20 cm (epic day)

  // 🌡️ Temperature (apparent/feels-like)
  COLD_WARNING:        { key: 'cold_warn',    tempC: -25, enabled: true },  // feels-like ≤ -25°C
  EXTREME_COLD:        { key: 'cold_extreme', tempC: -32, enabled: true },  // feels-like ≤ -32°C

  // 💨 Wind
  WIND_HIGH:           { key: 'wind_high',   kmh: 60,  enabled: true },   // wind ≥ 60 km/h (lifts may close)
  WIND_EXTREME:        { key: 'wind_extreme',kmh: 90,  enabled: true },   // wind ≥ 90 km/h (resort closed)

  // 🌨️ Blizzard (snow + wind combined)
  BLIZZARD:            { key: 'blizzard',    snowCm: 5, windKmh: 50, enabled: true },

  // 🎿 Perfect Conditions (powder + good temp + low wind)
  PERFECT_SKI_DAY:     { key: 'perfect',     enabled: true },
  // Conditions: new snow ≥ 5cm AND temp between -8 and -18°C AND wind < 30 km/h

  // ⛅ Upcoming storm forecast (next 2 days ≥ 25cm total)
  STORM_INCOMING:      { key: 'storm_forecast', totalCm: 25, enabled: true },
};

// Dedup TTL in seconds (avoid repeat notifications)
const DEDUP_TTL = {
  snow:        72000,   // 20 hours
  cold:        43200,   // 12 hours
  wind:        21600,   //  6 hours
  blizzard:    21600,   //  6 hours
  perfect:     86400,   // 24 hours
  storm:       86400,   // 24 hours
};

// ─── Main Fetch Handler ───────────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    const cors = {
      'Access-Control-Allow-Origin': 'https://dashboard.westech.com.hk',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    const json = (data, status=200) =>
      new Response(JSON.stringify(data, null, 2), {
        status,
        headers: { ...cors, 'Content-Type': 'application/json' }
      });

    try {
      // ── GET /api/vapid-public-key ──────────────────────────────
      if (path === '/api/vapid-public-key' && request.method === 'GET') {
        return json({ publicKey: env.VAPID_PUBLIC_KEY });
      }

      // ── POST /api/subscribe ────────────────────────────────────
      if (path === '/api/subscribe' && request.method === 'POST') {
        const sub = await request.json();
        if (!sub.endpoint) return json({ error: 'missing endpoint' }, 400);
        const key = 'sub_' + await hashStr(sub.endpoint);
        await env.SUBSCRIPTIONS.put(key, JSON.stringify(sub), { expirationTtl: 60*60*24*90 });
        console.log('[Worker] Subscribed:', key);
        return json({ ok: true, message: '訂閱成功' });
      }

      // ── POST /api/unsubscribe ──────────────────────────────────
      if (path === '/api/unsubscribe' && request.method === 'POST') {
        const sub = await request.json();
        const key = 'sub_' + await hashStr(sub.endpoint);
        await env.SUBSCRIPTIONS.delete(key);
        return json({ ok: true, message: '已取消訂閱' });
      }

      // ── GET /api/check-snow (manual trigger) ──────────────────
      if (path === '/api/check-snow' && request.method === 'GET') {
        const results = await runAlertChecks(env);
        return json(results);
      }

      // ── GET /api/test-push ─────────────────────────────────────
      if (path === '/api/test-push' && request.method === 'GET') {
        const subs = await getAllSubs(env);
        const results = [];
        for (const sub of subs) {
          try {
            await sendPush(env, sub, {
              title: '❄️ 測試通知 — Ski Dashboard',
              body: '通知功能正常！新雪>10cm、極寒、強風等警報已就緒 🎿',
              tag: 'test',
              url: '/'
            });
            results.push({ ok: true, ep: sub.endpoint.slice(-16) });
          } catch(e) {
            results.push({ ok: false, ep: sub.endpoint.slice(-16), err: e.message });
          }
        }
        return json({ sent: results.filter(r=>r.ok).length, total: subs.length, results });
      }

      // ── GET /api/stats ─────────────────────────────────────────
      if (path === '/api/stats' && request.method === 'GET') {
        const subs = await getAllSubs(env);
        const lastCheck = await env.SUBSCRIPTIONS.get('meta_last_check');
        return json({
          subscribers: subs.length,
          lastCheck: lastCheck || 'never',
          resorts: RESORTS.map(r => r.name),
          alerts: Object.keys(ALERTS),
        });
      }

      return new Response('Not Found', { status: 404, headers: cors });

    } catch(err) {
      console.error('[Worker] Error:', err);
      return json({ error: err.message }, 500);
    }
  },

  // ── Cron Handler ───────────────────────────────────────────────────────────
  async scheduled(event, env, ctx) {
    console.log('[Worker] Cron:', new Date().toISOString());
    ctx.waitUntil(runAlertChecks(env));
  }
};

// ══════════════════════════════════════════════════════════════════════
//  Alert Check Engine
// ══════════════════════════════════════════════════════════════════════
async function runAlertChecks(env) {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const hour  = now.getUTCHours() - 7; // Mountain Time approx
  const allResults = [];

  const subs = await getAllSubs(env);
  console.log(`[Worker] ${subs.length} subscribers, checking ${RESORTS.length} resorts`);

  for (const resort of RESORTS) {
    const result = await checkResort(env, resort, today, hour, subs);
    allResults.push(result);
  }

  await env.SUBSCRIPTIONS.put('meta_last_check', now.toISOString(), { expirationTtl: 86400 });
  return { timestamp: now.toISOString(), subscribers: subs.length, results: allResults };
}

async function checkResort(env, resort, today, hour, subs) {
  const alerts = [];
  try {
    // ── Fetch weather data from Open-Meteo ────────────────────────
    // current + today forecast + next 2 days
    const apiUrl =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${resort.lat}&longitude=${resort.lon}` +
      `&hourly=temperature_2m,apparent_temperature,windspeed_10m,visibility,snowfall` +
      `&daily=snowfall_sum,windspeed_10m_max,apparent_temperature_min,temperature_2m_min,temperature_2m_max` +
      `&current_weather=true` +
      `&timezone=America%2FEdmonton` +
      `&forecast_days=3&past_days=1`;

    const resp = await fetch(apiUrl, { cf: { cacheTtl: 900 } }); // cache 15min
    const data = await resp.json();

    if (!data.daily) throw new Error('No daily data');

    const daily  = data.daily;
    // Index layout with past_days=1: [yesterday, today, tomorrow, day+2]
    const idx = { yesterday: 0, today: 1, tomorrow: 2, dayAfter: 3 };

    const snowToday    = daily.snowfall_sum?.[idx.today]     || 0;
    const snowTomorrow = daily.snowfall_sum?.[idx.tomorrow]  || 0;
    const snowDayAfter = daily.snowfall_sum?.[idx.dayAfter]  || 0;
    const snowForecast2d = snowTomorrow + snowDayAfter;

    const windMax      = daily.windspeed_10m_max?.[idx.today]           || 0;
    const windMaxKmh   = windMax * 3.6;  // m/s → km/h
    const feelMin      = daily.apparent_temperature_min?.[idx.today]    || 0;
    const tempMin      = daily.temperature_2m_min?.[idx.today]          || 0;
    const tempMax      = daily.temperature_2m_max?.[idx.today]          || 0;

    console.log(`[${resort.name}] snow=${snowToday}cm wind=${windMaxKmh.toFixed(0)}km/h feel=${feelMin}°C`);

    // ── 1. EPIC POWDER (≥20cm) ─────────────────────────────────
    if (ALERTS.EPIC_POWDER.enabled && snowToday >= ALERTS.EPIC_POWDER.cm) {
      const sent = await dedupCheck(env, `${resort.id}_snow_epic_${today}`);
      if (!sent) {
        const n = {
          title: `🎿 史詩粉雪日！— ${resort.name}`,
          body:  `今日新雪 ${round1(snowToday)} cm！絕佳粉雪條件，趕快出發！❄️❄️❄️`,
          tag:   `snow_epic_${resort.id}`, url: `/?page=${resort.page}`
        };
        await broadcastPush(env, subs, n);
        await dedupSet(env, `${resort.id}_snow_epic_${today}`, DEDUP_TTL.snow);
        alerts.push({ type: 'epic_powder', snowCm: snowToday, sent: subs.length });
      }
    }
    // ── 2. POWDER ALERT (≥10cm, skip if epic already sent) ────
    else if (ALERTS.POWDER_ALERT.enabled && snowToday >= ALERTS.POWDER_ALERT.cm) {
      const sent = await dedupCheck(env, `${resort.id}_snow_powder_${today}`);
      if (!sent) {
        const n = {
          title: `❄️ 新雪警報 — ${resort.name}`,
          body:  `今日新雪 ${round1(snowToday)} cm！雪況絕佳，適合出發 🎿`,
          tag:   `snow_powder_${resort.id}`, url: `/?page=${resort.page}`
        };
        await broadcastPush(env, subs, n);
        await dedupSet(env, `${resort.id}_snow_powder_${today}`, DEDUP_TTL.snow);
        alerts.push({ type: 'powder', snowCm: snowToday, sent: subs.length });
      }
    }

    // ── 3. BLIZZARD (snow + wind combined) ────────────────────
    if (ALERTS.BLIZZARD.enabled &&
        snowToday >= ALERTS.BLIZZARD.snowCm &&
        windMaxKmh >= ALERTS.BLIZZARD.windKmh) {
      const sent = await dedupCheck(env, `${resort.id}_blizzard_${today}`);
      if (!sent) {
        const n = {
          title: `🌨️ 暴風雪警告 — ${resort.name}`,
          body:  `強風 ${Math.round(windMaxKmh)} km/h + 降雪 ${round1(snowToday)} cm，出行請注意安全！`,
          tag:   `blizzard_${resort.id}`, url: `/?page=${resort.page}`
        };
        await broadcastPush(env, subs, n);
        await dedupSet(env, `${resort.id}_blizzard_${today}`, DEDUP_TTL.blizzard);
        alerts.push({ type: 'blizzard', snowCm: snowToday, windKmh: windMaxKmh, sent: subs.length });
      }
    }

    // ── 4. EXTREME COLD (feels-like ≤ -32°C) ──────────────────
    if (ALERTS.EXTREME_COLD.enabled && feelMin <= ALERTS.EXTREME_COLD.tempC) {
      const dedupKey = `${resort.id}_cold_extreme_${today}`;
      const sent = await dedupCheck(env, dedupKey);
      if (!sent) {
        const n = {
          title: `🥶 危險低溫！— ${resort.name}`,
          body:  `體感溫度 ${Math.round(feelMin)}°C，有凍傷風險！請穿著充足保暖裝備或推遲出行。`,
          tag:   `cold_extreme_${resort.id}`, url: `/?page=${resort.page}`
        };
        await broadcastPush(env, subs, n);
        await dedupSet(env, dedupKey, DEDUP_TTL.cold);
        alerts.push({ type: 'extreme_cold', feelsLike: feelMin, sent: subs.length });
      }
    }
    // ── 5. COLD WARNING (feels-like ≤ -25°C) ──────────────────
    else if (ALERTS.COLD_WARNING.enabled && feelMin <= ALERTS.COLD_WARNING.tempC) {
      const dedupKey = `${resort.id}_cold_warn_${today}_${Math.floor(Math.abs(hour)/6)}`;
      const sent = await dedupCheck(env, dedupKey);
      if (!sent) {
        const n = {
          title: `🌡️ 嚴寒警告 — ${resort.name}`,
          body:  `體感溫度 ${Math.round(feelMin)}°C，請做好保暖措施 🧥🧤`,
          tag:   `cold_warn_${resort.id}`, url: `/?page=${resort.page}`
        };
        await broadcastPush(env, subs, n);
        await dedupSet(env, dedupKey, DEDUP_TTL.cold);
        alerts.push({ type: 'cold_warning', feelsLike: feelMin, sent: subs.length });
      }
    }

    // ── 6. EXTREME WIND (≥90 km/h) ────────────────────────────
    if (ALERTS.WIND_EXTREME.enabled && windMaxKmh >= ALERTS.WIND_EXTREME.kmh) {
      const dedupKey = `${resort.id}_wind_extreme_${today}`;
      const sent = await dedupCheck(env, dedupKey);
      if (!sent) {
        const n = {
          title: `💨 極端強風！— ${resort.name}`,
          body:  `風速達 ${Math.round(windMaxKmh)} km/h，升降機可能全面關閉！請查看最新公告。`,
          tag:   `wind_extreme_${resort.id}`, url: `/?page=${resort.page}`
        };
        await broadcastPush(env, subs, n);
        await dedupSet(env, dedupKey, DEDUP_TTL.wind);
        alerts.push({ type: 'wind_extreme', windKmh: windMaxKmh, sent: subs.length });
      }
    }
    // ── 7. HIGH WIND (≥60 km/h) ───────────────────────────────
    else if (ALERTS.WIND_HIGH.enabled && windMaxKmh >= ALERTS.WIND_HIGH.kmh) {
      const dedupKey = `${resort.id}_wind_high_${today}`;
      const sent = await dedupCheck(env, dedupKey);
      if (!sent) {
        const n = {
          title: `💨 強風警報 — ${resort.name}`,
          body:  `風速 ${Math.round(windMaxKmh)} km/h，部分升降機可能關閉，出發前請確認 ⚠️`,
          tag:   `wind_high_${resort.id}`, url: `/?page=${resort.page}`
        };
        await broadcastPush(env, subs, n);
        await dedupSet(env, dedupKey, DEDUP_TTL.wind);
        alerts.push({ type: 'wind_high', windKmh: windMaxKmh, sent: subs.length });
      }
    }

    // ── 8. PERFECT SKI DAY ─────────────────────────────────────
    // Conditions: new snow ≥5cm AND temp -8~-18°C AND wind <30 km/h (daytime only 6-10am MT)
    const isPerfect = snowToday >= 5
      && tempMin >= -20 && tempMax <= -5
      && windMaxKmh < 30;
    const isMorning = hour >= 6 && hour <= 10;

    if (ALERTS.PERFECT_SKI_DAY.enabled && isPerfect && isMorning) {
      const dedupKey = `${resort.id}_perfect_${today}`;
      const sent = await dedupCheck(env, dedupKey);
      if (!sent) {
        const n = {
          title: `🎿 完美滑雪日！— ${resort.name}`,
          body:  `新雪 ${round1(snowToday)} cm ＋ 溫度 ${Math.round(tempMax)}°C ＋ 微風 ${Math.round(windMaxKmh)} km/h，今日條件極佳！`,
          tag:   `perfect_${resort.id}`, url: `/?page=${resort.page}`
        };
        await broadcastPush(env, subs, n);
        await dedupSet(env, dedupKey, DEDUP_TTL.perfect);
        alerts.push({ type: 'perfect_day', snowCm: snowToday, tempMax, windKmh: windMaxKmh, sent: subs.length });
      }
    }

    // ── 9. INCOMING STORM FORECAST (next 2 days ≥25cm) ────────
    if (ALERTS.STORM_INCOMING.enabled && snowForecast2d >= ALERTS.STORM_INCOMING.totalCm) {
      const dedupKey = `${resort.id}_storm_${today}`;
      const sent = await dedupCheck(env, dedupKey);
      if (!sent) {
        const n = {
          title: `⛄ 大雪預報 — ${resort.name}`,
          body:  `未來2天預計降雪 ${round1(snowForecast2d)} cm（明日 ${round1(snowTomorrow)} cm），準備好了嗎？❄️`,
          tag:   `storm_${resort.id}`, url: `/?page=${resort.page}`
        };
        await broadcastPush(env, subs, n);
        await dedupSet(env, dedupKey, DEDUP_TTL.storm);
        alerts.push({ type: 'storm_forecast', forecast2dCm: snowForecast2d, sent: subs.length });
      }
    }

    return { resort: resort.name, snowToday, windMaxKmh: round1(windMaxKmh), feelMin, alerts };

  } catch(err) {
    console.error(`[Worker] ${resort.name} error:`, err);
    return { resort: resort.name, error: err.message, alerts: [] };
  }
}

// ══════════════════════════════════════════════════════════════════════
//  Broadcast push to all subscribers
// ══════════════════════════════════════════════════════════════════════
async function broadcastPush(env, subs, notification) {
  const toDelete = [];
  for (const sub of subs) {
    try {
      await sendPush(env, sub, notification);
    } catch(e) {
      if (e.message.includes('410') || e.message.includes('404') || e.message.includes('401')) {
        // Stale subscription — mark for deletion
        toDelete.push('sub_' + await hashStr(sub.endpoint));
      }
      console.warn('[Worker] Push failed:', e.message.slice(0, 80));
    }
  }
  // Clean up stale subscriptions
  for (const key of toDelete) {
    await env.SUBSCRIPTIONS.delete(key).catch(()=>{});
  }
}

// ══════════════════════════════════════════════════════════════════════
//  KV Helpers
// ══════════════════════════════════════════════════════════════════════
async function getAllSubs(env) {
  const list = await env.SUBSCRIPTIONS.list({ prefix: 'sub_' });
  const subs = [];
  for (const k of list.keys) {
    const v = await env.SUBSCRIPTIONS.get(k.name);
    if (v) { try { subs.push(JSON.parse(v)); } catch{} }
  }
  return subs;
}

async function dedupCheck(env, key) {
  return !!(await env.SUBSCRIPTIONS.get('dedup_' + key));
}

async function dedupSet(env, key, ttl) {
  await env.SUBSCRIPTIONS.put('dedup_' + key, '1', { expirationTtl: ttl });
}

// ══════════════════════════════════════════════════════════════════════
//  Web Push (RFC 8291 aes128gcm + RFC 8292 VAPID)
// ══════════════════════════════════════════════════════════════════════
async function sendPush(env, subscription, payload) {
  const endpoint = subscription.endpoint;
  const p256dh   = b64Decode(subscription.keys.p256dh);
  const auth     = b64Decode(subscription.keys.auth);

  const payloadBytes  = new TextEncoder().encode(JSON.stringify(payload));
  const encrypted     = await encryptPayload(payloadBytes, p256dh, auth);
  const vapidJwt      = await buildVapidJwt(env, endpoint);

  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization':    `vapid t=${vapidJwt},k=${env.VAPID_PUBLIC_KEY}`,
      'Content-Encoding': 'aes128gcm',
      'Content-Type':     'application/octet-stream',
      'TTL':              '86400',
    },
    body: encrypted
  });

  if (!resp.ok && resp.status !== 201) {
    throw new Error(`${resp.status} ${await resp.text().catch(()=>'')}`);
  }
  return resp;
}

// ─── VAPID JWT ────────────────────────────────────────────────────────────────
async function buildVapidJwt(env, endpoint) {
  const origin = new URL(endpoint).origin;
  const now    = Math.floor(Date.now() / 1000);
  const header = b64Encode(JSON.stringify({ typ:'JWT', alg:'ES256' }));
  const claims = b64Encode(JSON.stringify({ aud: origin, exp: now+12*3600, sub: env.VAPID_SUBJECT||'mailto:admin@westech.com.hk' }));
  const sigInput = `${header}.${claims}`;
  const privKey  = await crypto.subtle.importKey('jwk', {
    kty:'EC', crv:'P-256',
    d: env.VAPID_PRIVATE_KEY_D,
    x: env.VAPID_PRIVATE_KEY_X,
    y: env.VAPID_PRIVATE_KEY_Y,
    key_ops:['sign']
  }, { name:'ECDSA', namedCurve:'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign(
    { name:'ECDSA', hash:'SHA-256' }, privKey, new TextEncoder().encode(sigInput));
  return `${sigInput}.${b64Encode(new Uint8Array(sig))}`;
}

// ─── RFC 8291 Encryption ──────────────────────────────────────────────────────
async function encryptPayload(plain, rcvPub, authSecret) {
  const eph = await crypto.subtle.generateKey({ name:'ECDH', namedCurve:'P-256' }, true, ['deriveKey','deriveBits']);
  const ephPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  const rcvKey    = await crypto.subtle.importKey('raw', rcvPub, { name:'ECDH', namedCurve:'P-256' }, false, []);
  const sharedBits= await crypto.subtle.deriveBits({ name:'ECDH', public: rcvKey }, eph.privateKey, 256);
  const shared    = new Uint8Array(sharedBits);
  const salt      = crypto.getRandomValues(new Uint8Array(16));

  const prk = await hkdf(authSecret, shared,
    cat(new TextEncoder().encode('WebPush: info\x00'), rcvPub, ephPubRaw), 32);
  const cek = await hkdf(salt, prk, new TextEncoder().encode('Content-Encoding: aes128gcm\x00'), 16);
  const iv  = await hkdf(salt, prk, new TextEncoder().encode('Content-Encoding: nonce\x00'), 12);

  const aesKey = await crypto.subtle.importKey('raw', cek, { name:'AES-GCM' }, false, ['encrypt']);
  const padded = cat(plain, new Uint8Array([2]));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name:'AES-GCM', iv, tagLength:128 }, aesKey, padded));

  const rs = new Uint8Array(4); new DataView(rs.buffer).setUint32(0, 4096, false);
  return cat(salt, rs, new Uint8Array([65]), ephPubRaw, cipher);
}

// ─── HKDF ────────────────────────────────────────────────────────────────────
async function hkdf(salt, ikm, info, len) {
  const sk  = await crypto.subtle.importKey('raw', salt, { name:'HMAC', hash:'SHA-256' }, false, ['sign']);
  const prk = new Uint8Array(await crypto.subtle.sign('HMAC', sk, ikm));
  const pk  = await crypto.subtle.importKey('raw', prk,  { name:'HMAC', hash:'SHA-256' }, false, ['sign']);
  const okm = new Uint8Array(await crypto.subtle.sign('HMAC', pk, cat(info, new Uint8Array([1]))));
  return okm.slice(0, len);
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function cat(...arrays) {
  const total = arrays.reduce((s,a)=>s+a.length,0);
  const out = new Uint8Array(total); let off=0;
  for (const a of arrays) { out.set(a,off); off+=a.length; }
  return out;
}
function b64Decode(str) {
  const pad = str + '==='.slice((str.length+3)%4);
  const bin = atob(pad.replace(/-/g,'+').replace(/_/g,'/'));
  return new Uint8Array([...bin].map(c=>c.charCodeAt(0)));
}
function b64Encode(input) {
  const bytes = typeof input==='string' ? new TextEncoder().encode(input) : input;
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}
async function hashStr(str) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return b64Encode(new Uint8Array(h)).slice(0,16);
}
function round1(n) { return Math.round(n*10)/10; }
