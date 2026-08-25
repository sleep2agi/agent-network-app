#!/bin/sh
set -eu

test -n "${BTW_UI_SOURCE_COMMIT:-}"
test "${BTW_UI_SOURCE_COMMIT}" != "unrecorded"

bun src/btw-command.test.ts
bun src/side-thread-api.test.ts
bun src/side-thread-model.test.ts
bun src/side-thread-ui.test.ts
bun run typecheck

echo "PASS BTW SideThread App parser/API/model/shared UI contract @ ${BTW_UI_SOURCE_COMMIT}"
