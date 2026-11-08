# Node source palette verification (2026-11-08)

Branch: `feat/node-source-palette`.
Product commits: `10c7c756` and `1e72aa3d220f3950f29b7540677edd65bc1fcf6a`.
Base: `9a76145d789802708c71d126e247a30fe27f222d`.
Worktree: `/tmp/opencode/app-node-source-palette`.

## Completed checks

The background shell `sh_1ba758e6e001xLy90NCjXoBIPr` ran each command
sequentially with exit-on-error and completed with `All final checks exit=0`.

| Check | Result | Log under `/tmp/opencode/` |
| --- | --- | --- |
| `npm run typecheck` (Node 22.22.2) | exit 0 | `fork2-final-typecheck.log` |
| `bun run src/node-source-palette.test.ts` (Bun 1.3.14) | 52/52, exit 0 | `fork2-final-unit-node-source-palette.log` |
| `bun run src/wizard-choice-filter.test.ts` | 13/13, exit 0 | `fork2-final-unit-wizard-choice-filter.log` |
| `bun run src/session-source-fork.test.ts` | 23/23, exit 0 | `fork2-final-unit-session-source-fork.log` |
| `bun run src/session-source-directory.test.ts` | 20/20, exit 0 | `fork2-final-unit-session-source-directory.log` |
| `bun run src/session-project-create.test.ts` | 20/20, exit 0 | `fork2-final-unit-session-project-create.log` |
| `bun run src/node-clone.test.ts` | 29/29, exit 0 | `fork2-final-unit-node-clone.log` |
| `bun run src/drive-registry.test.ts` | 12/12, exit 0 | `fork2-final-unit-drive-registry.log` |
| `npx expo export -p web --output-dir /tmp/opencode/fork2-final-web` | exit 0 | `fork2-final-export.log` |
| `node tests/node-source-palette/drive.mjs` | 68/68, exit 0 | `fork2-final-drive.log` |
| `node tests/opencode-v2-create/drive.mjs` | exit 0 | `fork2-final-existing-opencode-v2-create.log` |
| `node tests/test-session-control/drive.mjs` | 22 assertions, exit 0 | `fork2-final-existing-test-session-control.log` |
| `node tests/test-create-node-wizard-layout/drive.mjs` | 0 failures, exit 0 | `fork2-final-existing-test-create-node-wizard-layout.log` |

Browser environment: Playwright from
`/home/vansin/agent-network-dashboard/node_modules/playwright/index.mjs`,
Chromium `chromium-1234/chrome-linux64/chrome`, `WEB_DIR` set to the export
above. The source and expected-source variables for the existing V2 drive were
both set to the product HEAD. No account token or live Hub is used.

The drive tests different initial/selected snapshots, exact five/six-field
requests, source/session pairing, unknown request lockout, actual error codes,
keyboard navigation, new-node entry and copy, plus viewport bounds in phone
error state. It does not prove native backend acceptance.

## Screenshots

`/tmp/opencode/fork2-shots/` contains:

- `desktop-list.png`, `desktop-search.png`, `desktop-selected.png`,
  `desktop-error.png`: CSS viewport 1280×900.
- `phone-list.png`, `phone-search.png`, `phone-selected.png`,
  `phone-error.png`: CSS viewport 390×844, device pixel ratio 2.
- Additional `desktop-clone.png` and `desktop-directory-closed.png`.

The phone error screenshot was inspected after the viewport fix: title, search,
confirmation and the real error code remain visible; only the list shrinks and
scrolls.

## Preserved failed evidence

Earlier `fork2-typecheck-*` logs contain missing required presentation props,
subsequently fixed. `fork2-drive-1.log` and `fork2-drive-2.log` preserve harness
timing failures (waiting on the initial rather than selected snapshot, then
trying to switch selection before the previous submission had settled).
The driver now waits for the selected snapshot and the busy state to clear;
assertions were not relaxed. The later unknown-submit assertion explicitly
checks RN Web `aria-disabled` and `tabindex`, not a native-button-only property.
The final cleanup removes debug prints/fixed delays and uses a state wait.
Its independent rerun (`sh_1ba7abf12001cxlo6Rv22x13x9`) also exited 0;
log: `/tmp/opencode/fork2-final-drive-clean.log`.

Earlier aggregate `bun test` output was not used as the final oracle: these are
script-style tests, and an exception in the registry module could still leave
the aggregate command green. The final run executes all seven scripts with
`bun run` independently and checks each exit code.

No version change, protected branch push, release tree edit, package publication,
native Mac/Windows acceptance or cross-directory fork is claimed. See
`node-source-palette.md` for the unchanged contracts and data-source limitations.
