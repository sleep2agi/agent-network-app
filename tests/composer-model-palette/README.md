# Composer model command palette

Mounted production `ChatScreen` + `ComposerModelPalette` through the existing
`test-layout-sweep/harness.mjs` synthetic IPC fixture. No Hub, daemon, account,
or native OpenCode session is used.

```sh
EXPO_OFFLINE=1 EXPO_NO_TELEMETRY=1 node node_modules/expo/bin/cli export --platform web --output-dir /tmp/opencode/web-model-picker
WEB_DIR=/tmp/opencode/web-model-picker \
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
CHROMIUM_PATH=/path/to/chromium \
SHOT_DIR=/tmp/opencode/model-picker-shots \
node tests/composer-model-palette/drive.mjs
```

The drive asserts the floating panel shape (search + provider groups + counts),
search filtering by provider/model, the explicit empty state, exactly one
checkmark on the exact `provider/model` current row, footer updates only after a
terminal ACK **and** a matching config readback, wrong update_id / nonterminal
ACK never moving the footer, single-flight double click, unknown variant staying
unknown, and the panel sitting above the composer on 1280×900 and 390×844.
Screenshots are written to `SHOT_DIR`.

Pure logic and its ck tests live in `src/composer-model-palette.ts` and
`src/composer-model-palette.test.ts`.

Limits: this is a react-native-web mount, not macOS/Windows native acceptance,
and the fixture is not a live Hub. The server's catalog schema currently has no
per-model `variants`, so the thinking-level row truthfully renders unknown unless
a synthetic/older snapshot provides `variants`.
