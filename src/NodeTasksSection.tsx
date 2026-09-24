// app#157 —— 节点页「任务」区:正在运行 + 等待队列;2026-09-24 节点页重做后再加两组:
//   - 最近完成(终态,倒序,默认露出前几条);
//   - 自己发给自己的提醒(from === to,未结束):单独一组、默认折叠、**不计入运行中**
//     (有节点把 send_task→自己 当定时器用,只 ack 不回件,会把「运行中」堆到几十条)。
// 数据来自 /api/tasks?to_name=<alias>(与聊天时间线同一张表);分组是纯函数 node-task-groups.ts
// (运行中/队列仍由 node-tasks.ts 的 partitionNodeTasks( 决定)。这里只管取数、轮询、三种状态与刷新。
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { fetchTasks, type HubConfig } from './api';
import { elapsedLabel, type NodeTaskRow } from './node-tasks';
import { groupNodeTasks, type NodeTaskGroups } from './node-task-groups';
import { colors, onThemeChange, radius, spacing, type as typeScale, weight } from './theme';
import { usePoll } from './usePoll';

const POLL_MS = 10_000;
const LIMIT = 100;

type Load =
  | { kind: 'loading' }
  | { kind: 'ready'; groups: NodeTaskGroups; fetchedAt: number }
  | { kind: 'error'; message: string; groups?: NodeTaskGroups };

type RowKind = 'running' | 'queue' | 'self' | 'done';

function TaskRow({ row, index, kind, now }: { row: NodeTaskRow; index: number; kind: RowKind; now: Date }) {
  const [expanded, setExpanded] = useState(false);
  const age = elapsedLabel(row.since, now);
  const ageVerb = kind === 'running' ? '已运行' : kind === 'queue' ? '已等待' : kind === 'done' ? '' : '';
  const dot = kind === 'running' ? colors.running : kind === 'done' ? (row.status === 'failed' ? colors.failed : colors.rest) : colors.textMuted;
  return (
    <Pressable
      onPress={() => setExpanded(v => !v)}
      style={({ pressed }) => [{ paddingVertical: spacing.sm, gap: 4 }, pressed && { opacity: 0.7 }]}
      accessibilityLabel={`${kind === 'running' ? '运行中' : kind === 'queue' ? `队列第 ${index + 1}` : kind === 'done' ? '已结束' : '自投提醒'}:${row.summary}`}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        {kind === 'queue' ? (
          <Text style={{ color: colors.textMuted, fontSize: typeScale.small, minWidth: 18 }}>#{index + 1}</Text>
        ) : (
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot }} />
        )}
        <Text style={{ color: colors.text, fontSize: typeScale.body, flex: 1 }} numberOfLines={expanded ? undefined : 2} selectable={expanded}>
          {expanded ? row.content || row.summary : row.summary}
        </Text>
      </View>
      <Text style={{ color: colors.textMuted, fontSize: typeScale.small, marginLeft: kind === 'queue' ? 26 : 16 }}>
        {row.status}{row.from ? ` · 来自 ${row.from}` : ''}{age ? ` · ${ageVerb ? `${ageVerb} ` : ''}${age}${kind === 'done' || kind === 'self' ? '前' : ''}` : ''}{row.priority && row.priority !== 'normal' ? ` · ${row.priority}` : ''}
      </Text>
    </Pressable>
  );
}

function Group({ title, count, children, collapsible, defaultOpen = true, hint }: { title: string; count: number; children: React.ReactNode; collapsible?: boolean; defaultOpen?: boolean; hint?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  const card = { backgroundColor: colors.card, borderRadius: radius.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.md } as const;
  return (
    <View style={card}>
      <Pressable
        disabled={!collapsible}
        onPress={() => setOpen(v => !v)}
        accessibilityRole={collapsible ? 'button' : undefined}
        accessibilityState={collapsible ? { expanded: open } : undefined}
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: open ? spacing.xs : 0 }}
      >
        <Text style={{ color: colors.textSecondary, fontSize: typeScale.small, fontWeight: weight.strong }}>
          {title} <Text style={{ color: colors.textMuted, fontWeight: weight.regular }}>{count}</Text>
        </Text>
        {collapsible ? <Text style={{ color: colors.accent, fontSize: typeScale.small }}>{open ? '收起' : '展开'}</Text> : null}
      </Pressable>
      {open && hint ? <Text style={{ color: colors.textMuted, fontSize: typeScale.small, lineHeight: 18, marginBottom: spacing.xs }}>{hint}</Text> : null}
      {open ? children : null}
    </View>
  );
}

