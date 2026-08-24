// Per-node detail screen — issue #8 row 4 (V1 health card only).
//
// SCOPE (per 通信龙 71ee862d + d349e514 V1 decision):
//   Health card: alias + status chip + updated_at + current task preview +
//   team + server + avatar. V2 progressively adds masked config facts and
//   lifecycle controls when GET /api/nodes supplies an authoritative node_id.
//   Session-only aliases remain read-only. Logs stay in the Server workspace.
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
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import AliasAvatar from './AliasAvatar';
import AvatarEditSection from './AvatarEditSection';
import { teamOf } from './agents-list';
import { fetchHubNodes, fetchStatus, runNodeLifecycleAction, type HubConfig, type HubNode, type NodeLifecycleAction, type Session } from './api';
import { styles } from './app-styles';
import { colors, onThemeChange, spacing, statusColor } from './theme';
import { formatTime } from './time';
import { usePoll } from './usePoll';
import { nodeActionVisual, type NodeActionTone } from './node-action-visual';

const POLL_MS = 10_000; // same cadence as AgentsScreen — hub-friendly, felt-live

function NodeActionButton({
  label,
  tone,
  onPress,
}: {
  label: string;
  tone: NodeActionTone;
  onPress: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const visual = nodeActionVisual(colors, tone);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={tone === 'danger' ? '需要输入节点别名再次确认' : '打开确认窗口'}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={({ pressed }) => [
        localStyles.actionButton,
        { borderColor: visual.borderColor, backgroundColor: visual.backgroundColor },
        (hovered || focused) && { backgroundColor: colors.inputBg },
        focused && { borderColor: visual.textColor },
        pressed && localStyles.actionButtonPressed,
      ]}
    >
      <Text style={[localStyles.actionButtonText, { color: visual.textColor }]}>{label}</Text>
    </Pressable>
  );
}

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
  const [node, setNode] = useState<HubNode | null>(null);
  const [pendingAction, setPendingAction] = useState<NodeLifecycleAction | null>(null);
  const [confirmAlias, setConfirmAlias] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState('');
  // Force re-render on theme switch. `styles` reassigns via live binding
  // (see app-styles.ts header) but child style props are captured at
  // render — a manual bump is how the sibling screens do it too.
  const [, setThemeTick] = useState(0);
  useEffect(() => onThemeChange(() => setThemeTick(t => t + 1)), []);

  const load = useCallback(async () => {
    try {
      const data = await fetchStatus(cfg);
      const found = (data.sessions ?? []).find(s => s.alias === alias);
      void fetchHubNodes(cfg)
        .then(result => setNode((result.nodes ?? []).find(candidate => candidate.alias === alias) ?? null))
        .catch(() => setNode(null));
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
  const executeLifecycle = async () => {
    if (!pendingAction || !node || actionBusy) return;
    setActionBusy(true);
    setActionMessage('');
    const result = await runNodeLifecycleAction(cfg, pendingAction, node);
    setActionBusy(false);
    if (!result.ok) {
      setActionMessage(result.error === 'node_busy_in_flight'
        ? `节点仍有 ${result.in_flight_count ?? 1} 个处理中任务，未强制操作`
        : result.error);
      return;
    }
    setActionMessage(pendingAction === 'restart_node' ? '重启请求已提交' : pendingAction === 'stop_node' ? '停止请求已提交' : '删除请求已提交');
    setPendingAction(null);
    setConfirmAlias('');
    void load();
  };

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
          <InfoRow label="节点 ID" value={node?.node_id} />
          <InfoRow label="生命周期" value={node?.lifecycle_state} />
          <InfoRow label="模型" value={node?.config_snapshot?.model} />
          <InfoRow label="角色" value={node?.config_snapshot?.role} />
          <InfoRow label="配置版本" value={typeof node?.config_revision === 'number' ? String(node.config_revision) : undefined} />
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

        <View style={{ paddingTop: spacing.xl }}>
          <Text style={{ color: colors.textMuted, fontSize: 13, marginBottom: spacing.sm }}>节点操作</Text>
          {node ? (
            <View style={{ backgroundColor: colors.card, borderRadius: 12, padding: spacing.lg, gap: spacing.md }}>
              <Text style={{ color: colors.textMuted, fontSize: 12, lineHeight: 18 }}>
                操作通过公开 CommHub/anet 契约执行。停止不会删除配置；有任务处理中时服务器会拒绝，不会自动强制。
              </Text>
              <View style={localStyles.actionRow}>
                <NodeActionButton label="重启节点" tone="neutral" onPress={() => setPendingAction('restart_node')} />
                <NodeActionButton label="停止节点" tone="caution" onPress={() => setPendingAction('stop_node')} />
                <NodeActionButton label="删除节点" tone="danger" onPress={() => setPendingAction('delete_node')} />
              </View>
              {actionMessage ? <Text style={{ color: actionMessage.includes('已提交') ? colors.running : colors.failed, fontSize: 12 }}>{actionMessage}</Text> : null}
            </View>
          ) : (
            <Text style={{ color: colors.textMuted, fontSize: 12 }}>该会话没有权威节点 ID，生命周期操作不可用。</Text>
          )}
        </View>
      </ScrollView>

      <Modal transparent visible={!!pendingAction} onRequestClose={() => setPendingAction(null)} animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl }}>
          <View style={{ width: '100%', maxWidth: 420, borderRadius: 14, backgroundColor: colors.card, padding: spacing.xl, gap: spacing.md }}>
            <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700' }}>
              {pendingAction === 'restart_node' ? '重启节点？' : pendingAction === 'stop_node' ? '停止节点？' : '删除节点？'}
            </Text>
            <Text style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 19 }}>
              {pendingAction === 'delete_node' ? `删除会撤销节点身份。请输入别名“${alias}”确认；节点配置默认备份保留。` : `目标：${alias}。请求提交后请等待节点状态刷新。`}
            </Text>
            {pendingAction === 'delete_node' ? (
              <TextInput value={confirmAlias} onChangeText={setConfirmAlias} autoCapitalize="none" placeholder={alias} placeholderTextColor={colors.textMuted} style={{ color: colors.text, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: spacing.md }} />
            ) : null}
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm }}>
              <Pressable style={styles.retryBtn} onPress={() => { setPendingAction(null); setConfirmAlias(''); }}><Text style={styles.retryBtnText}>返回</Text></Pressable>
              <Pressable
                style={[styles.retryBtn, pendingAction === 'delete_node' && { borderColor: colors.failed }, (actionBusy || (pendingAction === 'delete_node' && confirmAlias !== alias)) && { opacity: 0.4 }]}
                disabled={actionBusy || (pendingAction === 'delete_node' && confirmAlias !== alias)}
                onPress={() => void executeLifecycle()}
              >
                <Text style={{ color: pendingAction === 'delete_node' ? colors.failed : colors.accent, fontWeight: '600' }}>{actionBusy ? '提交中…' : '确认'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const localStyles = StyleSheet.create({
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  actionButton: {
    minWidth: 92,
    height: 34,
    borderRadius: 7,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonPressed: {
    opacity: 0.68,
    transform: [{ scale: 0.98 }],
  },
  actionButtonText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
});
