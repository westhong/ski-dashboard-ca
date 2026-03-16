# Ski Dashboard CA

Cloudflare Worker + static frontend for Canadian ski resort weather and honest live snow status.

## v4.2.3 hardening highlights

- 雪況卡片與 modal 以 snow / lifts / trails / groomed / updated 分層呈現
- status 語意統一為 `live` / `stale` / `unavailable` / `error`
- Panorama parser 拆成可維護 helper + selector module
- 加入 Panorama parser smoke/regression tests（Node built-in test runner）
- 修正 production gap：保留誠實標示，不把 stale 資料包裝成 live

## Local checks

```bash
npm test
```
