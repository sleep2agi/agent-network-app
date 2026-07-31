# Mobile App vs Web Dashboard — feature parity checklist

Produced 2026-07-31 alongside issue #8 avatar port, per 通信龙 dispatch 8323008a:
> 「等功能」那部分 Vincent 这句是开放的. 你顺带产出一份「App 比 Web 少了什么」的清单 — 逐条写: 功能名 / web 有 app 没有 / 大概要多少工作量. 我拿这份去问他还要哪些, 不要自己扩范围去做.

**Not a proposal, not a plan** — just an enumeration for lead + Vincent to decide what to prioritize. All estimates are rough (hours order-of-magnitude, not committed).

## Scope

Comparison base:
- App: `agent-network-app` HEAD `6f92bcd` on `fix/511-attachment-download-status`, 6 top-level screens
- Web: `dash-loop-wt` HEAD `ac4e53b4` (deployed as commhub-server dashboard `preview.35`), 15+ top-level pages/routes

## What App HAS (baseline for compare)

| Screen | Purpose |
|---|---|
| `MessagesScreen.tsx` | Message list (per-alias threads) |
| `ChatScreen.tsx` | Per-alias chat with send + attachments |
| `ServerScreen.tsx` | Server connection / bootstrap |
| `SettingsScreen.tsx` | App-level settings |
| `CreateNodeWizardScreen.tsx` | Node creation wizard |
| `HostSupervisorPickerScreen.tsx` | Host/supervisor selection at login |
| `AliasAvatar.tsx` | Alias → colored letter pill (this PR: + illustration) |
| `AuthedThumb.tsx` | Authenticated thumbnail loader |

## App is MISSING (vs. Web)

Ordered by likely user value, not by size.

| # | Feature | Web has | App status | Rough work |
|---|---|---|---|---|
| 1 | **Avatar illustration pool** (level 3 pool + level 2 named) | dash-loop-wt R47-R49 | ⚠ **This PR** (#8) | 2h (in flight) |
| 2 | **User override avatar** (level 1, node settings UI) | dash-loop-wt R24 (localStorage) | ✗ | 4-6h (needs AsyncStorage plumb + settings UI entry) |
| 3 | **Nodes list page** (browse all nodes in a network) | web `/nodes` | ✗ (only Create wizard exists) | 6-10h (needs list, filter, per-node detail nav) |
| 4 | **Single-node detail page** (status, tasks, logs, config) | web `/node/[id]` | ✗ | 8-12h (multi-tab detail screen) |
| 5 | **Tasks page** (list, filter, dispatch, retry) | web `/tasks` | ✗ (only in-chat reply flow) | 12-16h (task list + dispatch + status transitions) |
| 6 | **Server logs viewer** (live tail, filter, level) | web `/server-logs` | ✗ | 6-8h (log stream WS + filter chips) |
| 7 | **Providers panel** (vendor picker, model list, key management) | web `/providers` | ✗ | 10-14h (matrix + secure key input on mobile) |
| 8 | **Admin panel** (user list, role changes, network members) | web `/admin` | ✗ | 8-10h (usually not needed on mobile — deferred) |
| 9 | **Topo graph view** (interactive node graph with illustrations) | web (TopoGraph, R49) | ✗ | 20-30h (RN doesn't have SVG-based graph libs at web's ergonomics; likely needs react-native-svg + custom layout) |
| 10 | **Dashboard homepage / overview** (network health, activity) | web `/` (page.tsx) | ✗ (app opens directly into MessagesScreen) | 4-6h |

Sub-total (if all done, order-of-magnitude): **60-100h of engineering + design time**.

## Web is MISSING or MOBILE-BETTER (vs. App)

For completeness — not everything is App-catching-up.

| # | Feature | App has | Web status |
|---|---|---|---|
| 1 | Native push notifications | (planned in TestFlight builds) | Web-side is browser Notifications API (limited) |
| 2 | Offline-capable message drafts | Partial (needs verification) | Web loses on tab close |
| 3 | Camera-attach flow | Native picker | Web is file picker only |
| 4 | Host supervisor pick at login | `HostSupervisorPickerScreen` | Web doesn't need this shape (single origin) |

## Ambiguous / clarify with Vincent

| # | Item | Question |
|---|---|---|
| A | "头像**等**功能" — the 等 word | Is Vincent implying #2 (user override), or #3-10 broadly, or something else entirely? |
| B | Dashboard has drag-drop reorder in some tables | Does mobile equivalent make sense (long-press-and-drag)? |
| C | Task attachments preview shows PDF/img inline on web | Should mobile match, or send-to-external-viewer intent? |

## Recommendation on next step

Ship this PR (issue #8, avatars level 2+3 only) to give Vincent something visible. Use his feedback on **which items from the table above** to decide the follow-up order. Do NOT auto-schedule any of the below without a Vincent-signed pick — 通信龙 explicit: 「拿这份去问他还要哪些, 不要自己扩范围去做」.

## Provenance

- 通信龙 dispatch task `8323008a` (2026-07-31)
- Vincent original: "安卓和苹果App都记得更新一下头像等功能"
- Enumeration method: `ls src/*.tsx` (app) vs `ls dash-loop-wt/app/` (web), plus known R-series loop feature list from dashboard git log `--grep="avatar\|头像"`
- Estimates are engineer-months eyeball, NOT committed timelines. Design + QA overhead extra.
