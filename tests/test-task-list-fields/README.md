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

Wide touch displays retain the table and field settings: only narrow content
uses grouped cards. A dedicated fixture does not force desktop=true on Android.
1000×700 Android UA + hasTouch validates pointer=false, table, popover, real taps
on 44×44 up/down reorder controls, boundaries, visibility and detail opening.
Mouse retains native drag and keyboard reorder; touch has explicit up/down
buttons and no automatic search autofocus/keyboard. This is browser emulation,
not a claim of testing on a physical Xiaomi foldable.

Creation and update columns default visible, including on upgrade from a saved
preference without these IDs. Hub #2081 actually exposes `updatedAt` and
`updated_by`; the adapter also accepts `updated_at`. Missing metadata stays
missing (never backfilled from creation). Sorting uses instants, missing/invalid
values last in both directions. Relative labels refresh every 30 seconds;
hover gives native title text, click/touch long-press gives local seconds and
the updater if provided. Pointer platforms do not bind a mobile long-press.
The fixture covers old/new Hub shape, both sort directions, exact hints and
timestamp column alignment; no real Hub is contacted.
