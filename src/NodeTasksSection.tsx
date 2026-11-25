// app#157 —— 节点页「任务」区:进行中 + 排队;2026-09-25 重做(Vincent「任务的展示也非常难看」):
//   - 签收后超过一天没动静的件从「进行中」拆到「可能卡住」(默认折叠),见 node-task-view.ts 的 splitStale(;
//   - 预览去掉 markdown 符号和与「来自 X」重复的【X → Y】抬头;发件人头像 + 相对时间;优先级只在非常态时出标签;
//   - 点开用聊天同一个 MarkdownMessage 渲染全文。
// 2026-09-24 节点页重做时加的两组:
//   - 最近完成(终态,倒序,默认露出前几条);
//   - 自己发给自己的提醒(from === to,未结束):单独一组、默认折叠、**不计入运行中**
//     (有节点把 send_task→自己 当定时器用,只 ack 不回件,会把「运行中」堆到几十条)。
// 数据来自 /api/tasks?to_name=<alias>(与聊天时间线同一张表);分组是纯函数 node-task-groups.ts
// (运行中/队列仍由 node-tasks.ts 的 partitionNodeTasks( 决定)。这里只管取数、轮询、三种状态与刷新。
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Text } from './ui-text';
import { Ionicons } from './icons';
import { fetchTasks, type HubConfig } from './api';
import AliasAvatar from './AliasAvatar';
import MarkdownMessage, { WRAP_ANYWHERE } from './MarkdownMessage';
import { type NodeTaskRow } from './node-tasks';
import { collapseRepeats, quietPriorityPill, relativeTime, senderLabel, splitStale, taskPreview, type PillTone } from './node-task-view';
import { groupNodeTasks, type NodeTaskGroups } from './node-task-groups';
import { colors, onThemeChange, radius, spacing, type as typeScale, weight } from './theme';
import { usePoll } from './usePoll';
import TaskExecutionNotice from './TaskExecutionNotice';

const POLL_MS = 10_000;
const LIMIT = 100;

type Load =
  | { kind: 'loading' }
  | { kind: 'ready'; groups: NodeTaskGroups; fetchedAt: number }
  | { kind: 'error'; message: string; groups?: NodeTaskGroups };

type RowKind = 'running' | 'stale' | 'queue' | 'self' | 'done';

// 时间后缀:进行中看「最后一次动静」,卡住的说清是「从那时起没动静」。
const TIME_SUFFIX: Record<RowKind, string> = { running: '更新', stale: '起没有动静', queue: '入队', self: '', done: '结束' };

function Pill({ label, tone }: { label: string; tone: PillTone }) {
  const color = tone === 'danger' ? colors.failed : tone === 'warn' ? colors.blocked : colors.textMuted;
  return (
    <View style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: color, paddingHorizontal: 6, paddingVertical: 1 }}>
      <Text style={{ color, fontSize: 11, lineHeight: 15, fontWeight: weight.strong }}>{label}</Text>
    </View>
  );
}

