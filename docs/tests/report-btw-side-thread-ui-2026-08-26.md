# BTW SideThread App UI — Docker verification

Date: 2026-08-26 (Asia/Shanghai)

Source under test: `8f36dd8fa7c5` (`feat/btw-side-thread-ui`)

## Scope

- shared first-token `/btw` parser, `\/btw` escape, empty-question validation;
- runtime-neutral typed SideThread client and explicit capability gate;
- owner-authorized `prompt` projection contract for close/reopen and detached-window consistency;
- creating/running/reconciling/succeeded/failed/cancelled/archived card states;
- ambiguous/reconciling operations are shown as awaiting confirmation and cannot trigger retry, archive, purge or another side effect;
- cancel, retry, archive and explicit bring-back actions;
- main window, detached desktop chat and mobile all reuse `ChatScreen`/`SideThreadDrawer`;
- main conversation state isolation and no `/api/task` / `sendTask` fallback;
- two SideThreads completing out of order, stale record rejection, optimistic-create/list overlap;
- IME composition and legacy keyCode 229 protection.

## Commands

```sh
sg docker -c 'docker build \
  --build-arg SOURCE_COMMIT=8f36dd8fa7c5 \
  -f tests/test-btw-side-thread-ui/Dockerfile \
  -t anet-app-btw-ui:8f36dd8fa7c5 .'

sg docker -c 'docker run --rm anet-app-btw-ui:8f36dd8fa7c5'
```

## Results

- parser and IME contract: 12/12 passed;
- typed API, capability and update-subscription contract: 10/10 passed;
- card identity/lifecycle/reopen/reconciliation contract: 12/12 passed;
- shared UI and main-state isolation contract: 24/24 passed;
- TypeScript build check: passed;
- repository regression suite: 51/51 test files passed;
- Expo SDK 56 web export: passed (Metro bundled 470 modules);
- final container line: `PASS BTW SideThread App parser/API/model/shared UI contract @ 8f36dd8fa7c5`.

All results above, including the Expo export, were produced inside the same Docker test suite.

## Honesty boundary

The App remains fail-closed until CommHub PR2 exposes an explicit supported capability and the reviewed SideThread routes. Missing/disabled/unsupported capability is rendered as unsupported; `/btw` is never sent through the ordinary task, priority, or steer lane. HTTP route constants and the update subscription are centralized so PR2 REST/SSE finalization requires one adapter change rather than UI rewrites.