export default function NodeTasksSection({ cfg, alias, embedded = false }: { cfg: HubConfig; alias: string; embedded?: boolean }) {
  const [state, setState] = useState<Load>({ kind: 'loading' });
  const [, setThemeTick] = useState(0);
  useEffect(() => onThemeChange(() => setThemeTick(t => t + 1)), []);

  const load = useCallback(async () => {
    try {
      const data = await fetchTasks(cfg, { to_name: alias, limit: LIMIT });
      setState({ kind: 'ready', groups: groupNodeTasks(data.tasks, alias), fetchedAt: Date.now() });
    } catch (error) {
      // 拉取失败保留上一份分组(和节点页其余区块同一策略),只把错误写在旁边。
      setState(prev => ({ kind: 'error', message: String((error as Error)?.message ?? error), groups: prev.kind === 'ready' ? prev.groups : prev.kind === 'error' ? prev.groups : undefined }));
    }
  }, [cfg, alias]);

  useEffect(() => { void load(); }, [load]);
  usePoll(load, POLL_MS, [load]);

  const g = state.kind === 'loading' ? null : state.groups ?? null;
  const now = new Date();
  const empty = (text: string) => <Text style={{ color: colors.textMuted, fontSize: typeScale.body, paddingVertical: spacing.xs }}>{text}</Text>;

  return (
    <View style={{ paddingTop: embedded ? 0 : spacing.xl }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm }}>
        <Text style={{ color: colors.textMuted, fontSize: typeScale.small }}>
          {g ? `运行中 ${g.running.length} · 等待 ${g.queue.length}${g.selfOpen.length ? ` · 自投提醒 ${g.selfOpen.length}` : ''}` : '任务'}
        </Text>
        <Pressable onPress={() => void load()} hitSlop={8} accessibilityLabel="刷新任务">
          <Text style={{ color: colors.accent, fontSize: typeScale.small, fontWeight: weight.strong }}>刷新</Text>
        </Pressable>
      </View>
      {state.kind === 'loading' ? (
        <View style={{ backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <ActivityIndicator color={colors.textMuted} />
          <Text style={{ color: colors.textMuted, fontSize: typeScale.body }}>正在读取这个节点的任务…</Text>
        </View>
      ) : null}
      {state.kind === 'error' ? (
        <Text style={{ color: colors.failed, fontSize: typeScale.small, marginBottom: spacing.sm }}>读取失败:{state.message}{state.groups ? '(下面是上一次的结果)' : ''}</Text>
      ) : null}
      {g ? (
        <View style={{ gap: spacing.md }}>
          <Group title="正在运行" count={g.running.length}>
            {g.running.length ? g.running.map((row, i) => <TaskRow key={row.taskId} row={row} index={i} kind="running" now={now} />) : empty('没有正在运行的任务')}
          </Group>
          <Group title="等待队列(按执行顺序)" count={g.queue.length}>
            {g.queue.length ? g.queue.map((row, i) => <TaskRow key={row.taskId} row={row} index={i} kind="queue" now={now} />) : empty('队列是空的')}
          </Group>
          <Group title="最近完成" count={g.recent.length} collapsible defaultOpen>
            {g.recent.length ? g.recent.map((row, i) => <TaskRow key={row.taskId} row={row} index={i} kind="done" now={now} />) : empty('最近没有结束的任务')}
          </Group>
          {g.selfOpen.length ? (
            <Group
              title="自己发给自己的提醒"
              count={g.selfOpen.length}
              collapsible
              defaultOpen={false}
              hint="节点给自己发的定时提醒,收到只标已读、不回件,所以一直停在未结束。它们不算「运行中」。"
            >
              {g.selfOpen.slice(0, 20).map((row, i) => <TaskRow key={row.taskId} row={row} index={i} kind="self" now={now} />)}
              {g.selfOpen.length > 20 ? empty(`还有 ${g.selfOpen.length - 20} 条更早的`) : null}
            </Group>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