function TaskRow({ row, index, kind, now, onJumpToTask }: { row: NodeTaskRow & { repeat?: number }; index: number; kind: RowKind; now: Date; onJumpToTask?: (taskId: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const when = relativeTime(kind === 'running' || kind === 'stale' ? row.lastActivity ?? row.since : row.since, now);
  const preview = taskPreview(row.content || row.summary, row.from);
  const pill = quietPriorityPill(row.priority);
  const who = senderLabel(row.from);
  const repeat = row.repeat ?? 1;
  const failed = kind === 'done' && ['failed', 'timeout', 'expired'].includes(row.status);
  const muted = kind === 'stale' || kind === 'self';
  const replyText = (row.result ?? '').trim();
  return (
    <View style={[{ marginHorizontal: -spacing.sm, borderRadius: radius.control }, expanded && { backgroundColor: colors.rowHover }]}>
      <Pressable
        onPress={() => setExpanded(v => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`来自 ${who}:${preview}`}
        style={(state: { pressed: boolean; hovered?: boolean }) => [
          { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.sm, borderRadius: radius.control },
          state.hovered && !expanded && { backgroundColor: colors.rowHover },
          state.pressed && { opacity: 0.8 },
        ]}
      >
        <View style={{ opacity: muted ? 0.6 : 1 }}>
          <AliasAvatar alias={row.from} size={28} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
              <Text style={{ color: muted ? colors.textMuted : colors.textSecondary, fontSize: typeScale.small, fontWeight: weight.strong }} numberOfLines={1}>{who}</Text>
              {when ? <Text style={{ color: colors.textMuted, fontSize: typeScale.small }}>{repeat > 1 ? `最近 ${repeat} 次 · 最后一次` : ''}{when}{TIME_SUFFIX[kind]}</Text> : null}
              {pill ? <Pill label={pill.label} tone={pill.tone} /> : null}
              {failed ? <Pill label="失败" tone="danger" /> : null}
            </View>
            <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textMuted} />
          </View>
          {kind === 'running' || kind === 'stale' || kind === 'queue' ? <TaskExecutionNotice task={{ status: row.status, runtime_submitted_at: row.runtimeSubmittedAt, consumed_at: row.consumedAt }} /> : null}
          {!expanded ? (
            <Text style={[{ color: muted ? colors.textSecondary : colors.text, fontSize: typeScale.body, lineHeight: 21 }, WRAP_ANYWHERE]} numberOfLines={2}>
              {preview}
            </Text>
          ) : null}
        </View>
      </Pressable>
      {expanded ? (
        <View testID={`node-task-expanded-${row.taskId}`} style={{ paddingHorizontal: spacing.sm, paddingBottom: spacing.sm, gap: spacing.sm }}>
          <View style={{ backgroundColor: colors.subtleFill, borderRadius: radius.control, padding: spacing.sm, gap: spacing.sm }}>
            <View style={{ gap: 4 }}>
              <Text style={{ color: colors.textMuted, fontSize: typeScale.small, fontWeight: weight.strong }}>任务内容</Text>
              <MarkdownMessage>{row.content || row.summary}</MarkdownMessage>
            </View>
            {kind === 'done' ? (
              <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, gap: 4 }}>
                <Text style={{ color: colors.textMuted, fontSize: typeScale.small, fontWeight: weight.strong }}>回复结果</Text>
                {replyText ? (
                  <MarkdownMessage>{replyText}</MarkdownMessage>
                ) : (
                  <Text style={{ color: colors.textMuted, fontSize: typeScale.small }}>暂无回复内容</Text>
                )}
              </View>
            ) : null}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: onJumpToTask ? 'space-between' : 'flex-end', paddingHorizontal: 2 }}>
            {onJumpToTask ? (
              <Pressable
                onPress={() => onJumpToTask(row.taskId)}
                hitSlop={6}
                accessibilityRole="button"
                testID={`node-task-jump-${row.taskId}`}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 4, opacity: pressed ? 0.7 : 1 })}
              >
                <Ionicons name="chatbubble-ellipses-outline" size={13} color={colors.accent} />
                <Text style={{ color: colors.accent, fontSize: typeScale.small, fontWeight: weight.strong }}>定位到聊天</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => setExpanded(false)}
              hitSlop={6}
              accessibilityRole="button"
              style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
            >
              <Text style={{ color: colors.textMuted, fontSize: typeScale.small }}>收起</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function Group({ title, count, children, collapsible, defaultOpen = true, hint, quiet }: { title: string; count: number; children: React.ReactNode; collapsible?: boolean; defaultOpen?: boolean; hint?: string; quiet?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  // quiet:只描边不填底,给「可能卡住」这类次要分组,视觉上退后一层。
  const card = quiet
    ? { borderRadius: radius.surface, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.lg, paddingVertical: spacing.md }
    : { backgroundColor: colors.card, borderRadius: radius.surface, paddingHorizontal: spacing.lg, paddingVertical: spacing.md };
  return (
    <View style={card}>
      <Pressable
        disabled={!collapsible}
        onPress={() => setOpen(v => !v)}
        accessibilityRole={collapsible ? 'button' : undefined}
        accessibilityState={collapsible ? { expanded: open } : undefined}
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
      >
        <Text style={{ color: colors.text, fontSize: typeScale.body, fontWeight: weight.strong }}>
          {title} <Text style={{ color: colors.textMuted, fontWeight: weight.regular }}>{count}</Text>
        </Text>
        {collapsible ? <Text style={{ color: colors.accent, fontSize: typeScale.small }}>{open ? '收起' : '展开'}</Text> : null}
      </Pressable>
      {hint ? <Text style={{ color: colors.textMuted, fontSize: typeScale.small, lineHeight: 18, marginTop: 2 }}>{hint}</Text> : null}
      {open ? <View style={{ marginTop: spacing.sm }}>{children}</View> : null}
    </View>
  );
}

export default function NodeTasksSection({ cfg, alias, embedded = false, onJumpToTask }: { cfg: HubConfig; alias: string; embedded?: boolean; onJumpToTask?: (taskId: string) => void }) {
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
  const split = g ? splitStale(g.running, now) : { active: [], stale: [] };
  const empty = (text: string) => <Text style={{ color: colors.textMuted, fontSize: typeScale.body, paddingVertical: spacing.xs }}>{text}</Text>;

  return (
    <View style={{ paddingTop: embedded ? 0 : spacing.xl }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm }}>
        <Text style={{ color: colors.textMuted, fontSize: typeScale.small }}>
          {g ? `进行中 ${split.active.length} · 排队 ${g.queue.length}${split.stale.length ? ` · 可能卡住 ${split.stale.length}` : ''}` : '任务'}
        </Text>
        <Pressable onPress={() => void load()} hitSlop={8} accessibilityLabel="刷新任务">
          <Text style={{ color: colors.accent, fontSize: typeScale.small, fontWeight: weight.strong }}>刷新</Text>
        </Pressable>
      </View>
      {state.kind === 'loading' ? (
        <View style={{ backgroundColor: colors.card, borderRadius: radius.surface, padding: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <ActivityIndicator color={colors.textMuted} />
          <Text style={{ color: colors.textMuted, fontSize: typeScale.body }}>正在读取这个节点的任务…</Text>
        </View>
      ) : null}
      {state.kind === 'error' ? (
        <Text style={{ color: colors.failed, fontSize: typeScale.small, marginBottom: spacing.sm }}>读取失败:{state.message}{state.groups ? '(下面是上一次的结果)' : ''}</Text>
      ) : null}
      {g ? (
        <View style={{ gap: spacing.md }}>
          {/* admin 2026-11-19：没有进行中的任务时不占一整张卡，只留一行灰字。 */}
          {split.active.length ? (
            <Group title="进行中" count={split.active.length}>
              {split.active.map((row, i) => <TaskRow key={row.taskId} row={row} index={i} kind="running" now={now} onJumpToTask={onJumpToTask} />)}
            </Group>
          ) : <Text style={{ color: colors.textMuted, fontSize: typeScale.small }} testID="node-tasks-idle">{split.stale.length ? '最近一天没有在动的任务' : '现在没有正在进行的任务'}</Text>}
          {g.queue.length ? (
            <Group title="排队" count={g.queue.length} hint="按创建时间展示，当前没有精确执行名次">
              {collapseRepeats(g.queue).map((row, i) => <TaskRow key={row.taskId} row={row} index={i} kind="queue" now={now} onJumpToTask={onJumpToTask} />)}
            </Group>
          ) : null}
          {split.stale.length ? (
            <Group
              title="可能卡住"
              count={split.stale.length}
              collapsible
              defaultOpen={false}
              quiet
              hint="签收后超过一天没动静。多半是节点收到了但没有回件,不一定还在跑。"
            >
              {split.stale.map((row, i) => <TaskRow key={row.taskId} row={row} index={i} kind="stale" now={now} onJumpToTask={onJumpToTask} />)}
            </Group>
          ) : null}
          <Group title="最近完成" count={g.recent.length} collapsible defaultOpen>
            {g.recent.length ? collapseRepeats(g.recent).map((row, i) => <TaskRow key={row.taskId} row={row} index={i} kind="done" now={now} onJumpToTask={onJumpToTask} />) : empty('最近没有结束的任务')}
          </Group>
          {g.selfOpen.length ? (
            <Group
              title="自己发给自己的提醒"
              count={g.selfOpen.length}
              collapsible
              defaultOpen={false}
              hint="节点给自己发的定时提醒,收到只标已读、不回件,所以一直停在未结束。它们不算「运行中」。"
            >
              {g.selfOpen.slice(0, 20).map((row, i) => <TaskRow key={row.taskId} row={row} index={i} kind="self" now={now} onJumpToTask={onJumpToTask} />)}
              {g.selfOpen.length > 20 ? empty(`还有 ${g.selfOpen.length - 20} 条更早的`) : null}
            </Group>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
