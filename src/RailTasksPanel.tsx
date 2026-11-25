// 聊天右侧「任务」面板（admin 2026-11-19「一个是 send_task 的，一个是项目管理表的，项管表里面的项管任务也需要有个入口」
// /「这是两个不同的任务」）：两个页签分开放 ——
//   派给它的：send_task 派来的消息任务（NodeTasksSection，同节点页那块）；
//   项管：项管表里负责 Agent / 负责人 / 参与者是这个 agent 的需求卡，按状态分组（进行中 / 需求池 / 最近完成）。
// 默认打开有内容的那个；点任一项管卡直接弹出任务详情窗（openTaskWindow，开不了时回退 onOpenTask）。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Text } from './ui-text';
import { Ionicons } from './icons';
import type { HubConfig } from './api';
import NodeTasksSection from './NodeTasksSection';
import { listRequirementsFull } from './requirements-hub';
import { REQ_COLUMN_LABEL, type ReqColumn, type Requirement } from './requirements-model';
import { requirementsForAgent } from './rail-requirements';
import { colors, onThemeChange, radius, spacing, type as typeScale, weight } from './theme';
import { usePoll } from './usePoll';
import { openTaskWindow } from './task-window';
import { PRIORITY_CODE } from './task-priority';
import { shortIdLabel } from './task-short-id';
import { dueBg, dueColor, priorityColor, softShadow, STATUS_TONE } from './TaskBoardParts';
import { dueInfo } from './i18n-task-presentation';
import { localToday } from './task-board-model';
import { useGlassChrome } from './glass-chrome';

const POLL_MS = 60_000;

export default function RailTasksPanel({ cfg, alias, nodeId, onJumpToTask, onOpenTask }: {
  cfg: HubConfig;
  alias: string;
  nodeId?: string | null;
  onJumpToTask?: (taskId: string) => void;
  onOpenTask?: (requirementId: string, networkId: string | null) => void;
}) {
  const glass = useGlassChrome();
  const [, setThemeTick] = useState(0);
  useEffect(() => onThemeChange(() => setThemeTick(t => t + 1)), []);

  const [tab, setTab] = useState<'sent' | 'board' | null>(null);
  const [rows, setRows] = useState<Requirement[] | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const r = await listRequirementsFull(cfg, { summary: true });
      setRows(r.rows); setError('');
    } catch (e) { setError(String((e as Error)?.message ?? e).slice(0, 120)); }
  }, [cfg]);
  useEffect(() => { void load(); }, [load]);
  usePoll(load, POLL_MS, [load]);
  const mine = useMemo(() => (rows ? requirementsForAgent(rows, { alias, nodeId: nodeId ?? null }) : null), [rows, alias, nodeId]);
  const boardCount = mine ? mine.doing.length + mine.pool.length : 0;
  // 默认：有进行中 / 待开始的项管卡就先给项管，否则派给它的。用户点过就听用户的。
  const current = tab ?? (boardCount > 0 ? 'board' : 'sent');
  const today = localToday();

  const handleOpenRequirement = useCallback((req: Requirement) => {
    void openTaskWindow({
      taskId: req.id,
      profileId: cfg.profileId,
      serverUrl: cfg.serverUrl,
      networkId: cfg.networkId,
      title: req.name,
      at: Date.now(),
    }).then(opened => {
      if (!opened) onOpenTask?.(req.id, cfg.networkId ?? null);
    });
  }, [cfg.networkId, cfg.profileId, cfg.serverUrl, onOpenTask]);

  const tabBtn = (key: 'sent' | 'board', label: string, count?: number) => {
    const on = current === key;
    return (
      <Pressable key={key} onPress={() => setTab(key)} accessibilityRole="tab" accessibilityState={{ selected: on }} testID={`rail-tasks-tab-${key}`}
        style={{ paddingHorizontal: spacing.md, height: 30, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: on ? colors.railActiveBg : 'transparent' }}>
        <Text style={{ color: on ? colors.accent : colors.textSecondary, fontSize: typeScale.small, fontWeight: on ? weight.strong : weight.regular }}>
          {label}{count && count > 0 ? ` ${count}` : ''}
        </Text>
      </Pressable>
    );
  };

  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ flexDirection: 'row', gap: spacing.xs, backgroundColor: glass ? 'rgba(29, 32, 38, 0.05)' : colors.subtleFill, borderRadius: radius.pill, padding: 3, alignSelf: 'flex-start' }} accessibilityRole="tablist">
        {tabBtn('sent', '派给它的')}
        {tabBtn('board', '项管', mine ? boardCount : undefined)}
      </View>
      {current === 'sent' ? <NodeTasksSection cfg={cfg} alias={alias} embedded onJumpToTask={onJumpToTask} /> : (
        <View style={{ gap: spacing.lg }} testID="rail-tasks-board">
          {!rows && !error ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <ActivityIndicator color={colors.textMuted} /><Text style={{ color: colors.textMuted, fontSize: typeScale.small }}>正在读取项管表…</Text>
            </View>
          ) : null}
          {error ? <Text style={{ color: colors.failed, fontSize: typeScale.small }}>项管表读取失败：{error}</Text> : null}
          {mine && !mine.doing.length && !mine.pool.length && !mine.done.length ? (
            <Text style={{ color: colors.textMuted, fontSize: typeScale.small, lineHeight: 18 }} testID="rail-tasks-board-empty">项管表里还没有分给 {alias} 的任务。</Text>
          ) : null}
          {mine ? (['doing', 'pool', 'done'] as const).map(col => (mine[col].length ? (
            <View key={col} style={{ gap: spacing.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 2 }}>
                <View style={{ width: 7, height: 7, borderRadius: radius.pill, backgroundColor: STATUS_TONE[col]() }} />
                <Text style={{ color: colors.text, fontSize: typeScale.small, fontWeight: weight.strong }}>
                  {col === 'done' ? '最近完成' : REQ_COLUMN_LABEL[col]}
                </Text>
                <View style={{ minWidth: 20, height: 18, paddingHorizontal: 6, borderRadius: radius.pill, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: weight.strong, fontVariant: ['tabular-nums'] }}>{mine[col].length}</Text>
                </View>
              </View>
              <View style={{ gap: spacing.sm }}>
                {mine[col].map(r => (
                  <BoardCard key={r.id} req={r} col={col} today={today} onOpen={() => handleOpenRequirement(r)} />
                ))}
              </View>
            </View>
          ) : null)) : null}
        </View>
      )}
    </View>
  );
}

