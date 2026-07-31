# Mobile App vs Web Dashboard — feature parity checklist

Produced 2026-07-31 alongside issue #8 avatar port, per 通信龙 dispatch 8323008a.
**Corrected 2026-07-31** per 通信龙 catch (5a8783bd + d5254392 + c7ac1905) — row 3 originally listed the App as missing a nodes list page, which was wrong. This revision rebuilds evidence per row via **positive enumeration**, not grep-by-name.

**Document grade**: **decision-input**. Numbers here have been (and will be) used to schedule engineering. Precision requirement is higher than a "备忘". Evidence per row is cited to `file:line` so the derivation is inspectable; failure modes are documented.

## Method (why the previous version had a wrong row)

The original checklist enumerated App capabilities by `ls src/*Screen*.tsx` (6 files) and by grepping candidate names (`TasksScreen`, `LogsScreen`, `NodeDetail`, ...) for each web feature. Both are unreliable ways to prove absence:

- `ls Screen*.tsx` misses **inline** screens declared as top-level functions inside `App.tsx` (like `AgentsScreen`, App.tsx:317). The file-name filter had a silent hole.
- `grep <name-I-guessed>` silently returns zero hits when the actual name is different. "0 hits" ≠ "does not exist".

**Corrected method** (通信龙 d5254392): enumerate what App **has**, then check whether each web feature is in the list. Enumeration failure mode is "range wrong" (writable, checkable). Name-search failure mode is "name guessed wrong" (silent).

### Enumeration of App's full capability surface (base = origin/main @ 0762707, post-#8 merge)

**All top-level function declarations in `App.tsx`** (line + name):
- `App.tsx:90` `AppRoot` — root, routing between screens
- `App.tsx:233` `LoginScreen` — hub URL + user token entry
- `App.tsx:317` `AgentsScreen` — **the nodes list page** (see row 3)

No other top-level screen functions exist in `App.tsx`.

**All `src/*.tsx` files and their exported components** (on `main`, not counting in-flight branches):

| File | Exports (component-shaped) |
|---|---|
| `src/AliasAvatar.tsx` | `AliasAvatar` (default) |
| `src/AuthedThumb.tsx` | `AuthedThumb`, `AuthedFullImage`, `RemoteMedia` |
| `src/ChatScreen.tsx` | `ChatScreen` (default) |
| `src/CreateNodeWizardScreen.tsx` | `CreateNodeWizardScreen` (default) |
| `src/HostSupervisorPickerScreen.tsx` | `HostSupervisorPickerScreen` (default) |
| `src/MessagesScreen.tsx` | `MessagesScreen` (default) |
| `src/ServerScreen.tsx` | `ServerScreen` (default) |
| `src/SettingsScreen.tsx` | `SettingsScreen` (default) |

**Tab bar** (`App.tsx:46-51`, `const TABS`): 4 tabs — `agents` / `messages` / `server` / `settings`.

That is the App's `main` surface as of `origin/main@0762707`. Every "missing" claim below is checked against this enumeration, not against a name grep.

## App HAS (on main)

| # | Component | File:Line | Notes |
|---|---|---|---|
| — | Nodes list page | `App.tsx:317-560` (AgentsScreen) | Full SectionList w/ team grouping (Vincent tg 1094), rank sort, disk cache, 10s polling — details in row 3 |
| — | Per-agent chat | `src/ChatScreen.tsx` | Chat + attachments |
| — | Messages inbox tab | `src/MessagesScreen.tsx` (imported at `App.tsx:23`) | 4-tab: TABS[1] |
| — | Server connection status | `src/ServerScreen.tsx` (149 lines) | `已连接`/`连接失败` (L67) + working count (L48); **no log tail** |
| — | Settings (user/network/logout) | `src/SettingsScreen.tsx` (152 lines) | user + network + logout; **no provider/admin management** |
| — | Create node wizard | `src/CreateNodeWizardScreen.tsx` | After picker |
| — | Host supervisor picker | `src/HostSupervisorPickerScreen.tsx` | Before wizard, `#338` |
| — | Alias avatar (illustration pool) | `src/AliasAvatar.tsx` (109 lines) + `src/lib/avatars.ts` (116 lines) | Merged as PR#9 (main `0762707`); djb2 pool + level-2 named override, level-1 user override NOT ported (deferred) |
| — | Authenticated attachment thumb | `src/AuthedThumb.tsx` | Attach preview |

## Rows 1-10 — corrected

