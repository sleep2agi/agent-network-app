#!/usr/bin/env bash
set -euo pipefail

cd /app
echo "source_commit=${SOURCE_COMMIT}"
bun src/node-info.test.ts
bun src/desktop-navigation.test.ts
bun src/desktop-window-pin.test.ts
bun src/chat-actions.test.ts
bun x tsc --noEmit -p tsconfig.build.json
echo "PASS test165 shared chat node info"
