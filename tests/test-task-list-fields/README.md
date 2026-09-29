# Desktop task list fields

Isolated fixture: no production Hub, no credentials. Preferences use the same
best-effort per-device localStorage convention as shortcuts-store; no Hub writes.

From repo root:

```sh
sg docker -c 'docker build -f tests/test-task-list-fields/Dockerfile -t anet-task-fields:review .'
mkdir -p /tmp/anet-task-fields-output
sg docker -c 'docker run --rm -v /tmp/anet-task-fields-output:/output anet-task-fields:review'
sg docker -c 'docker run --rm -v /tmp/anet-task-fields-output:/output -v "$PWD/tests/test-task-list-fields:/spec:ro" mcr.microsoft.com/playwright:v1.58.2-noble sh -c "npm install --prefix /tmp/runner --no-audit --no-fund playwright@1.58.2 >/dev/null && PLAYWRIGHT_MODULE=/tmp/runner/node_modules/playwright/index.mjs node /spec/drive.mjs"'
sg docker -c 'docker run --rm anet-task-fields:review npm test'
```

Build first checks the pure preference model, translated-copy guard and types.
Only then run Chromium: desktop 1200×800 field search, title lock, toggling,
actual drag reorder, keyboard reorder, persistence across reload, reset,
header/cell alignment, bilingual screenshots, Escape, unchanged row opening;
390×844 checks that the phone remains grouped cards without the desktop button.

Current fields only: no placeholder tag column before task tags exist. Project
is available when the Hub supports projects; hiding it for an old Hub does not
erase that column's saved position/visibility. Unknown future IDs are discarded,
new known columns append with defaults. This is replaceable device preference,
not Hub task data and not a cross-device synchronization feature.
