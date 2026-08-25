# BTW SideThread App UI — Docker verification

Date: 2026-08-26 (Asia/Shanghai)

Source under test: `3ed9f3e6491c` (`feat/btw-side-thread-ui`)

## Scope

- shared first-token `/btw` parser, `\/btw` escape, empty-question validation;
- runtime-neutral typed SideThread client and explicit capability gate;
- owner-authorized `question` projection contract for close/reopen and detached-window consistency;
- byte-for-byte PR2 schema/golden fixtures from `0744c312f9188278f243d4266ddd8acab8493c7b`;
- creating/running/reconciling/succeeded/failed/cancelled/archived card states;
- ambiguous/reconciling operations are shown as awaiting confirmation and cannot trigger retry, archive, purge or another side effect;
- all six POST kinds turn acknowledgement loss into reconciliation while retaining the caller request key;
- `/btw` attachments, retry attachment preservation, authoritative bring-back hydration and synchronous double-tap locking;
- render-time scope ownership, per-scope request sequencing, equal-timestamp terminal precedence and independent-window isolation;
- modal focus/restore, keyboard avoidance, safe-area and live-region accessibility semantics;
- cancel, retry, archive and explicit bring-back actions;
- main window, detached desktop chat and mobile all reuse `ChatScreen`/`SideThreadDrawer`;
- main conversation state isolation and no `/api/task` / `sendTask` fallback;
- two SideThreads completing out of order, stale record rejection, optimistic-create/list overlap;
- IME composition and legacy keyCode 229 protection.

## Commands

```sh
sg docker -c 'docker build \
  --build-arg SOURCE_COMMIT=3ed9f3e6491c \
  -f tests/test-btw-side-thread-ui/Dockerfile \
  -t anet-app-btw-ui:3ed9f3e6491c .'

sg docker -c 'docker run --rm anet-app-btw-ui:3ed9f3e6491c'
```

## Results

- parser and IME contract: 12/12 passed;
- typed API, frozen fixture, ACK-loss and capability contract: 21/21 passed;
- card identity/lifecycle/reopen/reconciliation contract: 16/16 passed;
- scope and out-of-order request ownership contract: 4/4 passed;
- shared UI, attachments, accessibility and main-state isolation contract: 30/30 passed;
- TypeScript build check: passed;
- repository regression suite: 52/52 test files passed;
- Expo SDK 56 web export: passed (Metro bundled 472 modules);
- final container line: `PASS BTW SideThread App parser/API/model/shared UI contract @ 3ed9f3e6491c`.

All results above, including the Expo export, were produced inside the same Docker test suite.

## Honesty boundary

The App remains fail-closed until CommHub PR2 is deployed and exposes an explicit supported native exact-fork capability plus the complete v1 owner projection. Missing/disabled/unsupported/incomplete capability or projection is rendered as unsupported; `/btw` is never sent through the ordinary task, priority, or steer lane. Bring-back is not shown as successful until a follow-up authoritative GET contains the completed receipt. HTTP route constants and the update subscription remain centralized so transport evolution does not require UI rewrites.
