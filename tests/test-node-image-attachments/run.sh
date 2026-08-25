#!/bin/sh
set -eu

# Atomic attachment behavior first; do not let a broad green hide a broken
# parser/auth/cache layer. Only after these pass do we run the repository gates.
bun src/chat-attachment-display.test.ts
bun src/web-image-download.test.ts
bun src/attach-download.test.ts
bun run scripts/run-tests.mjs
bunx tsc --noEmit -p tsconfig.build.json

# Replay scrub-guard's public-source scan inside the same clean image.
FILES=$(
  find src -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' \)
  find docs -type f -name '*.md'
  ls App.tsx
  ls ./*.md 2>/dev/null || true
)
COUNT=$(printf '%s\n' "$FILES" | sed '/^$/d' | wc -l | tr -d ' ')
[ "$COUNT" -gt 0 ] || { echo 'scrub scanned zero files'; exit 1; }
if printf '%s\n' "$FILES" | xargs grep -En '\[\[[a-z0-9][a-z0-9_-]*\]\]|(~|/home/[^/[:space:]]+|/Users/[^/[:space:]]+)?/?\.claude/(projects/[^/[:space:]`)]+/)?memory/|agent-orchestra/memory/' ; then
  echo 'scrub found internal memory reference'
  exit 1
fi
echo "node image attachments: tests/typecheck/scrub passed ($COUNT scrub files)"
