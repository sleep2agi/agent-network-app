# Client authenticated sender — 2026-08-23

Desktop REST sends now include the authenticated Hub username in `from`.
Fresh logins persist the username with the secure Hub configuration. Configs
saved by older app versions resolve `/api/auth/me` once and cache the recovered
username and network in memory before sending.

## Docker verification

- Image: `tests/test-scheduled-tasks/Dockerfile`
- Runtime: Bun 1.3.14
- REST sender regression checks: 6/6
- Complete app test files: 23/23
- TypeScript (`tsc --noEmit -p tsconfig.build.json`): PASS

