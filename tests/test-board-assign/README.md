# 从看板直接指派负责人 / 参与人

Task page audit: the card menu had only 查看详情 + 3 move items, tapping the participant avatars did nothing, the bulk
bar had no human owner action, and in the detail 参与人 was hidden in the collapsed 更多 while owner waited for 保存修改.

Guards:

- `src/task-assign.test.ts` (runs in `npm test`): permission gating, only-changed-field bodies (real request
  functions + fake fetch), bulk skip count, wiring, locked-row order.
- `tests/requirement-details/details.test.tsx` (Docker, CI): menu → picker → PATCH, avatar tap, detail owner saves
  immediately and reverts on failure.
- `drive.mjs` here (not in CI: Playwright + Chromium + a web export), desktop 1440×900 + phone 390×844, light + dark,
  in-page Tauri stub (`tests/test-layout-sweep/harness.mjs`). Each step runs on its own, so a pre-change export shows
  every red, not just the first.

```sh
npx expo export --platform web --output-dir /tmp/web
WEB_DIR=/tmp/web OUT=/tmp/board-assign-shots PLAYWRIGHT_MODULE=<…/playwright/index.mjs> node tests/test-board-assign/drive.mjs
```
