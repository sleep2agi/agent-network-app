# Composer effective variant fixture

Uses the existing `test-layout-sweep/harness.mjs` synthetic IPC fixture and a
production Expo web export. It mounts the real ChatScreen and NodeModelSection.
No production credentials, Hub, daemon, or native OpenCode session are used.

Follow root `AGENTS.md`: Node 22, Bun 1.3.14; read Expo SDK 56 versioned docs.
Reuse already installed read-only dependencies. No install is required by this test.

```sh
EXPO_OFFLINE=1 EXPO_NO_TELEMETRY=1 node node_modules/expo/bin/cli export --platform web --output-dir /tmp/opencode/composer-variant-web-verified
WEB_DIR=/tmp/opencode/composer-variant-web-verified PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROMIUM_PATH=/path/to/chrome node tests/composer-variant/drive.mjs
npm run typecheck
```

The mounted checks cover effective/config-selected/status provenance, same-model
variant writes and explicit null clear, same-turn singleflight, rejected writes,
wrong update ID and nonterminal readback, suspended-timer expiry, late A response
after changing to B, and missing variant fields on old nodes. The ck-style tests
under `src/` cover label/i18n, scope identity/expiry and exact ack matching.

The footer does **not** fetch config itself or keep the panel mounted. Until the
existing panel reads config, its variant is unknown. Snapshots expire after 35s;
reopen the panel to refresh. An accepted write without a matching terminal ack
and matching effective readback is unconfirmed, not success.

This fixture is not macOS/Windows/native-runtime acceptance, and does not claim
an independent live-native readback or that a release was published.
