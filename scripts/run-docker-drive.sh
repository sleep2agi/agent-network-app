#!/usr/bin/env bash
# Runs one "docker" drive from tests/drives.json: its Dockerfile builds the bundle (after the suite's own unit checks),
# the image copies it to /output, then the drive runs in the Playwright image against that bundle.
#   bash scripts/run-docker-drive.sh <tests dir> <image dir (the suite whose Dockerfile builds the bundle)> <out dir>
# Used by .github/workflows/drives.yml (nightly); same steps as each suite's README.
set -euo pipefail
suite=$1; image=$2; out=$(realpath -m "$3")
mkdir -p "$out"
docker build -f "tests/$image/Dockerfile" -t "drive-$image" .
docker run --rm -v "$out:/output" "drive-$image"
docker run --rm --ipc=host -v "$out:/output" -v "$PWD/tests:/tests:ro" -e BUNDLE=/output/phone-board.js \
  mcr.microsoft.com/playwright:v1.58.2-noble \
  sh -c "npm install --prefix /tmp/runner --no-audit --no-fund playwright@1.58.2 >/dev/null 2>&1 && PLAYWRIGHT_MODULE=/tmp/runner/node_modules/playwright/index.mjs timeout 900 node /tests/$suite/drive.mjs"
