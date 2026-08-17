# #338 Mobile App — host_supervisor picker (DESIGN DRAFT)

> Status: design draft for 通信龙 review + Vincent surface BEFORE code.
> Repo: sleep2agi/agent-network-app · base: origin/main (HEAD 93b90c3)
> Scope: RFC-026 §9.4 3-state picker on mobile (Expo/React Native), shared API contract with dashboard PR4.
> Author: 通信工程马

---

## Why this doc instead of straight code

通信龙 dispatch on mobile picker: **"先出设计 (截图/mockup) 我看 + surface Vincent 过 UX 再大铺代码 — Vincent 对 app UX 在意"**. So this PR is design-only — no `.tsx` produced until UX is locked.

## Constraints (locked, do not re-litigate)

- **Framework**: Expo / React Native (NOT native Swift). RN primitives only — no CSS classnames or grid.
- **Theme**: must reuse the existing `src/theme.ts` palette (DARK/LIGHT) and `spacing` scale, NOT introduce new tokens. Mirror the visual language already in `ServerScreen` / `SettingsScreen` (cards w/ border + rounded corners + divider rows + section-muted headers).
- **API**: same contract as dashboard PR4 — `GET /api/host-supervisors` (preview.8 hub), returns `{ok, count, daemons[{daemon_node_id, alias, hostname, runtimes_supported, host_telemetry:{alert_level, cpu_cores, mem_gb}}]}`.
- **3 states**, per RFC-026 §9.4: `count=0` onboarding · `count=1` auto-pick · `count≥2` picker list.
- **No new TestFlight build for this alone** — batched into the next app release with other changes.

## Entry point

