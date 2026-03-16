# Panorama parser notes (v4.2.3)

目標：讓 Panorama 的 official HTML parser 至少有可維護的 selector/helper 與 smoke/regression test，不要把脆弱 regex 散落在 worker 主檔。

## 目前結構

- `lib/panorama-parser.js`
  - `PANORAMA_SELECTORS`
  - `PANORAMA_LABELS`
  - `parsePanoramaCurrentTime()`
  - `extractMetricByLabel()`
  - `extractRatioMetricByLabel()`
  - `parsePanoramaPages()`
- `test/panorama-parser.test.js`
  - timestamp conversion
  - smoke test for snow / lifts / trails / groomed / summary
  - selector anchor sanity checks

## 維護方式

1. 若 Panorama Today HTML 改版，先更新 `PANORAMA_SELECTORS` / `PANORAMA_LABELS`。
2. 再補或調整 `test/panorama-parser.test.js` 的 fixture。
3. 跑 `npm test` 確認 parser 仍能抽出：
   - updatedAt
   - overnight / 24h / 48h / 7d / season
   - lifts open ratio
   - trails open ratio
   - groomed runs
4. 若官網暫時拿不到某欄位，寧可回傳 `null` 並標成 `stale` / `unavailable`，不要偽造值。

## 狀態語意

- `live`: 有可用指標，且 `updatedAt`/`fetchedAt` 在 36 小時內
- `stale`: 有可用指標，但官方更新時間偏舊或不可確認，不可包裝成即時
- `unavailable`: 沒有足夠可誠實顯示的官方資料
- `error`: 抓取或解析失敗
