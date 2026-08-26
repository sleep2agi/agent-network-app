#!/usr/bin/env bash
set -euo pipefail

cd /app
echo "source_commit=${SOURCE_COMMIT}"
bun src/node-info.test.ts

# Witnessed red: leaking the original credential-bearing URL must be caught.
cp src/node-info.ts /tmp/node-info.ts
sed -i 's/return parsed\.origin;/return trimmed;/' src/node-info.ts
if bun src/node-info.test.ts >/tmp/server-red.log 2>&1; then
  echo "FAIL unsafe server URL mutation survived"
  exit 1
fi
mv /tmp/node-info.ts src/node-info.ts

# Witnessed red: accepting arbitrary plain labels would leak @/?/path secrets.
cp src/node-info.ts /tmp/node-info.ts
sed -i 's/if (TOKEN_SHAPE\.test(trimmed)) return undefined;/if (false) return undefined;/' src/node-info.ts
if bun src/node-info.test.ts >/tmp/plain-server-red.log 2>&1; then
  echo "FAIL unsafe plain server label mutation survived"
  exit 1
fi
mv /tmp/node-info.ts src/node-info.ts

# Witnessed red: removing network-id URL encoding must be caught.
cp src/api.ts /tmp/api.ts
sed -i 's/encodeURIComponent(scoped)/scoped/' src/api.ts
if bun src/node-info.test.ts >/tmp/network-red.log 2>&1; then
  echo "FAIL unencoded network scope mutation survived"
  exit 1
fi
mv /tmp/api.ts src/api.ts

bun src/desktop-navigation.test.ts
bun src/desktop-window-pin.test.ts
bun src/chat-actions.test.ts
bun x tsc --noEmit -p tsconfig.build.json
echo "PASS test165 shared chat node info"
