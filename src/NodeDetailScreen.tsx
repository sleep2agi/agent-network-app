// Per-node detail screen — issue #8 row 4 (V1 health card only).
//
// SCOPE (per 通信龙 71ee862d + d349e514 V1 decision):
//   Health card: alias + status chip + updated_at + current task preview +
//   team + server + avatar. NO config panel (V2 — depends on hub API
//   enumeration that's a separate parallel task). NO log stream (row 6).
//   NO edit / lifecycle actions.
//
// TASK vs NODE distinction (author-厘清 → 通信龙 5a8783bd 认为镜像镜镜):
//   task = one dispatched task's status/result/reply
//     (that's demo马's TaskDetailScreen in row 5 — NOT this file)
//   node = one agent's health/config/log stream
//     (that's this file for the health slice; config = V2, log = row 6)
//
// HARD REQUIREMENTS from dispatch (do NOT change without lead sign):
//   1. Avatar: use src/lib/avatars.ts (djb2 pool). Do NOT roll own hash —
//      the h*31 in AliasAvatar is the letter-pill color palette, a
//      DIFFERENT hash from the pool pick (author corrected lead on this
//      once already; the memo-vs-source hash confusion is the exact
//      trap this file avoids by delegating to AliasAvatar).
//   2. Styles: `import { styles } from './app-styles'` — do NOT
//      destructure, do NOT copy. See app-styles.ts header comment
//      explaining ES-module live binding: styles is `export let`,
//      onThemeChange reassigns the whole object, importers get the new
//      one via live binding. Any local copy freezes on first paint's
//      colors — screen "works but wrong color" after theme switch,
//      undetectable in a single screen review.
//   3. Three visible states — loading, empty (session not found in
//      fleet), error (fetch failed) — separated on screen, not merged
//      into a blank canvas.
//
// ENTRY: `AgentsScreen` row `onLongPress` (pending PR #14 merge — do NOT
//   touch AgentsScreen until lead greenlights). Existing tap → chat is
//   a high-frequency path, preserved unchanged.
//
// WIRING: App.tsx adds one route case + one prop. Coordinated with
//   demo马's Tasks tab that also touches App.tsx (lead-mediated order:
//   this PR lands first, demo马 wires after).
//
// V1 uses ONLY `Session` fields already exposed by fetchStatus
// (alias / status / agent / task / server / updated_at). No new API
// fetcher. If the alias vanishes from the fleet between refreshes, we
// render "empty" not "error" — the caller (App.tsx router) can offer a
// back navigation. Missing field values render "—" so the user can tell
// "field absent" apart from "screen broken" (lead 71ee862d
// verification bullet).

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import AliasAvatar from './AliasAvatar';
import AvatarEditSection from './AvatarEditSection';
import { teamOf } from './agents-list';
import { fetchStatus, type HubConfig, type Session } from './api';
import { styles } from './app-styles';
import { colors, onThemeChange, spacing, statusColor } from './theme';
import { formatTime } from './time';
import { usePoll } from './usePoll';

const POLL_MS = 10_000; // same cadence as AgentsScreen — hub-friendly, felt-live

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; session: Session }
  | { kind: 'not_found' } // alias no longer in the fleet
  | { kind: 'error' };    // fetch itself failed (network / auth / server)

/**
 * Render a labeled row where `value` may be absent. Absent renders as
 * `—` so the user can distinguish "field not populated by hub" from
 * "screen crashed and shows nothing". Kept inline (not exported) — this
 * pattern is scoped to this screen for now.
 */
function InfoRow({ label, value }: { label: string; value?: string | null }) {
  const shown = value && value.trim().length > 0 ? value : '—';
  return (
    <View style={{ flexDirection: 'row', paddingVertical: spacing.sm }}>
      <Text style={{ color: colors.textMuted, width: 96, fontSize: 13 }}>{label}</Text>
      <Text style={{ color: colors.text, flex: 1, fontSize: 14 }} selectable>
        {shown}
      </Text>
    </View>
  );
}