function BoardCard({ req, col, today, onOpen }: { req: Requirement; col: ReqColumn; today: string; onOpen: () => void }) {
  const prioColor = priorityColor(req.priority);
  const prioCode = PRIORITY_CODE[req.priority] ?? 'P1';
  const prioTone = req.priority === 'high'
    ? { backgroundColor: prioColor + '1a', borderColor: 'transparent' }
    : req.priority === 'normal'
      ? { backgroundColor: colors.subtleFill, borderColor: 'transparent' }
      : { backgroundColor: 'transparent', borderColor: prioColor };
  const due = dueInfo(req.due, today, req.archived ? 'done' : col);
  const seq = shortIdLabel(req);
  const hasChildren = !!(req.children && req.children.total > 0);
  const childrenComplete = hasChildren && req.children!.done >= req.children!.total;
  const tags = req.tags?.slice(0, 3) ?? [];

  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`打开任务：${req.name}`}
      testID={`rail-req-${req.id}`}
      style={(state: { pressed: boolean; hovered?: boolean }) => [
        {
          backgroundColor: colors.card,
          borderRadius: radius.surface,
          paddingHorizontal: spacing.md,
          paddingVertical: 11,
          gap: 8,
          ...softShadow(),
        },
        state.hovered && { backgroundColor: colors.rowHover },
        state.pressed && { opacity: 0.85 },
      ]}
    >
      {(state: { pressed: boolean; hovered?: boolean }) => (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
            <Text
              style={{ flex: 1, minWidth: 0, color: colors.text, fontSize: 13.5, fontWeight: weight.medium, lineHeight: 19 }}
              numberOfLines={2}
            >
              {req.name}
            </Text>
            <Ionicons
              name="open-outline"
              size={14}
              color={state.hovered ? colors.accent : colors.textMuted}
              style={{ marginTop: 2, flexShrink: 0 }}
            />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
            <View style={[{ height: 19, minWidth: 26, paddingHorizontal: 6, borderRadius: radius.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center' }, prioTone]}>
              <Text style={{ fontSize: 11, fontWeight: weight.strong, color: prioColor, lineHeight: 13 }}>{prioCode}</Text>
            </View>
            {due.tone !== 'none' ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, height: 19, paddingHorizontal: 7, borderRadius: radius.pill, backgroundColor: dueBg(due.tone) }}>
                <Ionicons name={due.tone === 'overdue' ? 'alert-circle-outline' : 'calendar-outline'} size={11} color={dueColor(due.tone)} />
                <Text style={{ fontSize: 11, fontWeight: weight.medium, color: dueColor(due.tone) }} numberOfLines={1}>{due.label}</Text>
              </View>
            ) : null}
            {hasChildren ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, height: 19, paddingHorizontal: 6, borderRadius: radius.pill, backgroundColor: colors.subtleFill }}>
                <Ionicons name={childrenComplete ? 'checkmark-circle' : 'checkbox-outline'} size={11} color={childrenComplete ? colors.running : colors.textMuted} />
                <Text style={{ fontSize: 11, color: childrenComplete ? colors.running : colors.textSecondary, fontVariant: ['tabular-nums'] }}>
                  {req.children!.done}/{req.children!.total}
                </Text>
              </View>
            ) : null}
            {seq ? (
              <Text style={{ marginLeft: 'auto', color: colors.textMuted, fontSize: 11, fontVariant: ['tabular-nums'] }}>{seq}</Text>
            ) : null}
          </View>
          {tags.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
              {tags.map(tag => (
                <View key={tag} style={{ backgroundColor: colors.subtleFill, borderRadius: radius.control, paddingHorizontal: 7, paddingVertical: 2, maxWidth: '100%' }}>
                  <Text style={{ color: colors.textSecondary, fontSize: 11 }} numberOfLines={1}>{tag}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </>
      )}
    </Pressable>
  );
}
