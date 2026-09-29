// 节点页「定时任务」分区:这个节点要执行的计划 —— Hub 计划 + 节点计划(RFC-036),按 node_id 认执行节点。
// 取数与定时任务页同一套接口(scheduled-tasks / status 的 external_schedules / runs?limit=1),
// 行怎么画、开关能不能按在 node-schedules.ts(纯函数,node-schedules.test.ts 测)。
// 点一行 → 定时任务页落在那一条(详情 + 执行记录);「＋ 新建」在节点页的分区标题上,由 NodeDetailScreen 画。
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, View } from 'react-native';
import { Text } from './ui-text';
import {
  createExternalScheduleEdit,
  fetchExternalScheduleEdits,
  fetchExternalSchedules,
  fetchScheduledRuns,
  fetchScheduledTasks,
  fetchTaskDetail,
  selectOpenIntents,
  setScheduledTaskStatus,
  type HubConfig,
  type HubExternalScheduleEditIntent,
  type HubNodeExternalSchedules,
  type HubScheduledRun,
  type HubScheduledTask,
  type HubTask,
} from './api';
import { editIntentErrorText } from './ScheduledTasksScreen';
import { runIsOpen } from './schedule-run-result';
import { NODE_SCHEDULES_EMPTY, externalSchedulesForNode, hubSchedulesForNode, lastRunKey, nodeScheduleRows, type NodeScheduleRow } from './node-schedules';
import type { StatusTone } from './scheduled-view-model';
import { colors, onThemeChange, radius, spacing, type as typeScale, weight } from './theme';
import { usePoll } from './usePoll';
import { buttonStyle, buttonTextStyle } from './elevation';

const POLL_MS = 10_000;

const DEVICE_TIMEZONE = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined; } catch { return undefined; }
})();

const toneColor = (tone: StatusTone) =>
  tone === 'running' ? colors.running : tone === 'blocked' ? colors.blocked : tone === 'failed' ? colors.failed : colors.textMuted;

type Load =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'error'; message: string; stale: boolean };

type LastRun = { key: string; run: HubScheduledRun | null; task?: HubTask | null };

