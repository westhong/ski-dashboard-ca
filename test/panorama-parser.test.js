import test from 'node:test';
import assert from 'node:assert/strict';
import { PANORAMA_LABELS, PANORAMA_SELECTORS, parsePanoramaCurrentTime, parsePanoramaPages } from '../lib/panorama-parser.js';

test('parsePanoramaCurrentTime converts Panorama Today stamp to ISO', () => {
  assert.equal(parsePanoramaCurrentTime('7:15AM 16 March, 2026'), '2026-03-16T13:15:00.000Z');
});

test('Panorama parser smoke test extracts snow, lifts, trails, groomed, and summary', () => {
  const todayHtml = `
    <section>
      <h5 class="brand-subheader blue-text margin-bottom-0">Current Weather</h5>
      <p class="small light-text">7:15AM 16 March, 2026</p>
      <div class="metric"><h4 class="margin-bottom-0">62<sup>/141</sup></h4><p>Trails Open</p></div>
      <div class="metric"><h4 class="margin-bottom-0">8<sup>/10</sup></h4><p>Lifts Open</p></div>
      <div class="metric"><h4 class="margin-bottom-0">37</h4><p>Groomed Runs</p></div>
      <div class="summary-current__location"><h4>Village</h4><sup></sup><div class="temp">-3°</div></div>
      <div class="summary-current__location"><h4>Summit</h4><sup></sup><div class="temp">-9°</div></div>
    </section>
  `;
  const dailyHtml = `
    <div><h4 class="margin-bottom-0">7</h4><p>${PANORAMA_LABELS.dailySnow.overnight}</p></div>
    <div><h4 class="margin-bottom-0">14</h4><p>${PANORAMA_LABELS.dailySnow.last24h}</p></div>
    <div><h4 class="margin-bottom-0">18</h4><p>${PANORAMA_LABELS.dailySnow.last48h}</p></div>
    <div><h4 class="margin-bottom-0">31</h4><p>${PANORAMA_LABELS.dailySnow.last7d}</p></div>
    <div><h4 class="margin-bottom-0">402</h4><p>${PANORAMA_LABELS.dailySnow.season}</p></div>
  `;

  const parsed = parsePanoramaPages(todayHtml, dailyHtml);
  assert.equal(parsed.updatedAt, '2026-03-16T13:15:00.000Z');
  assert.equal(parsed.metrics.overnightCm, 7);
  assert.equal(parsed.metrics.last24hCm, 14);
  assert.equal(parsed.metrics.last48hCm, 18);
  assert.equal(parsed.metrics.last7dCm, 31);
  assert.equal(parsed.metrics.seasonCm, 402);
  assert.deepEqual(parsed.metrics.runs, [62, 141]);
  assert.deepEqual(parsed.metrics.lifts, [8, 10]);
  assert.equal(parsed.metrics.groomedRuns, 37);
  assert.match(parsed.rawSummary, /Village -3°C｜Summit -9°C/);
});

test('Panorama selector constants stay anchored to current known blocks', () => {
  assert.match(String(PANORAMA_SELECTORS.currentWeatherTime), /Current Weather/);
  assert.match(String(PANORAMA_SELECTORS.weatherRows), /summary-current__location/);
});
