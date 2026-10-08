#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
sg docker -c 'docker build -f tests/wix-template-baseline/Dockerfile -t anet-wix-baseline:test .'
sg docker -c 'docker run --rm --cpus=2 --network none anet-wix-baseline:test'
