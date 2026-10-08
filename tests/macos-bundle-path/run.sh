#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
sg docker -c 'docker build -f tests/macos-bundle-path/Dockerfile -t anet-macos-bundle-path:test .'
sg docker -c 'docker run --rm --cpus=2 anet-macos-bundle-path:test'