| # | Feature | Web ref | App real state (evidence) | Real delta needed | Estimate |
|---|---|---|---|---|---|
| **1** | Avatar illustration pool (levels 2 + 3) | dash-loop-wt R47-R49 | ✅ **DONE** — merged as PR#9 into main `0762707` (`src/lib/avatars.ts:1-116`, `src/AliasAvatar.tsx:1-109`, `assets/avatars/*.webp` × 20 + `intern_avatar.png`) | — | — |
| **2** | User override avatar (level 1) | dash-loop-wt R24 (localStorage + node settings UI) | ✗ **NOT DONE** — enumeration: `src/lib/avatars.ts:12-15` explicitly defers, no AsyncStorage anywhere in `src/` or `App.tsx`; no settings entry point in `SettingsScreen.tsx` (152 lines, only user/network/logout rows) | AsyncStorage plumb + SettingsScreen entry + settings dialog | 4-6h |
| **3** | Nodes list page (browse fleet) | web `/nodes` | ✅ **HAS** — `App.tsx:317-560` (AgentsScreen). Full features: SectionList team-grouped (L440, `renderSectionHeader` w/ `online/total` count at L444-450), online/working/offline rank sort (L384: `rank = working ? 0 : offline ? 2 : 1`), search box shown only when >10 sessions (`sessions.length > 10 ?` at L489), disk cache via `saveSessionsCache`/`loadSessionsCache` (L342/359 — cold-start stale-while-revalidate paint), 10s foreground polling via `usePoll` (L370), pull-to-refresh (L465-472), loading state (L411-416), first-fetch-failed-with-nothing-cached error+retry (L421-437, per Vincent tg 841 — no forever-spinner dead end), tap → `ChatScreen` (via `onOpenChat`, wired in `App.tsx:159`), team grouping per Vincent tg 1094 for 153-agent scale, first-render batch cap tuned for perf (L458 comment). **Hardening in-flight** — 通信龙 32d0a89e dispatched to `通信测试马`: (a) 拼音搜索, (b) 组内排序对齐 web, (c) avatar parity assertion (test) | 3 hardening deltas, in progress | **1-2h** ← ~~was 6-10h~~ (通信龙 catch, 5a8783bd) |
| **4** | Single-node detail page (status / tasks / logs / config, per node) | web `/node/[id]` | ✗ **NOT PRESENT on main** — no NodeDetail-shaped component on main. Note: `通信demo马`'s in-flight branch (row 5) adds a `TaskDetailScreen` for per-**task** detail, which is a different concept from per-**node** detail (task = one dispatched task's status/result/reply; node = one agent's health/config/log stream). Row 4 (per-node) remains unaddressed | New tabbed per-node detail screen | 8-12h |
| **5** | Tasks page (list + filter + dispatch + retry) | web `/tasks` | ⚠ **IN PROGRESS** — 通信龙 32d0a89e dispatched to `通信demo马`. Work exists on branch `app/tasks-screen` (not yet on main, PR not yet open); commit adds pure-additive files (per commit message: no change to `App.tsx` / `MessagesScreen` / `ChatScreen` / any existing screen — wiring is a separate future task held behind row-3's `AgentsScreen` extraction by `通信测试马`). Original assessment ("✗ NOT PRESENT") was based on `main`-only enumeration — the WIP does not yet appear on any pushed branch until demo马 opens the PR. Row will be finalized (final scope, delta, estimate) once demo马's PR lands | Awaiting demo马 PR | 原估 **12-16h**, actual TBD after PR lands |
| **6** | Server logs viewer (live tail / filter / level) | web `/server-logs` | ✗ **NOT PRESENT on main** — `ServerScreen.tsx` is 149 lines total and only surfaces "connected/failed" + working count; no log stream, no filter chips | live log tail (WS/SSE) + filter | 6-8h |
| **7** | Providers panel (vendor picker / model list / key mgmt) | web `/providers` | ✗ **NOT PRESENT on main** — `SettingsScreen.tsx` (152 lines) surfaces user + network + logout only, no provider management | matrix + secure key input (Keychain/Keystore on mobile) | 10-14h |
| **8** | Admin panel (users / roles / members) | web `/admin` | ✗ **NOT PRESENT on main** — no admin-shaped component. Usually not needed on mobile — defer / cheapest to skip | user list + role + members | 8-10h (defer candidate) |
| **9** | Topo graph view (interactive node graph, illustrated) | web (TopoGraph, R49) | ✗ **NOT PRESENT on main** — no graph component. `package.json` `react-native-svg` presence TBD | react-native-svg + custom layout | 20-30h |
| **10** | Dashboard homepage / overview | web `/` (page.tsx) | ⚠ **PARTIAL** — App boots directly into AgentsScreen (`App.tsx:113`: `setScreen({ name: 'agents' })`) which serves as the home. Semantically different from web `/`, which is a network-health/activity overview | If accept AgentsScreen as home: 0h. If want web-style overview widgets: 4-6h | 0-6h (depends on Vincent) |

## Estimate roll-up (order-of-magnitude, arithmetic)

Excluding row 1 (already done) and row 5 (in-flight, actuals TBD). Range depends on whether row 10 is treated as "already there" (0h) or a new overview screen (4-6h):

- **Lower bound**: 4 + 1 + 8 + 6 + 10 + 8 + 20 + **0** = **57h** (row 10 = accept AgentsScreen, row 8 kept)
- **Upper bound**: 6 + 2 + 12 + 8 + 14 + 10 + 30 + **6** = **88h** (row 10 = new overview, row 8 kept)
- If admin panel (row 8) is deferred: subtract 8-10h.
- Row 5 will add its final actual when demo马's PR lands (original 12-16h estimate held for now).

Numbers are engineer-hours eyeball, not committed timelines. Design + QA overhead is separate. Order-of-magnitude only.

## Ambiguous — clarify with Vincent

| # | Item | Question |
|---|---|---|
| A | "头像**等**功能" — the `等` word | Does Vincent mean row 2 (user override avatar), or rows 3-10 more broadly, or something else entirely? |
| B | Dashboard has drag-drop reorder in some tables | Does mobile equivalent (long-press-and-drag) make sense? |
| C | Web task attachments show PDF/img inline preview | Should mobile match, or invoke system viewer via `Linking`? |

## What App HAS that Web is missing (or mobile-better)

| # | Feature | App | Web |
|---|---|---|---|
| 1 | Native push notifications (planned TestFlight builds) | Native | Browser Notifications API (limited) |
| 2 | Offline-capable message drafts | Partial (needs verification) | Web loses on tab close |
| 3 | Camera-attach flow | Native picker | File picker only |
| 4 | HostSupervisorPickerScreen at login | Yes, `src/HostSupervisorPickerScreen.tsx` | N/A (single origin) |

## Recommendation for next step

Ship PR#9 (issue #8) — done, main `0762707`. Wait for Vincent to pick from the above rows before scheduling more. Per 通信龙 dispatch: 拿这份去问 Vincent 还要哪些, 不要自己扩范围去做. Author does NOT auto-schedule any of them. Two rows already in flight (3 hardening → 通信测试马, 5 tasks → 通信demo马); those will land on their own PRs and this doc updates when they do.

## Provenance

- 通信龙 dispatch task `8323008a` (2026-07-31, original)
- 通信龙 catch task `5a8783bd` (2026-07-31, row 3 wrong)
- 通信龙 methodology strengthening task `d5254392` (2026-07-31, positive enumeration principle)
- 通信龙 attribution correction task `c7ac1905` (2026-07-31): row 3 hardening → `通信测试马`, row 5 tasks page → `通信demo马` (earlier author draft had these attributed the other way; the "测试马" mention in demo马's file comment refers to whose work he is *waiting on*, not who is authoring row 5)
- Vincent original ask: 「安卓和苹果App都记得更新一下头像等功能」
- Base for citations of App state on main: `origin/main @ 0762707` (post-#8 merge)
- Enumeration verified via `command grep -nE '^(function|export function)' App.tsx` + `find src -name '*.tsx' -o -name '*.ts'` + reading each file's export list
- Estimates are engineer-hours eyeball, NOT committed timelines. Design + QA overhead extra.

## Meta lesson (documented for future reference)

Two doc-grade concepts to distinguish before producing a checklist:

- **备忘 (memo grade)**: "大概有哪些差距" — quick inventory for orientation. Precision assumed rough.
- **决策输入 (decision-input grade)**: numbers/list will feed engineer-hour scheduling. Precision required is much higher; each conclusion cites evidence.

Both the requester and the producer share the burden of naming the grade **before** the document is used:
- Producer: label the document's grade in the header (this file now says **decision-input**).
- Consumer: before using the document for engineer scheduling, confirm it was produced at the required grade. If it was produced as "顺带", either upgrade it (like this rewrite) or explicitly note the risk in the scheduling artifact.

The prior version of this file was produced at memo grade but used at decision-input grade without upgrading it. Both sides agreed this cost was avoidable. This meta lesson lives here so a future reader of the file understands what its grade is.
