#!/usr/bin/env bash
set -euo pipefail
if [[ "${GITHUB_ACTIONS:-}" != true || "${RUNNER_OS:-}" != macOS || "$(uname -s)" != Darwin ]]; then
  echo 'Isolated GitHub macOS runner required' >&2
  exit 1
fi
candidate="$PWD/src-tauri/target/release/bundle/macos/ANet.app"
test -d "$candidate"
root="$(mktemp -d "$RUNNER_TEMP/anet-rename805.XXXXXX")"
curl -fLsS --retry 2 'https://github.com/sleep2agi/agent-network-app/releases/download/desktop-v0.2.224/Agent.Network_0.2.224_aarch64.app.tar.gz' -o "$root/old.tar.gz"
test "$(shasum -a 256 "$root/old.tar.gz" | cut -d ' ' -f 1)" = 4cf2404c013602f527b9ad6808ddded1eb29d2f97f4ea75fac8d76cf3c47f50c
mkdir "$root/Applications"
tar -xzf "$root/old.tar.gz" -C "$root/Applications"
installed="$root/Applications/Agent Network.app"
test -d "$installed"
test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$installed/Contents/Info.plist")" = top.vansin.agentnetwork.desktop
export ANET_PACKAGED_SMOKE=1
export ANET_PACKAGED_SMOKE_ROOT="$root/account-data"
# Reuse the shipped native credential/local-Hub smoke, no production account.
"$installed/Contents/MacOS/agent-network-desktop" --smoke-local-hub
database="$ANET_PACKAGED_SMOKE_ROOT/local-hub/data/commhub.db"
test -s "$database"
users_before="$(sqlite3 "$database" 'SELECT user_id FROM users ORDER BY user_id;')"
test -n "$users_before"
test -s "$ANET_PACKAGED_SMOKE_ROOT/profiles/index.json"
# Tauri updater 2.10.1 replaces Contents at the existing application path.
# This exercises native bundle replacement, not updater download/signature UI.
mv "$installed" "$root/previous.app"
ditto "$candidate" "$installed"
codesign --verify --deep --strict "$installed"
test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$installed/Contents/Info.plist")" = top.vansin.agentnetwork.desktop
test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleName' "$installed/Contents/Info.plist")" = ANet
test "$(find "$root/Applications" -maxdepth 1 -name '*.app' | wc -l | tr -d ' ')" = 1
"$installed/Contents/MacOS/agent-network-desktop" --smoke-local-hub
test "$(sqlite3 "$database" 'SELECT user_id FROM users ORDER BY user_id;')" = "$users_before"
test -s "$ANET_PACKAGED_SMOKE_ROOT/profiles/index.json"
echo 'PASS published macOS .224 -> ANet: native bundle replaced, identity retained, local account usable, existing users retained'
# All bundles/data are under the unique runner temp path; retained for diagnosis.
