# Node source command palette

The create wizard opens `NodeSourceLauncher`: select a real OpenCode V2
source belonging to the chosen daemon, then browse its authorized directory.
`SourceForkDialog` opens the same `NodeSourcePalette`. `CloneNodeDialog`
uses the shared `palette-kit` shell and keeps its existing clone transport.
Search, project grouping, selection and submission logic live in
`node-source-palette.ts`; no provider names, agents or projects are fabricated.

## Contracts retained

- Project-new: exactly `selection_scope`, `snapshot_id`, `project_id`,
  `child_name`, `intent_id`.
- Attach: exactly `selection_scope`, `snapshot_id`, `session_id` (opaque
  `oses_`), `child_name`, `intent_id`. No `project_id` in the same request.
- Fork: exactly `network_id`, `source_node_id`, native `session_id` (`ses_`),
  `mode=fork_independent`, `child_name`, `intent_id`. Each candidate retains
  its actual source node ID. No conversion of directory IDs to native IDs.
- Clone: the existing `cloneDraft` / `clone_node` request is unchanged:
  `source_node_id`, `name`, `copy_session`, `workdir_policy`, with the existing
  optional `daemon_node_id` and `network_id`.

The selected server request is polled for its own snapshot. Neither the initial
server listing nor a guessed daemon/source identity authorizes submission.
Errors retain the backend code; no ordinary-create fallback is performed.
Registration receipts do not imply runtime health. An existing fork receipt is
queried, not POSTed again. Intent names cannot mutate in place.

## Explicit limitations

- Fork does **not** accept a target directory: no cross-directory fork support
  is claimed. Selecting a project for a new session is not a fork.
- Existing directory transport requires a source node. A daemon with no eligible
  source cannot enumerate projects through this UI; it displays an empty state.
- No arbitrary local folder browser or invented OpenCode Server catalogue.
- Rendered drive fixtures are synthetic. They do not establish live Hub/native
  acceptance, Mac/Windows installation, publication or real user-token behavior.
- No release version bump, protected-branch push or publication is part of this
  change.

## Verification entry points

`tests/node-source-palette/drive.mjs` mounts the production React screens using
the existing Tauri/Hub fixture harness. It checks exact outbound fields, a
different snapshot after server selection, actual fork-source identity,
search/empty/error states, copy and new-node entry, keyboard navigation and
bounded desktop/phone layout. It is registered in `tests/drives.json`.

Screenshots and execution logs are external artifacts under
`/tmp/opencode/fork-palette-shots/` and `/tmp/opencode/fork-palette-*.log`; consult
actual exit codes, not this document, for pass/fail evidence.
