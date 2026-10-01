# 新建任务带参与人 + 左栏「我参与的」

Task page audit (566c74c): the create dialog had no 参与人 field (POST sent only owner / agent_owner), and the sidebar
「我负责的」 counted owner only while the 动态 view's 「我的任务」 counted owner OR participant.

What changed:

- Create dialog: 参与人 (humans only) under 负责人 / 负责 Agent, using the same `RequirementPeoplePicker`
  (`mode="participants"`) as the task detail. Desktop = one input row; phone sheet = removable chips + 「添加参与人」.
  Sent in the POST body as `participants: [{kind,id}]` — the hub's create runs the same `assignments()` as PATCH
  (since hub #2065). Shown only when the hub knows participants (two-role hub, or rows carry `participants`).
- Sidebar: 「我参与的」 (participant contains me, owner unrestricted) right under 「我负责的」 (unchanged, owner only).
- 动态 view: 「我的任务」 → 「负责或参与」 (same filter, explicit wording).

Guards:

- `src/task-participants-create.test.ts` (runs in `npm test`): request body, filter counts, scope highlight, strings.
- `drive.mjs` here (not in CI: Playwright + Chromium + a web export), desktop 1440×900 + phone 390×844, light + dark.
  Uses the in-page Tauri stub (`tests/test-layout-sweep/harness.mjs`, which now answers POST /api/requirements and
  records bodies in `window.__tasksCreates`).

```sh
npx expo export --platform web --output-dir /tmp/web
WEB_DIR=/tmp/web OUT=/tmp/task-part-shots PLAYWRIGHT_MODULE=<…/playwright/index.mjs> node tests/test-task-participants/drive.mjs
```