export default function NodeDetailScreen({
  cfg,
  alias,
  onBack,
}: {
  cfg: HubConfig;
  alias: string;
  onBack: () => void;
}) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  // Force re-render on theme switch. `styles` reassigns via live binding
  // (see app-styles.ts header) but child style props are captured at
  // render — a manual bump is how the sibling screens do it too.
  const [, setThemeTick] = useState(0);
  useEffect(() => onThemeChange(() => setThemeTick(t => t + 1)), []);

  const load = useCallback(async () => {
    try {
      const data = await fetchStatus(cfg);
      const found = (data.sessions ?? []).find(s => s.alias === alias);
      if (found) setState({ kind: 'ready', session: found });
      else setState(prev => (prev.kind === 'ready' ? prev : { kind: 'not_found' }));
      // If we previously had the session and it's now gone, we keep the
      // last-known snapshot rather than flashing "not_found" — the alias
      // may have gone offline momentarily. `not_found` only wins when we
      // never had it (initial fetch missed it).
    } catch {
      setState(prev => (prev.kind === 'ready' ? prev : { kind: 'error' }));
      // Same "keep last-known" policy on fetch error, mirroring
      // AgentsScreen's behavior.
    }
  }, [cfg, alias]);

  useEffect(() => {
    void load();
  }, [load]);

  // Foreground-only 10s polling. usePoll pauses in background and
  // instant-refreshes on resume — same hook AgentsScreen uses.
  usePoll(load, POLL_MS, [load]);

  const header = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.md,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        gap: spacing.md,
      }}
    >
      <Pressable onPress={onBack} hitSlop={12}>
        <Text style={{ color: colors.accent, fontSize: 28 }}>‹</Text>
      </Pressable>
      <Text style={{ color: colors.text, fontSize: 17, fontWeight: '600' }}>节点详情</Text>
    </View>
  );

  if (state.kind === 'loading') {
    return (
      <View style={styles.root}>
        {header}
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </View>
    );
  }

  if (state.kind === 'error') {
    return (
      <View style={styles.root}>
        {header}
        <View style={styles.center}>
          <Text style={styles.errorTitle}>加载失败</Text>
          <Text style={styles.errorHint}>网络不稳定或服务器未响应</Text>
          <Pressable
            style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.7 }]}
            onPress={() => {
              setState({ kind: 'loading' });
              void load();
            }}
          >
            <Text style={styles.retryBtnText}>重试</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (state.kind === 'not_found') {
    return (
      <View style={styles.root}>
        {header}
        <View style={styles.center}>
          <Text style={styles.errorTitle}>找不到节点</Text>
          <Text style={styles.errorHint}>
            别名 <Text style={{ color: colors.text }}>{alias}</Text> 已不在当前网络的会话列表里
          </Text>
        </View>
      </View>
    );
  }

  const s = state.session;
  const online = s.status !== 'offline';
  const chipColor = statusColor(s.status, online);
  const team = teamOf(s.alias);

  return (
    <View style={styles.root}>
      {header}
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        {/* Identity block */}
        <View style={{ alignItems: 'center', paddingVertical: spacing.lg, gap: spacing.md }}>
          <AliasAvatar alias={s.alias} size={96} />
          <Text style={{ color: colors.text, fontSize: 20, fontWeight: '700' }} selectable>
            {s.alias}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: chipColor,
              }}
            />
            <Text style={{ color: colors.textMuted, fontSize: 13 }}>
              {online ? s.status : 'offline'}
            </Text>
          </View>
        </View>

        {/* R2 avatar editor (pool picker + custom URL; pre-disclosure for session-only) */}
        <AvatarEditSection cfg={cfg} alias={s.alias} />

        {/* Facts block — read-only labeled rows */}
        <View
          style={{
            backgroundColor: colors.card,
            borderRadius: 12,
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.sm,
            gap: 0,
          }}
        >
          <InfoRow label="所属 team" value={team} />
          <InfoRow label="Server" value={s.server} />
          <InfoRow label="最后更新" value={formatTime(s.updated_at)} />
          <InfoRow label="Agent" value={s.agent} />
        </View>

        {/* Current task preview — separate section, prose-style */}
        <View style={{ paddingTop: spacing.xl }}>
          <Text style={{ color: colors.textMuted, fontSize: 13, marginBottom: spacing.sm }}>
            当前任务
          </Text>
          <View
            style={{
              backgroundColor: colors.card,
              borderRadius: 12,
              padding: spacing.lg,
            }}
          >
            <Text style={{ color: colors.text, fontSize: 14, lineHeight: 20 }} selectable>
              {s.task && s.task.trim().length > 0 ? s.task : '—'}
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
