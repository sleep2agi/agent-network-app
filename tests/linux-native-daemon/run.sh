#!/bin/bash
set -euo pipefail
test "$(id -u)" = 10001
test "${ANET_PACKAGED_SMOKE:-}" = 1
test "${ANET_ISOLATED_KEYRING_TEST:-}" = 1
test "$ANET_PACKAGED_SMOKE_ROOT" = /home/smoke/native-daemon-test
test ! -e "$ANET_PACKAGED_SMOKE_ROOT"
scenario=${1:-empty}
case "$scenario" in
  empty) ;;
  exact|partial|old-cli|old-node)
    mkdir -p "$ANET_PACKAGED_SMOKE_ROOT/local-daemon/anet"
    case "$scenario" in
      old-cli) seed=/fixture/old-cli-prefix ;;
      old-node) seed=/fixture/old-node-prefix ;;
      *) seed=/fixture/exact-prefix ;;
    esac
    cp -a "$seed/." "$ANET_PACKAGED_SMOKE_ROOT/local-daemon/anet/"
    # Match an existing product-created private prefix (ensure_private_dir).
    chmod 700 "$ANET_PACKAGED_SMOKE_ROOT/local-daemon/anet"
    node /fixture/daemon-verify.mjs "before-$scenario"
    ;;
  *) echo 'FAIL: unknown native daemon scenario' >&2; exit 2 ;;
esac
printf 'TEST ONLY native daemon scenario=%s source=%s deb_sha256=%s\n' "$scenario" "$TEST_DEB_SOURCE_COMMIT" "$TEST_DEB_SHA256"
# Actual packaged Rust installer, actual bundled Hub/credential store, actual
# CLI/npm/agent-node. No substitute server, CLI stub or host mount.
if [[ "$scenario" = partial || "$scenario" = old-cli || "$scenario" = old-node ]]; then
  set +e
  timeout 240 /usr/bin/agent-network-desktop --smoke-local-daemon-install >/evidence/partial-refusal.log 2>&1
  result=$?
  set -e
  test "$result" = 1
  if [ "$scenario" = old-cli ]; then
    grep -F 'private anet must be exactly @sleep2agi/agent-network@2.3.0-preview.162' /evidence/partial-refusal.log
  else
    grep -F 'private agent-node must be an intact @sleep2agi/agent-node@2.5.0-preview.128' /evidence/partial-refusal.log
  fi
  grep -F '[FAIL] 私有组件配对检查' /evidence/partial-refusal.log
else
  timeout 240 /usr/bin/agent-network-desktop --smoke-local-daemon-install
fi
node /fixture/daemon-verify.mjs "$scenario"
echo "PASS: native daemon installer ($scenario); NOT V2 runtime lifecycle or UI-click acceptance"
