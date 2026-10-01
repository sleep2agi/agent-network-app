# 手机快捷改状态 / 优先级(左滑 + 长按菜单)

Phone only (390×844, narrow + touch). Desktop is unchanged (right-click menu still has 移到 需求池/进行中/完成).

- Swipe a phone list row or phone board card left → 「进行中」/「完成」 (the one it isn't in) + 「更多」. Tapping saves at
  once: PATCH body exactly `{"column":…}`; a 5 s 「已移到「…」 · 撤销」 toast reverts with `{"column":<from>}`.
- Long-press → the action sheet's three 移到 rows become 「改状态…」/「改优先级…」 sheet pickers (PATCH `{"column"}` /
  `{"priority"}` only), next to 指派负责人… / 设置参与人….
- Participants (viewer_can.edit_fields has `column`): swipe works, 改状态… on, 改优先级… disabled. Read-only cards: no swipe.

Guards:

- `src/task-quick-status.test.ts` (runs in `npm test`): swipe actions per column / permission, settle geometry, menu
  access, request bodies through the real request functions + fake fetch, wiring.
- `tests/requirement-details/details.test.tsx` (Docker, CI): long-press 改状态… → sheet → `{column}`; swipe 完成 →
  `{column}` → 撤销 → `{column:"pool"}`.
- `drive.mjs` here (not in CI: Playwright + Chromium + a web export), phone light + dark, in-page Tauri stub
  (`tests/test-layout-sweep/harness.mjs`). Each step runs on its own, so a pre-change export shows every red.

```sh
npx expo export --platform web --output-dir /tmp/web
WEB_DIR=/tmp/web OUT=/tmp/phone-status-shots PLAYWRIGHT_MODULE=<…/playwright/index.mjs> node tests/test-phone-quick-status/drive.mjs
```
