# BTW SideThread App UI — Docker verification

Date: 2026-08-26 (Asia/Shanghai)

Source under test: `0cb9f8cbaab18b6d46c18d9c11c786bd646a198c` (`feat/btw-side-thread-ui`, rebased on desktop `0.2.37`)

## Scope

- shared first-token `/btw` parser, `\/btw` escape, empty-question validation;
- runtime-neutral typed SideThread client and explicit capability gate;
- owner-authorized `question` projection contract for close/reopen and detached-window consistency;
- byte-for-byte schema/golden fixtures shared by Hub PR #1201 (`9a074ccb62d7829e5602ea6b14232b7e467e0cb4`) and command-transport PR #1202 (`8ad03b1ea3c9fcfae085d85070213c9d2dffb5ac`);
- production `appFetch` HTTP integration against a real loopback TCP stub: exact capability/list/create routes, encoded scope, Bearer-only credentials and disabled-route fail-closed behavior;
- creating/running/reconciling/succeeded/failed/cancelled/archived card states;
- ambiguous/reconciling operations are shown as awaiting confirmation and cannot trigger retry, archive, purge or another side effect;
- all six POST kinds turn acknowledgement loss into reconciliation while retaining the caller request key;
- runtime-neutral action controller with synchronous dispatch locking, ambiguous retry key reuse and authoritative bring-back GET hydration;
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
  --build-arg SOURCE_COMMIT=0cb9f8cbaab18b6d46c18d9c11c786bd646a198c \
  -f tests/test-btw-side-thread-ui/Dockerfile \
  -t anet-app-btw-ui:0cb9f8c .'

sg docker -c 'docker run --rm anet-app-btw-ui:0cb9f8c'
```

## Results

- parser and IME contract: 12/12 passed;
- typed API, frozen fixture, ACK-loss and capability contract: 21/21 passed;
- production HTTP transport integration: 7/7 passed;
- runtime-neutral action controller: 4/4 passed;
- card identity/lifecycle/reopen/reconciliation contract: 16/16 passed;
- scope and out-of-order request ownership contract: 4/4 passed;
- shared UI, attachments, accessibility and main-state isolation contract: 30/30 passed;
- TypeScript build check: passed;
- repository regression suite: 55/55 test files passed;
- Expo SDK 56 web export: passed (Metro bundled 474 modules);
- final container line: `PASS BTW SideThread App parser/API/model/shared UI contract @ 0cb9f8cbaab18b6d46c18d9c11c786bd646a198c`.

## Witnessed-red mutations

- force an ambiguous action retry to allocate a new request key: controller test exits 1 (`3/4`);
- remove the authoritative GET after bring-back ACK: controller test exits 1 (`3/4`);
- disable the synchronous in-flight lock: controller test exits 1 (`2/4`, duplicate dispatch observed).

All results above, including the Expo export, were produced inside the same Docker test suite.

## Honesty boundary

The App remains fail-closed until CommHub PR2 is deployed and exposes an explicit supported native exact-fork capability plus the complete v1 owner projection. Missing/disabled/unsupported/incomplete capability or projection is rendered as unsupported; `/btw` is never sent through the ordinary task, priority, or steer lane. Bring-back is not shown as successful until a follow-up authoritative GET contains the completed receipt. HTTP route constants and the update subscription remain centralized so transport evolution does not require UI rewrites.
