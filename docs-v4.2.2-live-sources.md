# v4.2.2 Live source research

日期：2026-03-16

目標：讓 Nakiska、Fernie、Kicking Horse、Panorama 的資料更接近官方即時狀態，而不是只依賴昨晚 snow report。

## 已確認的官方來源

### Nakiska（RCR）
- 官方站：`https://www.skinakiska.com`
- 官方 JSON：
  - `https://www.skinakiska.com/wp-content/themes/kallyas-child/reportData/snowReport.json`
  - `https://www.skinakiska.com/wp-content/themes/kallyas-child/reportData/liftReport.json`
- 可得資料：overnight / 24h / 48h / 7days / YTD / snowPack / runsOpen / runsGroomed / liftsOperating / 各 liftStatus* / saveDate
- 阻塞點：無正式公開 API 文件；欄位為 legacy JSON，需自行 decode `%20` 與解析 saveDate。
- 結論：可直接接入，屬官方且比單純昨晚報表更接近營運即時狀態。

### Fernie Alpine Resort（RCR）
- 官方站：`https://skifernie.com`
- 官方 JSON：
  - `https://skifernie.com/wp-content/themes/kallyas-child/reportData/snowReport.json`
  - `https://skifernie.com/wp-content/themes/kallyas-child/reportData/liftReport.json`
- 可得資料：同 Nakiska。
- 阻塞點：同上；資料更新頻率由 resort 後台決定，不保證 minute-by-minute。
- 結論：可直接接入。

### Kicking Horse（RCR）
- 官方站：`https://kickinghorseresort.com`
- 官方 JSON：
  - `https://kickinghorseresort.com/wp-content/themes/kallyas-child/reportData/snowReport.json`
  - `https://kickinghorseresort.com/wp-content/themes/kallyas-child/reportData/liftReport.json`
- 可得資料：同 Nakiska / Fernie。
- 阻塞點：同上。
- 結論：可直接接入。

### Panorama
- 官方站：`https://www.panoramaresort.com`
- 官方 HTML：
  - `https://www.panoramaresort.com/panorama-today`
  - `https://www.panoramaresort.com/panorama-today/daily-snow-report`
  - `https://www.panoramaresort.com/panorama-today/mountain-webcams`
- 可得資料：
  - `panorama-today`：Current Weather timestamp、Village/Mid/Summit temps、Trails Open、Lifts Open、Groomed Runs、webcam blocks
  - `daily-snow-report`：Overnight、24 Hours、48 Hours、7 Days、Season
- 阻塞點：目前沒找到穩定官方 JSON / REST / GraphQL；需從官方 HTML regex/DOM 抽值，較脆弱。
- 結論：可接入，但屬 official HTML parser，不是假裝有 API。

## v4.2.2 技術方案

1. **RCR resorts（Nakiska / Fernie / Kicking Horse）**
   - 新增共用 adapter：同時讀 `snowReport.json` + `liftReport.json`
   - `updatedAt` 取較新的 `saveDate`
   - snow metrics 取 `newSnowOvernight/newSnow24/newSnow48/newSnow7days/snowPack/newSnowYTD`
   - run/lift metrics：
     - `runsOpen`, `runsGroomed` 取 snow JSON
     - `liftsOpen/liftsTotal` 以 `liftStatus*` 統計，避免只看 summary 欄位
   - 前端沿用 freshness 標示，若官方資料舊則顯示「即時（偏舊）」

2. **Panorama**
   - `daily-snow-report` 提供雪量與季積雪
   - `panorama-today` 提供較即時的 timestamp、lifts/trails/groomed、current weather summary
   - `updatedAt` 採 `panorama-today` 頁面上的 current weather time
   - `rawSummary` 清楚標示資料是由 official HTML block 解析

3. **誠實標示來源**
   - 不把第三方站或 OpenSnow 類 fallback 當成官方 live
   - source 名稱要直接寫出 official JSON 或 official Panorama Today HTML

4. **後續可再做（本輪未做）**
   - 若前端 modal 想更進一步，可顯示 Panorama webcam count / RCR per-lift open count明細
   - 若之後找到 Panorama Silverstripe / timezoneone webcams 的 JSON endpoint，可把 webcam freshness 獨立顯示
