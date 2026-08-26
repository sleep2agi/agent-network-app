#!/bin/sh
set -eu

if ! printf '%s\n' "${ONBOARDING_UI_SOURCE_COMMIT:-}" | grep -Eq '^[0-9a-f]{40}$'; then
  echo "FAIL: ONBOARDING_UI_SOURCE_COMMIT must be an exact lowercase 40-character SHA" >&2
  exit 1
fi

echo "# Onboarding UI source=$ONBOARDING_UI_SOURCE_COMMIT"
bun src/entry-ui.test.ts
bun src/local-hub-runtime.test.ts
bun src/login-flow.test.ts
bun run typecheck

APP_EXPORT_DIR=$(mktemp -d /tmp/anet-app-onboarding-web.XXXXXX)
bunx expo export --platform web --output-dir "$APP_EXPORT_DIR"
test -f "$APP_EXPORT_DIR/index.html"

echo "RESULT: PASS"
