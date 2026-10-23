# Agent Organization UI Harness

Runs the unchanged, currently exported `dist` through the complete App. No build,
production source changes, credentials, proxy, or external service is required.

## Run

```sh
/Users/vansin/.nvm/versions/node/v24.19.0/bin/node tests/agent-org-ui/verify.mjs
/Users/vansin/.nvm/versions/node/v24.19.0/bin/node tests/agent-org-ui/departments.mjs
/Users/vansin/.nvm/versions/node/v24.19.0/bin/node tests/agent-org-ui/bulk.mjs
```

Override `PLAYWRIGHT_MODULE` if necessary. Uses installed Google Chrome when
available. Screenshots, per-case mutation logs, bundle SHA-256 fingerprints, and
the machine-readable report are written to the ignored `artifacts/` directory.
The verifier exits nonzero when any assertion fails, including known defects.

Preview:

```sh
/Users/vansin/.nvm/versions/node/v24.19.0/bin/node tests/agent-org-ui/server.mjs
```

Open `http://127.0.0.1:9339/`, then Settings > Agent organization. Direct full-App
Settings preview: `http://127.0.0.1:9339/?settings=1&category=agentTeams`.
Append `&theme=dark` for dark mode. Narrow the viewport to 390px for mobile.

## Fixture

- 329 original329 agents, initially unassigned, with an empty TMAI root.
- Nested TMAI > TMWork > Stations > Station Alpha / Station Beta, plus 45 stations
  to exercise scrollable department pickers.
- Directory uses the exact production endpoint and two pages (200 + 1 people).
  The final person's 200 agents deliberately test second-page loading; the other
  129 agents have no owner. Human department TMWork must not assign Agent location.
- `POST /__fixture/reset?populated=1` seeds three Alpha agents, 326 unassigned.
- `POST /__fixture/deny` rejects moves with 403; `?value=0` permits moves.
- The exact Agent department PUT and department POST/PATCH contracts mutate fixture data. State,
  attempted writes, status codes, and request logs are at `/__fixture/state`.
- Reuses the scheduler Tauri/profile bootstrap without modifying it. The local
  extension implements window enumeration and maps the App's requested Settings
  webview URL into this browser tab. The verifier first clicks the actual App
  Settings navigation, then its actual organization category. No component mount.
- CSP, fetch guard, WebSocket stub, and Playwright routing prevent external
  traffic. Server binds loopback only. All data is disposable process memory.

## Validation: 2026-10-23

**394 / 394 checks passed** against the existing exported dist, without building,
installing dependencies, modifying production/chat source, or running git.

| Suite | Checks | Screenshots | Cases |
| --- | --- | --- | --- |
| `verify.mjs` | 130/130 | 28 | Desktop/mobile light/dark |
| `departments.mjs` | 94/94 | 24 | Desktop/mobile light/dark |
| `bulk.mjs` | 170/170 | 42 | Desktop/mobile light/dark plus 1280px light/dark at 1.5x |

Desktop is 1440x1100; mobile is 390x844. High-scale cases are 1280x900 using
the App's existing `osFontScale=1.5&uiScaleSim=legacy` simulation, not browser
zoom or an OS accessibility setting. The test checks the effective input font
size and preserves simulation parameters through actual Settings navigation.
All three reports identify the same loaded entry:
`index-7c3854339ed91d3f992af95509b32097.js`, SHA-256
`beec869a6d9b785ef2f17ec52cc02da01b623e1e0746544f0d2a0741a16bfd34`.
No uncaught App errors, attempted external browser requests, unexpected mutation
endpoints, or tested application defects were found.

Covered initial unassigned-first selection, populated departments, empty department, visual
highlight, member alias/ID/owner search, no results, mobile child navigation and
back, collapsed adjustment, bounded/scrolling searchable pickers, Escape close,
incomplete apply, no writes while picking, exactly one successful PUT on apply,
persisted data after reload, ancestor counts, denied-save rollback, and rollback
preserving a previous successful in-memory override.

### Intentional Semantic Updates

Legacy assertions now expect the intentional first60 rendering cap, with the
remaining count visible and ID search reaching agent328. Owner search still
matches200 but renders60 plus a140-remaining message. Reload selects unassigned
first when any remain; saved populated departments are verified by explicit
navigation. Web department `aria-selected` assertions remain in place.
Typecheck, builds, and source/unit suites were not run in this task.