export default function NodeSchedulesSection({ cfg, nodeId, onOpen, onCreate }: {
  cfg: HubConfig;
  /** 权威 node_id(nodes 行,没有再用会话上报的);null = 这个节点不能当执行节点。 */
  nodeId: string | null;
  /** 点一行:去定时任务页并选中它。没有(独立聊天窗口)时行不可点。 */
  onOpen?: (row: NodeScheduleRow) => void;
  /** 空状态里的「新建」;没有时不画。 */
  onCreate?: () => void;
}) {
  const [, setThemeTick] = useState(0);
  useEffect(() => onThemeChange(() => setThemeTick(t => t + 1)), []);
  const [state, setState] = useState<Load>({ kind: 'loading' });
  const [hub, setHub] = useState<HubScheduledTask[]>([]);
  const [external, setExternal] = useState<HubNodeExternalSchedules[]>([]);
  const [lastRuns, setLastRuns] = useState<Record<string, LastRun>>({});
  const [openIntents, setOpenIntents] = useState<Record<string, HubExternalScheduleEditIntent>>({});
  const [ownerDenied, setOwnerDenied] = useState(false);
  // 本页刚提交、Hub 已受理的意向(键 `${node_id}:${schedule_id}`)。commhub-server 0.9.0-preview.61 的意向记录
  // 把 INTEGER 时间列过 parseHubTimestamp(只认字符串)⇒ expires_at 恒为 null,selectOpenIntents 认不出在途;
  // 在节点快照变到要的值(或 revision 变了)之前,按这里的记录画成在途。
  const [submitted, setSubmitted] = useState<Record<string, { intent: HubExternalScheduleEditIntent; revision: number }>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  // 读成功过一次:之后失败保留上一份结果、只在旁边说错误(与节点页其余区块同一策略)。
  const loadedRef = useRef(false);
  const lastRunsRef = useRef(lastRuns);
  lastRunsRef.current = lastRuns;

  // 最近一次执行:计划被执行过(lastRunKey 变了)或上次读到的还没结束才重读;没结束的顺带读任务分出「执行中」。
  const refreshLastRuns = useCallback(async (rows: HubScheduledTask[]) => {
    const due = rows.filter(row => {
      const seen = lastRunsRef.current[row.schedule_id];
      return !seen || seen.key !== lastRunKey(row) || (seen.run && runIsOpen(seen.run));
    });
    if (!due.length) return;
    const fetched = await Promise.all(due.map(async (row): Promise<[string, LastRun] | null> => {
      try {
        const run = (await fetchScheduledRuns(cfg, row.schedule_id, 1)).runs?.[0] ?? null;
        const task = run && runIsOpen(run) ? await fetchTaskDetail(cfg, run.task_id!).catch(() => null) : null;
        return [row.schedule_id, { key: lastRunKey(row), run, task }];
      } catch {
        return null; // 读不到就先不画上次结果,下一轮再试
      }
    }));
    setLastRuns(prev => {
      const next = { ...prev };
      for (const hit of fetched) if (hit) next[hit[0]] = hit[1];
      return next;
    });
  }, [cfg]);

  const load = useCallback(async () => {
    if (!nodeId) { setState({ kind: 'ready' }); return; }
    try {
      const [scheduleData, externalRows] = await Promise.all([fetchScheduledTasks(cfg), fetchExternalSchedules(cfg)]);
      const mine = hubSchedulesForNode(scheduleData.schedules || [], nodeId);
      setHub(mine);
      setExternal(externalRows);
      setState({ kind: 'ready' });
      loadedRef.current = true;
      void refreshLastRuns(mine);
      // 只有带托管条目时才读意向记录(与定时任务页相同);403 = 不是节点 owner,开关提前置灰说明。
      const ext = externalSchedulesForNode(externalRows, nodeId);
      if (ext?.schedules.some(x => x.editable === true)) {
        try {
          setOpenIntents(selectOpenIntents((await fetchExternalScheduleEdits(cfg, nodeId)).edits || [], Date.now()));
          setOwnerDenied(false);
        } catch (e) {
          if (/\bHTTP 403\b/.test(String((e as Error)?.message ?? e))) setOwnerDenied(true);
        }
      }
    } catch (e) {
      setState({ kind: 'error', message: e instanceof Error ? e.message : String(e), stale: loadedRef.current });
    }
  }, [cfg, nodeId, refreshLastRuns]);

  useEffect(() => { loadedRef.current = false; setState({ kind: 'loading' }); setHub([]); setExternal([]); setLastRuns({}); }, [nodeId]);
  usePoll(load, POLL_MS, [load]);

  const toggle = async (row: NodeScheduleRow) => {
    if (!nodeId) return;
    setBusyKey(row.key); setActionError('');
    try {
      if (row.source === 'hub') {
        const target = hub.find(x => x.schedule_id === row.scheduleId);
        if (target) await setScheduledTaskStatus(cfg, target, target.status === 'active' ? 'paused' : 'active');
      } else {
        const sch = externalSchedulesForNode(external, nodeId)?.schedules.find(x => x.id === row.scheduleId);
        if (sch && typeof sch.revision === 'number') {
          const { intent } = await createExternalScheduleEdit(cfg, nodeId, { schedule_id: sch.id, base_revision: sch.revision, patch: { enabled: !sch.enabled } });
          setSubmitted(prev => ({ ...prev, [`${nodeId}:${sch.id}`]: { intent, revision: sch.revision! } }));
        }
      }
    } catch (e) {
      setActionError(row.source === 'node' ? editIntentErrorText(e) : e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKey(null);
      await load();
    }
  };

  if (!nodeId) {
    return (
      <View style={[s.card, s.padded]} testID="node-schedules-no-id">
        <Text style={s.muted}>这个会话没有权威节点 ID(没有 nodes 记录),不能作为定时任务的执行节点。</Text>
      </View>
    );
  }
  if (state.kind === 'loading') {
    return (
      <View style={[s.card, s.padded, s.inline]} testID="node-schedules-loading">
        <ActivityIndicator color={colors.textMuted} />
        <Text style={s.muted}>正在读取这个节点的定时任务…</Text>
      </View>
    );
  }

  const rows = nodeScheduleRows({ nodeId, hub, external, lastRuns, openIntents: withSubmitted(openIntents, submitted, externalSchedulesForNode(external, nodeId)), ownerDenied, nowMs: Date.now(), deviceTimezone: DEVICE_TIMEZONE });
  const failedFirstRead = state.kind === 'error' && !state.stale;
  return (
    <View style={{ gap: spacing.sm }}>
      {state.kind === 'error' ? (
        <View style={[s.inline, { justifyContent: 'space-between' }]} testID="node-schedules-error">
          <Text style={[s.error, { flex: 1 }]}>读取失败:{state.message}{state.stale ? '(下面是上一次的结果)' : ''}</Text>
          <Pressable onPress={() => { setState({ kind: 'loading' }); void load(); }} hitSlop={8} accessibilityRole="button" testID="node-schedules-retry" style={s.retry}>
            <Text style={s.retryText}>重试</Text>
          </Pressable>
        </View>
      ) : null}
      {actionError ? <Text style={s.error} testID="node-schedules-action-error">{actionError}</Text> : null}
      {failedFirstRead ? null : rows.length === 0 ? (
        <View style={[s.card, s.empty]} testID="node-schedules-empty">
          <Text style={s.emptyTitle}>{NODE_SCHEDULES_EMPTY}</Text>
          {onCreate ? (
            <Pressable onPress={onCreate} accessibilityRole="button" testID="node-schedules-empty-create" style={s.primary}>
              <Text style={s.primaryText}>新建</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <View style={s.card} testID="node-schedules-list">
          {rows.map((row, i) => (
            <ScheduleRow
              key={row.key}
              row={row}
              last={i === rows.length - 1}
              busy={busyKey === row.key}
              onOpen={onOpen ? () => onOpen(row) : undefined}
              onToggle={() => void toggle(row)}
            />
          ))}
        </View>
      )}
    </View>
  );
}

/** Hub 认得出的在途意向 + 本页刚提交、节点还没应用的(节点快照 revision 没变)。 */
function withSubmitted(
  open: Record<string, HubExternalScheduleEditIntent>,
  submitted: Record<string, { intent: HubExternalScheduleEditIntent; revision: number }>,
  snapshot: HubNodeExternalSchedules | null,
): Record<string, HubExternalScheduleEditIntent> {
  const out = { ...open };
  for (const [key, { intent, revision }] of Object.entries(submitted)) {
    const sch = snapshot?.schedules.find(x => `${snapshot.node_id}:${x.id}` === key);
    if (sch && sch.revision === revision && !out[key]) out[key] = intent;
  }
  return out;
}

function ScheduleRow({ row, last, busy, onOpen, onToggle }: {
  row: NodeScheduleRow;
  last: boolean;
  busy: boolean;
  onOpen?: () => void;
  onToggle: () => void;
}) {
  const id = row.key.replace(/[^A-Za-z0-9_-]/g, '_');
  return (
    <View style={[s.row, !last && s.rowDivider]} testID={`node-schedule-row-${id}`}>
      <Pressable
        onPress={onOpen}
        disabled={!onOpen}
        accessibilityRole={onOpen ? 'button' : undefined}
        accessibilityLabel={`${row.sourceLabel},${row.name},${row.frequency}${row.last ? `,上次${row.last.label}` : ''}`}
        accessibilityHint={onOpen ? '在定时任务页查看详情和执行记录' : undefined}
        testID={`node-schedule-open-${id}`}
        style={(state: { pressed: boolean; hovered?: boolean }) => [s.rowMain, onOpen && (state.hovered || state.pressed) && { backgroundColor: colors.rowHover }]}
      >
        <Text style={s.name} numberOfLines={1} testID={`node-schedule-name-${id}`}>{row.name}</Text>
        {/* 来源标签放第二行行首:名字与标签各自一条竖线对齐(标签宽度随文字变,放名字前面会让名字错位)。 */}
        {/* 第二行放不下就折行,不截断:手机上频率被截成「每…」就什么都没说。 */}
        <View style={[s.line, s.wrap]}>
          <Text style={s.source} numberOfLines={1} testID={`node-schedule-source-${id}`}>{row.sourceLabel}</Text>
          <Text style={s.meta} numberOfLines={1} testID={`node-schedule-frequency-${id}`}>{row.frequency}</Text>
          <Text style={s.metaMuted} numberOfLines={1} testID={`node-schedule-next-${id}`}>{row.next}</Text>
          {row.last ? (
            <Text
              style={[s.pill, { color: toneColor(row.last.tone), backgroundColor: `${toneColor(row.last.tone)}1f` }]}
              numberOfLines={1}
              testID={`node-schedule-last-${id}`}
            >
              上次 {row.last.label}
            </Text>
          ) : null}
        </View>
        {row.toggle.hint ? <Text style={s.hint} numberOfLines={2} testID={`node-schedule-hint-${id}`}>{row.toggle.hint}</Text> : null}
      </Pressable>
      <View style={s.toggleWrap} testID={`node-schedule-toggle-${id}`}>
        <Switch
          accessibilityLabel={row.toggle.value ? `暂停 ${row.name}` : `恢复 ${row.name}`}
          accessibilityHint={row.toggle.hint ?? undefined}
          value={row.toggle.value}
          disabled={row.toggle.disabled || busy}
          onValueChange={onToggle}
          trackColor={{ true: colors.accent, false: colors.border }}
          thumbColor={colors.card}
        />
      </View>
    </View>
  );
}

// Rebuilt on theme change (colors are read at StyleSheet.create time).
const makeStyles = () => StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius.surface, overflow: 'hidden' },
  padded: { padding: spacing.lg },
  inline: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  muted: { color: colors.textMuted, fontSize: typeScale.body },
  error: { color: colors.failed, fontSize: typeScale.small },
  retry: { ...buttonStyle('secondary') },
  retryText: { ...buttonTextStyle('secondary') },
  empty: { alignItems: 'center', paddingVertical: spacing.xl * 1.5, paddingHorizontal: spacing.lg, gap: spacing.md },
  emptyTitle: { color: colors.textSecondary, fontSize: typeScale.body },
  primary: { ...buttonStyle('primary') },
  primaryText: { ...buttonTextStyle('primary') },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 64 },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowMain: { flex: 1, minWidth: 0, gap: 4, paddingLeft: spacing.lg, paddingRight: spacing.sm, paddingVertical: 10 },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minWidth: 0 },
  wrap: { flexWrap: 'wrap', rowGap: 4 },
  source: { flexShrink: 0, color: colors.textSecondary, fontSize: typeScale.caption, backgroundColor: colors.subtleFill, borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden' },
  name: { color: colors.text, fontSize: typeScale.body, fontWeight: weight.strong },
  meta: { flexShrink: 1, color: colors.textSecondary, fontSize: typeScale.small },
  metaMuted: { flexShrink: 1, color: colors.textMuted, fontSize: typeScale.small },
  pill: { flexShrink: 0, fontSize: typeScale.caption, fontWeight: weight.medium, overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 1, borderRadius: radius.pill },
  hint: { color: colors.textMuted, fontSize: typeScale.caption, lineHeight: 16 },
  toggleWrap: { paddingRight: spacing.lg, paddingLeft: spacing.xs, justifyContent: 'center' },
});
let s = makeStyles();
onThemeChange(() => { s = makeStyles(); });
