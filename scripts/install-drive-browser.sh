#!/usr/bin/env bash
set -euo pipefail
# Keep this version aligned with the exact browser-cache key and suite images.
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
export DRIVE_PW_PREFIX="${DRIVE_PW_PREFIX:-/tmp/pw}"
npm install --prefix "$DRIVE_PW_PREFIX" --no-audit --no-fund playwright@1.58.2
pw="$DRIVE_PW_PREFIX/node_modules/.bin/playwright"
# Browser caches do not contain OS libraries. Install these separately; the caller
# bounds the entire attempt, including npm/apt, to 270 seconds.
# Playwright otherwise spawns sudo/apt itself: an unprivileged outer timeout
# cannot reliably terminate that root process, leaving dpkg locked on retry.
# Give the privileged process group its own shorter deadline and kill fallback.
sudo timeout --signal=TERM --kill-after=10s 180s "$pw" install-deps chromium
if [[ "${PLAYWRIGHT_CACHE_HIT:-}" == true ]]; then
  echo 'Exact Playwright browser cache hit; skipping browser download.'
else
  "$pw" install chromium
fi
# Cache corruption must fail closed rather than silently download on a cache hit.
node --input-type=module -e '
  const { chromium } = await import(process.env.DRIVE_PW_PREFIX + "/node_modules/playwright/index.mjs");
  const browser = await chromium.launch({ headless: true });
  await browser.close();
'
