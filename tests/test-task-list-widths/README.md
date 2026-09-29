# Desktop task list column widths

Isolated fixture: no production Hub, no credentials, read-only mocked `/api/*`.
Widths ride on the #513 per-device `task_list_fields_v1` preference; no Hub writes.

From repo root:

```sh
sg docker -c 'docker build -f tests/test-task-list-widths/Dockerfile -t anet-task-widths:review .'
mkdir -p /tmp/anet-task-widths-output
sg docker -c 'docker run --rm -v /tmp/anet-task-widths-output:/output anet-task-widths:review'
sg docker -c 'docker run --rm -v /tmp/anet-task-widths-output:/output -v "$PWD/tests/test-task-list-widths:/spec:ro" mcr.microsoft.com/playwright:v1.58.2-noble sh -c "npm install --prefix /tmp/runner --no-audit --no-fund playwright@1.58.2 >/dev/null && PLAYWRIGHT_MODULE=/tmp/runner/node_modules/playwright/index.mjs node /spec/drive.mjs"'
```

The build runs the width model ck test, the #513 field test, the copy guard and
typecheck first. Chromium then runs at 1440x900, 1200x800 and 1920x1080 (the
last is the only size where the default title stretches to fill the card):
real mouse drag of the 标题 divider +200px, header and all six row cells +200,
other columns unchanged, table scrolls inside its card while the page does not,
reload persistence, 64px clamp, hide+show keeps width, double-click reset,
arrow keys, 「恢复默认列宽」, zh labels. A 1000x700 Android touch fixture checks
that touch tables render no handles.
