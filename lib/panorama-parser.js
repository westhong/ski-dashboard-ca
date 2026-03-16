export const PANORAMA_SELECTORS = {
  currentWeatherTime: /<h5 class="brand-subheader blue-text margin-bottom-0">Current Weather<\/h5>\s*<p class="small light-text">([^<]+)<\/p>/i,
  weatherRows: /summary-current__location[\s\S]{0,260}?<h4>(.*?)<sup[\s\S]{0,120}?<div class="temp">[\s\S]{0,80}?(-?\d+)°/gi,
};

export const PANORAMA_LABELS = {
  dailySnow: {
    overnight: 'Overnight',
    last24h: '24 Hours',
    last48h: '48 Hours',
    last7d: '7 Days',
    season: 'Season',
  },
  todayRatios: {
    trails: 'Trails Open',
    lifts: 'Lifts Open',
  },
  todaySingles: {
    groomed: 'Groomed Runs',
  },
};

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

export function parsePanoramaCurrentTime(value) {
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

export function extractMetricByLabel(html, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`<h4[^>]*class="[^"]*margin-bottom-0[^"]*">\\s*([^<]+)\\s*(?:<sup[^>]*>.*?<\\/sup>)?\\s*<\\/h4>\\s*<p[^>]*>\\s*${escaped}\\s*<\\/p>`, 'i'));
  return numberOrNull(match && match[1]);
}

export function extractRatioMetricByLabel(html, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`<h4[^>]*class="[^"]*margin-bottom-0[^"]*">\\s*(\\d+)\\s*<sup[^>]*>\\s*\\/\\s*(\\d+)\\s*<\\/sup>\\s*<\\/h4>\\s*<p[^>]*>\\s*${escaped}\\s*<\\/p>`, 'i'));
  return match ? [numberOrNull(match[1]), numberOrNull(match[2])] : [null, null];
}

export function parsePanoramaPages(todayHtml, dailyHtml) {
  const currentTimeMatch = todayHtml.match(PANORAMA_SELECTORS.currentWeatherTime);
  const updatedAt = parsePanoramaCurrentTime(currentTimeMatch && currentTimeMatch[1]);
  const weatherRows = [...todayHtml.matchAll(PANORAMA_SELECTORS.weatherRows)]
    .map((m) => `${cleanHtmlText(m[1])} ${m[2]}°C`)
    .filter(Boolean);

  return {
    updatedAt,
    metrics: {
      overnightCm: extractMetricByLabel(dailyHtml, PANORAMA_LABELS.dailySnow.overnight),
      last24hCm: extractMetricByLabel(dailyHtml, PANORAMA_LABELS.dailySnow.last24h),
      last48hCm: extractMetricByLabel(dailyHtml, PANORAMA_LABELS.dailySnow.last48h),
      last7dCm: extractMetricByLabel(dailyHtml, PANORAMA_LABELS.dailySnow.last7d),
      seasonCm: extractMetricByLabel(dailyHtml, PANORAMA_LABELS.dailySnow.season),
      groomedRuns: extractMetricByLabel(todayHtml, PANORAMA_LABELS.todaySingles.groomed),
      runs: extractRatioMetricByLabel(todayHtml, PANORAMA_LABELS.todayRatios.trails),
      lifts: extractRatioMetricByLabel(todayHtml, PANORAMA_LABELS.todayRatios.lifts),
    },
    weatherRows,
    rawSummary: weatherRows.length ? `Panorama Today：${weatherRows.join('｜')}` : 'Panorama Today lifts / trails / weather block parsed from official HTML.',
  };
}
