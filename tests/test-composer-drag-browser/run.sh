#!/usr/bin/env bash
# app#240 —— 真浏览器对照(不进 CI:要 playwright + Chromium)。用法:
#   PLAYWRIGHT_MODULE=/path/to/node_modules/playwright/index.mjs bash tests/test-composer-drag-browser/run.sh
set -euo pipefail
cd "$(dirname "$0")"
[ -e node_modules ] || ln -s ../../node_modules node_modules
mkdir -p out
bun build index.tsx --outdir out --target browser --define 'process.env.NODE_ENV="development"' >/dev/null
cp index.html out/index.html
python3 -m http.server "${PORT:-8765}" --directory out >/dev/null 2>&1 &
srv=$!
trap 'kill "$srv" 2>/dev/null || true' EXIT
sleep 1
node drive.mjs
