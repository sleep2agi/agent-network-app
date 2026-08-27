#!/bin/sh
set -eu
echo "# App actual recipient source=${APP_ACTUAL_TO_SOURCE_COMMIT:-unknown}"
bun src/actual-recipient.test.ts
bun src/actual-recipient-visual.test.ts
bun run test
bun run typecheck
APP_EXPORT_DIR=$(mktemp -d /tmp/anet-app-actual-to-web.XXXXXX)
bunx expo export --platform web --output-dir "$APP_EXPORT_DIR"
test -f "$APP_EXPORT_DIR/index.html"
echo "RESULT: PASS"
