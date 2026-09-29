# Task page status filter

Owner 2026-09-29, on 任务: 「筛选不能对那个状态进行筛选吗？」 — the header had 负责人 / 优先级 / 项目 chips but no status.

What it does: a 「状态」 chip after 项目 (same `Chip`, same menu). Multi-select 需求池 / 进行中 / 完成, plus
「隐藏已完成」 (= 需求池 + 进行中; tap again to clear). 列表 hides rows; 看板 draws only the selected columns and they
share the width (desktop) or become the only pager tabs (phone). The chip label follows 优先级: 「状态」 when empty,
otherwise the selected labels joined with 「、」.

Guards:

- `src/task-status-filter.test.ts` (runs in `npm test`): the predicate, board column hiding, 隐藏已完成, clear, strings.
- this fixture (not in CI: Playwright + Chromium). 390×844 Android touch, 1200×800 and 1440×900 mouse, zh-CN. Asserts
  the new chip has the same height and centre line as the other chips and the same gap before it, the list/board
  behaviour above, and that 「清除筛选」 sits on one line. Prints a measurement table. Against main: `0/3 passed`
  (no chip at any viewport).

It reuses the test-phone-board bundle (RequirementBoard on react-native-web, read-only /api stub, no hub). From repo root:

```sh
npm install --prefix /tmp/qa-tools --no-save --no-audit --no-fund esbuild@0.25.5
APP_ROOT=$PWD BUNDLE_OUT=/tmp/board.js NODE_PATH=/tmp/qa-tools/node_modules node tests/test-phone-board/build.cjs
BUNDLE=/tmp/board.js OUT=/tmp/status-filter-shots PLAYWRIGHT_MODULE=<…/playwright/index.mjs> node tests/test-task-status-filter/drive.mjs
```