Add a `+` button in the existing Agents tab header (top-right). Tapping opens a modal stack with the picker screen at root. (App currently has no create-node flow at all — this PR introduces both the entry and the modal; the wizard's later steps — name / runtime / model / flags / confirm — are scoped to a follow-up to keep this PR small. The picker can ship behind the `+` and lead to a "TODO: wizard 后续 ship" placeholder so mobile users get the daemon discovery surface without waiting on the rest.)

This split keeps the design surface small enough for one review pass: **this PR = picker screen only.** Wizard steps follow once the picker is locked.

## Layout principle (mobile vs dashboard)

Dashboard's `count≥2` is a 1/2/3-column grid (mobile breakpoint already collapses to single column). On RN we don't need responsive media queries — phone widths are always single-column. So the spec collapses:

| State | Dashboard | Mobile |
| --- | --- | --- |
| count=0 | empty-state card with install command | same intent, native `<View>` w/ `<Text>` blocks; copy command via tap-to-copy (`Clipboard.setStringAsync`) since users can't easily select native text |
| count=1 | collapsed card "将在 X 上创建" + 详情→ | same; tap card row → expand to picker list (for 1-daemon networks the user can still peek at telemetry before committing) |
| count≥2 | grid 1/2/3-col | vertical `<FlatList>` of daemon cards |

## ASCII mockups

### count=0 — onboarding

```
┌─────────────────────────────────────┐
│ ←  选服务器                          │   ← stack header
├─────────────────────────────────────┤
│                                     │
│  ⓘ  还没有可用的 host_supervisor 节点  │
│                                     │
│  要在某台机器上创建节点，先在那台      │
│  机器上跑一次 daemon 初始化命令：     │
│                                     │
│  ┌─────────────────────────────────┐│
│  │ anet daemon up my-daemon    [复制]│   ← Pressable, copies + toast
│  └─────────────────────────────────┘│
│                                     │
│  注册成功后这里会自动出现（10s 刷新）│   ← honest about polling cadence
│                                     │
│                                     │
└─────────────────────────────────────┘
                                       ┌──────────┐
                                       │ 下一步 ⛔│   ← disabled (no daemon yet)
                                       └──────────┘
```

### count=1 — auto-picked (collapsed)

```
┌─────────────────────────────────────┐
│ ←  选服务器                          │
├─────────────────────────────────────┤
│                                     │
│  ┌─────────────────────────────────┐│
│  │  ●  pr4-alpha            [详情] ││   ● green dot (alert_level)
│  │     pr4-host-alpha              ││   subtitle: hostname
│  │     claude-agent-sdk  codex-sdk ││   runtime chips
│  │     8 核 · 16 GB                ││   telemetry summary
│  └─────────────────────────────────┘│
│                                     │
│  将在 pr4-alpha 上创建（仅此一台）   │
│                                     │
└─────────────────────────────────────┘
                                       ┌──────────┐
                                       │ 下一步 → │   ← enabled, auto-selected
                                       └──────────┘
```

Tapping `[详情]` flips to the picker-list view (same as count≥2) so the user can see all options even when there's only one — useful for verifying alert state before committing.

### count≥2 — picker list

```
┌─────────────────────────────────────┐
│ ←  选服务器                          │
├─────────────────────────────────────┤
│  选择一台 host_supervisor 节点 (2)  │
│                                     │
│  ┌─────────────────────────────────┐│
│  │  ●  pr4-beta           [ ]      ││   ← unselected radio
│  │     pr4-host-beta               ││
│  │     claude-agent-sdk            ││
│  │     4 核 · 8 GB                 ││
│  └─────────────────────────────────┘│
│                                     │
│  ┌─────────────────────────────────┐│
│  │  ●  pr4-alpha          [●]      ││   ← selected (cyan radio)
│  │     pr4-host-alpha              ││
│  │     claude-agent-sdk  codex-sdk ││
│  │     8 核 · 16 GB                ││
│  └─────────────────────────────────┘│
│                                     │
│                                     │
└─────────────────────────────────────┘
                                       ┌──────────┐
                                       │ 下一步 → │   ← enabled when picked
                                       └──────────┘
```

### loading state

```
┌─────────────────────────────────────┐
│ ←  选服务器                          │
├─────────────────────────────────────┤
│                                     │
│                                     │
│           ⏳ 正在查询…                │   ← ActivityIndicator
│                                     │
│                                     │
└─────────────────────────────────────┘
```

### degrade state (older hub, /api/host-supervisors 501)

```
┌─────────────────────────────────────┐
│ ←  选服务器                          │
├─────────────────────────────────────┤
│                                     │
│  ⚠  服务器未升级                      │
│                                     │
│  当前 hub 不包含 list_host_supervisors│
│  API，需升级到                       │
│  commhub-server@0.9.0-preview.8 以上 │
│                                     │
│  （hub 在 /settings 的服务器版本可见） │
│                                     │
└─────────────────────────────────────┘
```

Honest 501 surface — same discipline as dashboard PR4. Never fake an empty list: a UI that renders "no items" when the capability is merely unimplemented is indistinguishable, to the reader, from one that checked and found nothing. Say which of the two happened.

## Visual / token mapping to existing theme

| Element | Token / value | Mirrors |
| --- | --- | --- |
| Card background | `colors.card` | ServerScreen card |
| Card border | `colors.border` + width 1 + borderRadius 12 | ServerScreen card |
| Card padding | `spacing.lg` | ServerScreen rows |
| Section title | `colors.textMuted` 12pt | ServerScreen sectionTitle |
| Alert dot 10×10 r=5 | `colors.running` (green) / `blocked` (yellow) / `failed` (red) / `rest` (gray) | ServerScreen statusRow dot |
| Runtime chip | `colors.inputBg` background, `colors.textSecondary` 10pt, borderRadius 6 | (new — minimal pill, matches inputBg) |
| Primary button | `colors.accent` background, white text, 14pt 600 | (matches SettingsScreen primaries) |
| Disabled button | `colors.border` background, `colors.textMuted` text | (mirrors disabled inputs) |
| Code block (install cmd) | `colors.inputBg` bg + monospace font + `colors.accent` text | (matches inputs) |
| Toast (after copy) | top-of-screen translucent strip, 1.5s auto-dismiss | (new — matches RN Toast convention) |

## Polling cadence

Use `usePoll(load, 10000, [load])` — same hook as `ServerScreen`. 10s while foregrounded, paused in background. Aligns with established app behavior (Vincent has approved that cadence elsewhere).

## Auto-pick UX detail (count=1)

When the picker mounts and the fetch returns count=1, set the selected daemon to `daemons[0].daemon_node_id` automatically AND show the collapsed card view. User has two paths:
1. Tap **下一步 →** to proceed with the auto-pick (1 tap).
2. Tap **[详情]** to switch to the full list view (lets them verify telemetry; still only 1 row).

Selection is preserved across the toggle — so tapping into picker view, then back to collapsed view, doesn't reset.

## What's NOT in this PR (deferred to follow-up)

- The rest of the create-node wizard (name / runtime / model / flags / confirm). When the user taps 下一步 → after the picker, show a placeholder screen with "TODO: 节点创建向导后续 ship" so the picker can be reviewed independently.
- Form validation, env_refs UI, vault picker.
- iOS-vs-Android distinct affordances (keep one canonical RN layout for now).
- Visual regression tests (no equivalent infra in agent-network-app; existing tests are Vincent-validated screen smoke).

## Open questions for 通信龙 / Vincent

1. **Entry point**: `+` on Agents tab is the natural place but it competes with the existing Agents UI density. Alternative: drop entry under Server tab (where the user is already thinking about servers). Recommend: Agents tab — that's where the user wants to "add an agent", and Server is currently just a status view.
2. **Should count=1 auto-advance** to the wizard's next step instead of stopping at the auto-pick card? Dashboard makes it explicit (one tap of 下一步); on mobile a tap is cheaper than scrolling but skipping a confirmation step may surprise. **Recommend**: keep the explicit tap.
3. **Toast/feedback on copy**: RN doesn't have a built-in Toast. Tiny custom component or use `expo-haptics` + brief in-card "已复制" text swap. **Recommend**: in-card text swap (no new dep).

## Test plan (post-code, NOT this PR)

- Real local hub @ preview.8 on temp port (per 通信龙: 别碰 9200 prod):
  - count=0: drop both daemons, verify onboarding renders + 下一步 disabled
  - count=1: register 1 daemon, verify auto-pick + collapsed card
  - count≥2: register 2 daemons, verify list + selection persists across collapse/expand toggle
  - 501 degrade: point at preview.7 hub, verify upgrade hint renders
- Dark/light theme parity: toggle via SettingsScreen, verify both render correctly.
- No new TestFlight build for picker alone — batched per 通信龙 directive.

---

**Ask 通信龙**: review this draft + the 3 open questions, then surface to Vincent for UX sign-off BEFORE I write any `.tsx`.