Representative screenshots:

- `artifacts/desktop-light-workspace.png`
- `artifacts/desktop-dark-workspace.png`
- `artifacts/mobile-light-workspace.png`
- `artifacts/mobile-dark-workspace.png`
- `artifacts/desktop-dark-agent-picker.png`
- `artifacts/mobile-light-department-picker.png`
- `artifacts/desktop-light-populated-seed.png`
- `artifacts/mobile-dark-denied-rollback.png`

Screenshots are visual evidence reviewed manually, not pixel-baseline assertions.
This is a browser/Web export test with mocked Tauri IPC, not native OS window or
mobile keyboard testing.

## Department Editor Regression

```sh
/Users/vansin/.nvm/versions/node/v24.19.0/bin/node tests/agent-org-ui/departments.mjs
```

Runs full App Settings navigation in desktop/mobile light/dark against the existing
export, without building. Latest result: **94/94 checks, 24 screenshots** in
`artifacts/departments/`. The updated `verify.mjs` passes
**130/130 checks, 28 screenshots** with the extended server.

Covers blank-name validation, root/child POST responses shaped as `{ department }`,
rename and reparent PATCH payloads, exclusion of self/descendants, parent search,
shared human/Agent tree warning, persisted reload, server failure, revoked
permission (403), `viewer_can.manage/create_child` denial without writes,
post-write refresh failure and retry without duplicate POST, bounded dialogs,
and document overflow. Mobile uses Android browser emulation and simulated
32px/24px safe areas, not an actual native device.

`POST /__fixture/mode?fail=1` makes department writes fail; `?refreshFail=1`
makes department reads fail; `?restricted=1` supplies a viewer identity and
false department permission flags. An empty query clears all three switches.
Root creation has no permission field in the department wire contract; its
button is not hidden by these per-department flags. The fixture still rejects
unauthorized writes. Tests do not fabricate a root-permission response field.

Each run records bundle hashes, request bodies/statuses, errors and screenshot
paths in its report. Screenshots are evidence, not pixel-baseline comparisons.

## Bulk And Toolbar Regression

`bulk.mjs` checks the current entry for `agent-org-bulk-confirm` before UI
navigation. A missing marker fails immediately; it does not poll for a new export.
The unchanged329-agent fixture is used, not333 or500 agents.

- Header context/summary plus new-department button, sidebar32percent/max240,
  initially closed information disclosure, and count outside the compact bulk button.
- Explicit confirmation before any PUT, including one matching agent; closing
  either picker or confirmation and Escape confirmation all produce zero writes.
- Exact matching nodeIDs only, one successful assignment, six successes/two
  injected failures, persisted counts, failed agents retained, and no false success.
- Search changes after confirmation opens do not alter the confirmed snapshot.
  The test dispatches a real input event through the native input value setter
  behind the modal; this is a controlled race exercise, not a claim that users
  can interact through the modal. No App handler/state is replaced.
- A100-match batch writes exactly100 distinct matching IDs despite the60-row cap.
- Query and department changes reset member scrolling; revoked permission returns
  403 without mutation, and restricted department controls remain hidden.

Representative screenshots in `artifacts/bulk/`:

- `desktop-light-toolbar-unassigned329.png`
- `desktop-dark-toolbar-unassigned329.png`
- `mobile-light-toolbar-unassigned329.png`
- `mobile-dark-toolbar-unassigned329.png`
- `desktop-light-scale150-toolbar-unassigned329.png`
- `desktop-dark-scale150-toolbar-unassigned329.png`
- `mobile-dark-confirmation-snapshot.png`
- `desktop-light-partial-failure.png`

Toolbar screenshots scroll the outer Settings content back to the top after
disclosure interactions. Representative desktop/mobile/high-scale toolbar and
mobile confirmation screenshots were reviewed manually. Deep labels truncate
with ellipses at1.5x; compact actions remain readable and dialogs stay bounded.
This is the complete exported App in Chrome with mocked Tauri IPC and a loopback
HTTP fixture. Native Tauri windows, iOS/Android devices, OS text scaling, native
keyboards and production Hub authorization are untested. The403 tests validate
client handling of fixture responses, not production server permission enforcement.
