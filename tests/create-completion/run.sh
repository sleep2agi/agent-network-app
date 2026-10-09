#!/bin/sh
set -eu
test "$SOURCE_COMMIT" = "${EXPECTED_SOURCE_COMMIT:?}"
case "$SOURCE_COMMIT" in *[!0-9a-f]*|'') exit 1;; esac
test "${#SOURCE_COMMIT}" = 40
echo "source=$SOURCE_COMMIT; pure creation-status and request-contract tests only"
bun src/create-request-status.test.ts
bun src/create-node-request.test.ts
bun src/create-node-steps.test.ts
echo 'PASS: not a rendered-client or native OpenCode E2E acceptance'
