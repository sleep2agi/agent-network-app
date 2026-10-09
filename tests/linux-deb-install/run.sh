#!/usr/bin/env bash
set -euo pipefail
test "$(id -u)" -ne 0
printf 'TEST ONLY source=%s deb_sha256=%s uid=%s\n' "$TEST_DEB_SOURCE_COMMIT" "$TEST_DEB_SHA256" "$(id -u)"
test "$(dpkg-query -W -f='${Status}' a-net)" = 'install ok installed'
desktop_executable=${TEST_DESKTOP_EXECUTABLE:-/usr/bin/agent-network-desktop}
"$desktop_executable" >/evidence/application.log 2>&1 &
desktop_pid=$!
trap 'kill "$desktop_pid" 2>/dev/null || true; wait "$desktop_pid" 2>/dev/null || true' EXIT
found=0
for attempt in $(seq 1 100); do
  if ! kill -0 "$desktop_pid" 2>/dev/null; then
    cat /evidence/application.log
    echo 'FAIL: desktop process exited before window acceptance' >&2
    exit 1
  fi
  xwininfo -root -tree > /evidence/windows.txt
  if grep -E '"ANet".*1200x800' /evidence/windows.txt >/dev/null; then
    found=1
    break
  fi
  sleep 0.3
done
if test "$found" -ne 1; then
  cat /evidence/application.log /evidence/windows.txt
  echo 'FAIL: expected ANet window not found' >&2
  exit 1
fi
# Allow the embedded WebView to paint; image review is a separate acceptance step.
sleep 5
kill -0 "$desktop_pid"
import -window root /evidence/desktop.png
test -s /evidence/desktop.png
cat /evidence/windows.txt
cat /evidence/application.log
echo 'RESULT: WINDOW PRESENT; screenshot needs review, not GUI/IPC acceptance'
