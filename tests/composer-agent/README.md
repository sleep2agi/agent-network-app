# Composer Build / Agent

Production `ChatScreen` / `ComposerModelPalette` mounted with synthetic Hub data.
No localhost OpenCode access, native PATCH, node implementation or live account mutation.

## Contract

- Only `GET /api/nodes/:id/config` supplies `opencode_agent_config_capable`,
  `agent` and `agents`. Missing/false capability or empty/missing list hides the
  entire section. Missing current value is unknown, never the first list item.
- Keep native ID order, dedupe first occurrence, retain internal agent names.
- Canonical MCP `update_node_config` uses **only** `patch: { agent }`, the node
  ID and read config revision. Model/variant/flags are not bundled into it.
- Queue acceptance is not success. Only this update ID's `applied` ACK **and**
  exact agent readback move the check. Bounded GET polling never replays a write.
- Shared model/variant/agent single-flight lock blocks duplicate submissions.
  Hub errors (`agent_unsupported`, `invalid_patch`, `timeout`) remain visible.
- Tab focuses agent rows; Up/Down navigates, Enter applies, Escape closes the
  existing model panel. No extra composer entry is added.

## Verification

```sh
npm run typecheck
bun run src/composer-agent.test.ts
bun run src/composer-model-palette.test.ts
bun run src/drive-registry.test.ts
npx expo export -p web --output-dir /tmp/opencode/composer-agent-web
WEB_DIR=/tmp/opencode/composer-agent-web node tests/composer-agent/drive.mjs
```

Optional `PLAYWRIGHT_MODULE`, `CHROMIUM_PATH`, `SHOT_DIR` select cached tooling
and evidence paths. The drive is registered in `tests/drives.json`.
Coverage includes desktop 1280×900 / phone 390×844, hidden section cases,
unknown current, keyboard apply, canonical patch, ACK/readback mismatch,
wrong update ID, accepted/pending timeout, duplicate lock and raw Hub errors.
Existing composer model/variant/input-layout drives remain unchanged.

Screenshots are synthetic-client evidence, not live Hub→node→native acceptance
or Mac/Windows install verification. No app version or release files change.
