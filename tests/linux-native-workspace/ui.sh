#!/bin/bash
set -euo pipefail
test "$(id -u)" != 0
test ! -e "$ANET_PACKAGED_SMOKE_ROOT"
printf 'TEST ONLY source=%s deb_sha256=%s uid=%s\n' "$TEST_DEB_SOURCE_COMMIT" "$TEST_DEB_SHA256" "$(id -u)"
/usr/bin/agent-network-desktop >/evidence/application.log 2>&1 &
app_pid=$!
trap 'kill "$app_pid" 2>/dev/null || true; wait "$app_pid" 2>/dev/null || true' EXIT
window=''
for attempt in $(seq 1 100); do
  kill -0 "$app_pid" || { echo 'FAIL: desktop exited before UI'; exit 1; }
  window=$(xdotool search --onlyvisible --name '^ANet$' 2>/dev/null | head -1 || true)
  test -z "$window" || break
  sleep 0.3
done
test -n "$window"
xdotool getwindowgeometry "$window" >/evidence/geometry.txt
grep -F 'Geometry: 1200x800' /evidence/geometry.txt
sleep 5
import -window root /evidence/before.png
# Pinned 1200x800 welcome layout. Review before.png to validate this target.
# Negative mode clicks non-interactive background, never a different action.
if [ "${TEST_UI_MISS_CLICK:-0}" = 1 ]; then
  xdotool mousemove --window "$window" 30 30 click 1
else
  xdotool mousemove --window "$window" 600 470 click 1
fi
for attempt in $(seq 1 100); do
  kill -0 "$app_pid" || { echo 'FAIL: desktop exited after click'; exit 1; }
  test ! -s "$ANET_PACKAGED_SMOKE_ROOT/profiles/index.json" || break
  sleep 0.3
done
import -window root /evidence/after.png
test -s "$ANET_PACKAGED_SMOKE_ROOT/profiles/index.json" || { echo 'FAIL: UI did not persist a local profile after click'; exit 1; }
python3 /fixture/verify-session.py
sleep 3
import -window root /evidence/after.png
echo 'PASS: UI click persisted native profile and authenticated Hub; screenshots require review'
