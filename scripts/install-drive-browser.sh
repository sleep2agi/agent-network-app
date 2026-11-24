#!/usr/bin/env bash
set -euo pipefail
phase() {
  local name="$1" started status
  shift
  started=$SECONDS
  printf 'browser-install phase=%s event=start utc=%s\n' "$name" "$(date -u +%FT%TZ)"
  if "$@"; then status=0; else status=$?; fi
  printf 'browser-install phase=%s event=end elapsed_seconds=%s exit=%s utc=%s\n' \
    "$name" "$((SECONDS - started))" "$status" "$(date -u +%FT%TZ)"
  if (( status != 0 )) && [[ "$name" == dpkg-repair || "$name" == os-dependencies ]]; then
    # Read-only evidence. Use process names, not arguments that might contain credentials.
    # Diagnostics must not replace the original failing status or hang the retry.
    printf 'browser-install phase=%s event=lock-diagnostics\n' "$name"
    timeout --signal=TERM --kill-after=1s 5s ps -eo pid,ppid,pgid,sid,stat,etime,comm --forest || true
    timeout --signal=TERM --kill-after=1s 5s sudo -n lslocks --output PID,COMMAND,TYPE,MODE,PATH || true
  fi
  return "$status"
}
# Keep this version aligned with the exact browser-cache key and suite images.
export DRIVE_PW_PREFIX="${DRIVE_PW_PREFIX:-/tmp/pw}"
phase npm env PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --prefix "$DRIVE_PW_PREFIX" --no-audit --no-fund playwright@1.58.2
pw="$DRIVE_PW_PREFIX/node_modules/.bin/playwright"
# A prior timed-out apt attempt may have unpacked packages. Repair that state
# before retrying; never delete dpkg locks or ignore configuration failures.
phase dpkg-repair sudo timeout --signal=TERM --kill-after=5s 30s dpkg --configure -a
# 2026-11-24: the runners' only mirror (us-east-2.ec2.archive.ubuntu.com) served
# a few hundred KB in 10-25 s and os-dependencies hit its 180 s limit on every
# retry (app#1701). Ubuntu 24.04 runners pick mirrors from apt-mirrors.txt and
# fail over in order, so put two other official mirrors first, and skip the
# Translation-* indexes nobody here reads. Best effort: a runner without the
# mirror list keeps its sources untouched.
apt_mirror_fallback() {
  local list=/etc/apt/apt-mirrors.txt
  echo 'Acquire::Languages "none"; Acquire::http::Timeout "20"; Acquire::Retries "2";' \
    | sudo tee /etc/apt/apt.conf.d/90-drive-install >/dev/null
  [[ -f "$list" ]] || return 0
  grep -q '^http://azure.archive.ubuntu.com/ubuntu' "$list" && return 0
  { printf 'http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\n'
    printf 'http://archive.ubuntu.com/ubuntu/\tpriority:2\n'
    cat "$list"; } | sudo tee "$list.new" >/dev/null
  sudo mv "$list.new" "$list"
}
phase apt-mirror-fallback apt_mirror_fallback
# Browser caches do not contain OS libraries. Install these separately; the caller
# bounds the entire attempt, including npm/apt, to 270 seconds.
# Playwright otherwise spawns sudo/apt itself: an unprivileged outer timeout
# cannot reliably terminate that root process, leaving dpkg locked on retry.
# Give the privileged process group its own shorter deadline and kill fallback.
phase os-dependencies sudo timeout --signal=TERM --kill-after=10s 180s "$pw" install-deps chromium
if [[ "${PLAYWRIGHT_CACHE_HIT:-}" == true ]]; then
  echo 'Exact Playwright browser cache hit; skipping browser download.'
else
  phase browser-download "$pw" install chromium
fi
# Cache corruption must fail closed rather than silently download on a cache hit.
phase browser-launch node --input-type=module -e '
  const { chromium } = await import(process.env.DRIVE_PW_PREFIX + "/node_modules/playwright/index.mjs");
  const browser = await chromium.launch({ headless: true });
  await browser.close();
'
