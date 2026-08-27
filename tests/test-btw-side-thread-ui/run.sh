#!/bin/sh
set -eu

test -n "${BTW_UI_SOURCE_COMMIT:-}"
test "${BTW_UI_SOURCE_COMMIT}" != "unrecorded"

bun src/btw-command.test.ts
bun src/side-thread-api.test.ts
bun src/side-thread-http-integration.test.ts
bun src/side-thread-action-controller.test.ts
bun src/side-thread-model.test.ts
bun src/side-thread-scope-gate.test.ts
bun src/side-thread-ui.test.ts
bun run typecheck
bun run test
bunx expo export --platform web --output-dir /tmp/anet-btw-ui-web-export

echo "PASS BTW SideThread App parser/API/model/shared UI contract @ ${BTW_UI_SOURCE_COMMIT}"
