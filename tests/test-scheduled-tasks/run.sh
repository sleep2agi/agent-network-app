#!/bin/sh
set -eu
echo "# App scheduled tasks source=${APP_SCHEDULER_SOURCE_COMMIT:-unknown}"
bun src/scheduled-tasks-api.test.ts
APP_EXPORT_DIR=$(mktemp -d /tmp/anet-app-scheduler-web.XXXXXX)
bunx expo export --platform web --output-dir "$APP_EXPORT_DIR"
test -f "$APP_EXPORT_DIR/index.html"
echo "RESULT: PASS"
