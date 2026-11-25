// 聊天右侧「任务」面板（admin 2026-11-19「一个是 send_task 的，一个是项目管理表的，项管表里面的项管任务也需要有个入口」
// /「这是两个不同的任务」）：两个页签分开放 ——
//   派给它的：send_task 派来的消息任务（NodeTasksSection，同节点页那块）；
//   项管：项管表里负责 Agent / 负责人 / 参与者是这个 agent 的需求卡，按状态分组（进行中 / 需求池 / 最近完成）。
// 默认打开有内容的那个；两个页签都标数量。项管卡点一下展开截止时间、子任务进度。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Text } from './ui-text';
import type { HubConfig } from './api';
import NodeTasksSection from './NodeTasksSection';
import { listRequirementsFull } from './requirements-hub';
import { REQ_COLUMN_LABEL, type Requirement } from './requirements-model';
import { requirementsForAgent } from './rail-requirements';
import { colors, radius, spacing, type as typeScale, weight } from './theme';
import { usePoll } from './usePoll';

const POLL_MS = 60_000;

export default function RailTasksPanel({ cfg, alias, nodeId, onJumpToTask }: { cfg: HubConfig; alias: string; nodeId?: string | null; onJumpToTask?: (taskId: string) => void }) {
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

  const tabBtn = (key: 'sent' | 'board', label: string, count?: number) => {
    const on = current === key;
    return (
      <Pressable key={key} onPress={() => setTab(key)} accessibilityRole="tab" accessibilityState={{ selected: on }} testID={`rail-tasks-tab-${key}`}
        style={{ paddingHorizontal: spacing.md, height: 30, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: on ? colors.railActiveBg : 'transparent' }}>
        <Text style={{ color: on ? colors.accent : colors.textSecondary, fontSize: typeScale.small, fontWeight: on ? weight.strong : weight.regular }}>
          {label}{count !== undefined ? ` ${count}` : ''}
        </Text>
      </Pressable>
    );
  };

  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ flexDirection: 'row', gap: spacing.xs, backgroundColor: colors.subtleFill, borderRadius: radius.pill, padding: 3, alignSelf: 'flex-start' }} accessibilityRole="tablist">
        {tabBtn('sent', '派给它的')}
        {tabBtn('board', '项管', mine ? boardCount : undefined)}
      </View>
      {current === 'sent' ? <NodeTasksSection cfg={cfg} alias={alias} embedded onJumpToTask={onJumpToTask} /> : (
        <View style={{ gap: spacing.md }} testID="rail-tasks-board">
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
            <View key={col} style={{ gap: spacing.xs }}>
              <Text style={{ color: colors.textMuted, fontSize: typeScale.small }}>{col === 'done' ? '最近完成' : REQ_COLUMN_LABEL[col]} {mine[col].length}</Text>
              <View style={{ backgroundColor: colors.card, borderRadius: radius.surface, overflow: 'hidden' }}>
                {mine[col].map((r, i) => <BoardRow key={r.id} req={r} first={i === 0} />)}
              </View>
            </View>
          ) : null)) : null}
        </View>
      )}
    </View>
  );
}

function BoardRow({ req, first }: { req: Requirement; first: boolean }) {
  const [open, setOpen] = useState(false);
  const due = req.due ? req.due.slice(0, 10) : '';
  const progress = req.children && req.children.total ? `${req.children.done}/${req.children.total}` : '';
  return (
    <Pressable onPress={() => setOpen(v => !v)} accessibilityRole="button" accessibilityState={{ expanded: open }} testID={`rail-req-${req.id}`}
      style={({ pressed }) => [{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderTopWidth: first ? 0 : 1, borderTopColor: colors.border, gap: 2 }, pressed && { backgroundColor: colors.rowHover }]}>
      <Text style={{ color: colors.text, fontSize: typeScale.body, lineHeight: 20 }} numberOfLines={open ? undefined : 2}>{req.name}</Text>
      <Text style={{ color: colors.textMuted, fontSize: typeScale.small }}>
        {[due ? `截止 ${due}` : '', progress ? `子任务 ${progress}` : '', req.tags?.length ? req.tags.slice(0, 2).join(' · ') : ''].filter(Boolean).join(' · ') || '没有截止时间'}
      </Text>
    </Pressable>
  );
}
