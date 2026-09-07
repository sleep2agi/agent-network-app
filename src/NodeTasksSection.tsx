// app#157 —— 节点详情里的「任务」区:正在运行 + 等待队列。
// 数据来自 /api/tasks?to_name=<alias>(与聊天时间线同一张表),分组是纯函数 node-tasks.ts;
// 这里只管取数、轮询、三种状态(加载/空/错误)和手动刷新。终态任务不在这里(那是聊天时间线的事)。
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { fetchTasks, type HubConfig } from './api';
import { elapsedLabel, partitionNodeTasks, type NodeTaskPartition, type NodeTaskRow } from './node-tasks';
import { colors, onThemeChange, spacing } from './theme';
import { usePoll } from './usePoll';

const POLL_MS = 10_000;
const LIMIT = 100;

type Load =
  | { kind: 'loading' }
  | { kind: 'ready'; parts: NodeTaskPartition; fetchedAt: number }
  | { kind: 'error'; message: string; parts?: NodeTaskPartition };

function TaskRow({ row, index, running, now }: { row: NodeTaskRow; index: number; running: boolean; now: Date }) {
  const [expanded, setExpanded] = useState(false);
  const age = elapsedLabel(row.since, now);
  return (
    <Pressable onPress={() => setExpanded(v => !v)} style={({ pressed }) => [{ paddingVertical: spacing.sm, gap: 4 }, pressed && { opacity: 0.7 }]} accessibilityLabel={`${running ? '运行中' : `队列第 ${index + 1}`}:${row.summary}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        {running ? (
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.running }} />
        ) : (
          <Text style={{ color: colors.textMuted, fontSize: 12, minWidth: 18 }}>#{index + 1}</Text>
        )}
        <Text style={{ color: colors.text, fontSize: 14, flex: 1 }} numberOfLines={expanded ? undefined : 2} selectable={expanded}>
          {expanded ? row.content || row.summary : row.summary}
        </Text>
      </View>
      <Text style={{ color: colors.textMuted, fontSize: 12, marginLeft: running ? 16 : 26 }}>
        {row.status}{row.from ? ` · 来自 ${row.from}` : ''}{age ? ` · ${running ? '已运行' : '已等待'} ${age}` : ''}{row.priority && row.priority !== 'normal' ? ` · ${row.priority}` : ''}
      </Text>
    </Pressable>
  );
}

export default function NodeTasksSection({ cfg, alias }: { cfg: HubConfig; alias: string }) {
  const [state, setState] = useState<Load>({ kind: 'loading' });
  const [, setThemeTick] = useState(0);
  useEffect(() => onThemeChange(() => setThemeTick(t => t + 1)), []);

  const load = useCallback(async () => {
    try {
      const data = await fetchTasks(cfg, { to_name: alias, limit: LIMIT });
      setState({ kind: 'ready', parts: partitionNodeTasks(data.tasks), fetchedAt: Date.now() });
    } catch (error) {
      // 拉取失败保留上一份分组(和节点详情其余区块同一策略),只把错误写在旁边。
      setState(prev => ({ kind: 'error', message: String((error as Error)?.message ?? error), parts: prev.kind === 'ready' ? prev.parts : prev.kind === 'error' ? prev.parts : undefined }));
    }
  }, [cfg, alias]);

  useEffect(() => { void load(); }, [load]);
  usePoll(load, POLL_MS, [load]);

  const parts = state.kind === 'loading' ? null : state.parts ?? null;
  const now = new Date();
  const card = { backgroundColor: colors.card, borderRadius: 12, padding: spacing.lg } as const;

  return (
    <View style={{ paddingTop: spacing.xl }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm }}>
        <Text style={{ color: colors.textMuted, fontSize: 13 }}>
          任务{parts ? ` · 运行中 ${parts.running.length} · 等待 ${parts.queue.length}` : ''}
        </Text>
        <Pressable onPress={() => { setState(prev => (prev.kind === 'ready' ? prev : prev)); void load(); }} hitSlop={8} accessibilityLabel="刷新任务">
          <Text style={{ color: colors.accent, fontSize: 12, fontWeight: '600' }}>刷新</Text>
        </Pressable>
      </View>
      {state.kind === 'loading' ? (
        <View style={[card, { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }]}>
          <ActivityIndicator color={colors.textMuted} />
          <Text style={{ color: colors.textMuted, fontSize: 13 }}>正在读取这个节点的任务…</Text>
        </View>
      ) : null}
      {state.kind === 'error' ? (
        <Text style={{ color: colors.failed, fontSize: 12, marginBottom: spacing.sm }}>读取失败:{state.message}{state.parts ? '(下面是上一次的结果)' : ''}</Text>
      ) : null}
      {parts ? (
        <View style={{ gap: spacing.md }}>
          <View style={card}>
            <Text style={{ color: colors.textMuted, fontSize: 12, marginBottom: spacing.xs }}>正在运行</Text>
            {parts.running.length ? parts.running.map((row, i) => <TaskRow key={row.taskId} row={row} index={i} running now={now} />) : (
              <Text style={{ color: colors.textMuted, fontSize: 13 }}>没有正在运行的任务</Text>
            )}
          </View>
          <View style={card}>
            <Text style={{ color: colors.textMuted, fontSize: 12, marginBottom: spacing.xs }}>等待队列(按执行顺序)</Text>
            {parts.queue.length ? parts.queue.map((row, i) => <TaskRow key={row.taskId} row={row} index={i} running={false} now={now} />) : (
              <Text style={{ color: colors.textMuted, fontSize: 13 }}>队列是空的</Text>
            )}
          </View>
        </View>
      ) : null}
    </View>
  );
}
