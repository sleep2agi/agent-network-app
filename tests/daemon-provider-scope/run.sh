#!/bin/sh
set -eu
bun --version
bun src/daemon-runtime-providers.test.ts
bun src/provider-create-options.test.ts
bun src/opencode-create-options.test.ts
