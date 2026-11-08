# Chat: fork current node

Entry: chat header `⋯` → **Fork current node**. No composer control or layout
change. `ChatForkPalette` reads fresh scoped `/api/status` and `/api/nodes`,
rejecting missing/ambiguous identities and non-V2 nodes before preselection.
`NodeSourcePalette` is reused in fork-only mode, with exactly the current source
candidate; this entry never fetches a project directory or creates an empty
session as a fallback.

Transport is unchanged: exactly `network_id`, `source_node_id`, native
`session_id` (`ses_`), `mode=fork_independent`, `child_name`, `intent_id`.
There is no target directory field. An unknown receipt disables another POST;
only its existing request is polled. Missing current native ID shows the reason
and leaves no selected candidate. A backend refusal retains its error code.

## Run

```sh
npm run typecheck
bun run src/chat-fork-source.test.ts
bun run src/chat-info-model.test.ts
bun run src/node-source-palette.test.ts
bun run src/session-source-fork.test.ts
bun run src/drive-registry.test.ts
npx expo export -p web --output-dir /tmp/opencode/chat-fork-web
WEB_DIR=/tmp/opencode/chat-fork-web \
SHOT_DIR=/tmp/opencode/chat-fork-shots \
node tests/chat-fork-entry/drive.mjs
```

Set `PLAYWRIGHT_MODULE` and `CHROMIUM_PATH` when using cached browser tools.
The drive is registered in `tests/drives.json` and mounts production React with
synthetic transport. Desktop 1280×900 and phone 390×844 each generate entry,
open, selected and failure screenshots. It also checks missing native ID,
unknown, exact request fields and unchanged composer dimensions.

This is not a live Hub/native acceptance test, Mac/Windows installation,
cross-project fork implementation, or publication. Existing composer assertions
are not edited. Run the existing node-source-palette and composer-model-palette
drives against the same export as regression gates.
