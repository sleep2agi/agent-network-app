#!/bin/bash
set -euo pipefail
test "$(id -u)" != 0
test ! -e "$ANET_PACKAGED_SMOKE_ROOT"
printf 'TEST ONLY source=%s deb_sha256=%s uid=%s\n' "$TEST_DEB_SOURCE_COMMIT" "$TEST_DEB_SHA256" "$(id -u)"
# Existing production native implementation; no substitute IPC/server.
timeout 90 /usr/bin/agent-network-desktop --smoke-local-hub
test -s "$ANET_PACKAGED_SMOKE_ROOT/local-hub/data/commhub.db"
echo 'PASS: packaged native startup/auth/status/task/restart/persistence atomic gate; NOT UI acceptance'
