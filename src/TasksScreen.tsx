import { t as tr } from './i18n';
import { useTranslation } from './i18n-react';
import { taskText } from './i18n-tasks';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './ui-text';
import AliasAvatar from './AliasAvatar';
import { fetchTasks, HubConfig, HubTask } from './api';
import {
  filterTasks,
  deriveListState,
  statusBucket,
  TASK_FILTERS,
  POLL_LIST_MS,
  type TaskFilter,
  type StatusBucket,
} from './tasks-filter';
import { colors, onThemeChange, radius, spacing } from './theme';
import { formatTime } from './time';
import { usePoll } from './usePoll';
import RequirementBoard from './RequirementBoard';
import { buttonStyle, buttonTextStyle } from './elevation';

// Tasks tab. The page itself (header, 列表 / 看板 of the requirement pool) is
// RequirementBoard; this file owns the 派发记录 section — a scoped list of hub
// tasks with a segmented filter for the three states the brief pinned
// (running / failed / replied) + an "all" pass-through. Row press hands off to
// a detail screen owned by App.tsx routing.

const PAGE = 30;   // initial + increment for the lazy history window

const FILTER_LABEL: Record<TaskFilter, string> = {
  all: 'tasks.copy.34',
  running: 'tasks.copy.223',
  failed: 'tasks.copy.224',
  replied: 'tasks.copy.225',
};

const BUCKET_COLOR: Record<StatusBucket, string> = {
  running: colors.running,
  failed: colors.failed,
  replied: colors.accent,
  pending: colors.blocked,
  unknown: colors.rest,
};

export default function TasksScreen({
  cfg,
  onOpenTask,
  desktop,
  onOpenVoiceSettings,
}: {
  cfg: HubConfig;
  onOpenTask: (taskId: string) => void;
  /** 桌面工作区:派发记录在左栏(TaskFilterSidebar),看板可拖动。 */
  desktop?: boolean;
  /** 任务描述的语音输入未配置时「去设置」→ 设置 → 语音输入。 */
  onOpenVoiceSettings?: () => void;
}) {
  useTranslation();
  // 任务页 = 需求池(列表 / 看板)+ 派发记录。头部、筛选、新建都在 RequirementBoard;
  // 派发记录(Hub 上派给节点的任务,原来的「列表」)作为它的一个分区渲染在同一个头部下面。
  return <RequirementBoard cfg={cfg} desktop={desktop} onOpenVoiceSettings={onOpenVoiceSettings} dispatch={<DispatchLog cfg={cfg} onOpenTask={onOpenTask} />} />;
}

function DispatchLog({
  cfg,
  onOpenTask,
}: {
  cfg: HubConfig;
  onOpenTask: (taskId: string) => void;
}) {
  useTranslation();
  const [tasks, setTasks] = useState<HubTask[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [filter, setFilter] = useState<TaskFilter>('all');
  const [hasOlder, setHasOlder] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const limitRef = useRef(PAGE);

  const load = useCallback(
    async (limit: number) => {
      try {
        const data = await fetchTasks(cfg, { limit });
        const fetched = data.tasks ?? [];
        if (fetched.length < limit) setHasOlder(false);
        setTasks(fetched);
        setLastError(null);
      } catch (e) {
        setLastError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoaded(true);
      }
    },
    [cfg],
  );

  useEffect(() => {
    limitRef.current = PAGE;
    setLoaded(false);
    setHasOlder(true);
    setTasks(null);
    setLastError(null);
  }, [load]);

  usePoll(() => load(limitRef.current), POLL_LIST_MS, [load]);

  const loadOlder = async () => {
    if (loadingOlder || !hasOlder || !loaded) return;
    setLoadingOlder(true);
    limitRef.current += PAGE;
    await load(limitRef.current);
    setLoadingOlder(false);
  };

  const state = deriveListState({ loaded, tasks, lastError });
  const visible =
    state.kind === 'ready' ? filterTasks(state.tasks, filter) : [];
  const total = state.kind === 'ready' ? state.tasks.length : 0;

  return (
    // testID poll-list-ms reads the exported constant — SAME source as
    // the interval passed to usePoll above. Any change to POLL_LIST_MS
    // moves both simultaneously; witnessed-red on the constant reds
    // the assertion. See tasks-filter.test.ts + POLL_LIST_MS in
    // tasks-filter.ts (single source of truth).
    <View style={styles.root} testID={`tasks-screen-poll-list-ms-${POLL_LIST_MS}`}>
      {/* Segmented filter — horizontal scroll for narrow phones */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterScroll}
        contentContainerStyle={styles.filterRow}
      >
        {TASK_FILTERS.map(f => {
          const active = filter === f;
          const count =
            state.kind === 'ready'
              ? filterTasks(state.tasks, f).length
              : null;
          return (
            <Pressable
              key={f}
              onPress={() => setFilter(f)}
              style={[styles.chip, active && styles.chipActive]}
              testID={`tasks-filter-${f}`}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {tr(FILTER_LABEL[f])}
                {count !== null ? ` (${count})` : ''}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Count row — shows visible / denominator so a filter that reduces
          the list to zero can't hide as an unqualified "0 tasks". An
          empty result set has to report the input size alongside it:
          "0 out of 12 with filter=failed" reads very differently from
          just "0 tasks" (the latter looks like the fetch was empty). */}
      {state.kind === 'ready' ? (
        <View style={styles.countRow} testID="tasks-count">
          <Text style={styles.countText}>
            {filter === 'all'
              ? tr('tasks.copy.226', { v0: total })
              : tr('tasks.copy.227', { v0: visible.length, v1: total, v2: tr(FILTER_LABEL[filter]) })}
          </Text>
          {lastError ? (
            <Text style={styles.countError} testID="tasks-transient-error">
              {tr('tasks.copy.166')}{lastError}
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* Body — three explicit branches, never collapsed:
          loading spinner / error banner (with retry) / list.
          Empty-ready renders the list with an EmptyState footer. */}
      {state.kind === 'loading' ? (
        <View style={styles.center} testID="tasks-loading">
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : state.kind === 'error' ? (
        <View style={styles.center} testID="tasks-error">
          <Text style={styles.errorTitle}>{tr('tasks.copy.228')}</Text>
          <Text style={styles.errorBody}>{state.message}</Text>
          <Pressable
            onPress={() => load(limitRef.current)}
            style={styles.retryBtn}
          >
            <Text style={styles.retryText}>{tr('tasks.copy.57')}</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={t => t.task_id || `${t.from_name}-${t.to_name}-${t.created_at}`}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xl }}
          onEndReached={loadOlder}
          onEndReachedThreshold={0.2}
          ListFooterComponent={
            loadingOlder ? (
              <ActivityIndicator color={colors.textMuted} style={{ marginVertical: spacing.md }} />
            ) : !hasOlder && visible.length > 0 ? (
              <Text style={styles.beginning}>{tr('tasks.copy.229')}</Text>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.emptyBox} testID="tasks-empty">
              <Text style={styles.emptyTitle}>
                {filter === 'all' ? tr('tasks.copy.230') : tr('tasks.copy.231', { v0: tr(FILTER_LABEL[filter]) })}
              </Text>
              <Text style={styles.emptySub}>
                {filter === 'all'
                  ? tr('tasks.copy.232')
                  : tr('tasks.copy.233')}
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const bucket = statusBucket(item.status);
            const badge = BUCKET_COLOR[bucket];
            const tid = item.task_id;
            return (
              <Pressable
                style={styles.card}
                onPress={() => tid && onOpenTask(tid)}
                disabled={!tid}
                testID={`tasks-row-${tid || 'noid'}`}
              >
                <View style={styles.headerRow}>
                  <View style={[styles.statusDot, { backgroundColor: badge }]} />
                  <Text style={styles.status} numberOfLines={1}>
                    {item.status || 'pending'}
                  </Text>
                  {item.priority === 'high' ? (
                    <Text style={styles.high}>HIGH</Text>
                  ) : null}
                  <Text style={styles.time}>{formatTime(item.created_at)}</Text>
                </View>
                <View style={styles.aliasRow}>
                  <AliasAvatar alias={item.from_name || '?'} size={22} />
                  <Text style={styles.aliasText} numberOfLines={1}>
                    {item.from_name || '?'}
                  </Text>
                  <Text style={styles.aliasArrow}>→</Text>
                  <AliasAvatar alias={item.to_name || '?'} size={22} />
                  <Text style={styles.aliasText} numberOfLines={1}>
                    {item.to_name || '?'}
                  </Text>
                </View>
                <Text style={styles.preview} numberOfLines={2}>
                  {item.content || tr('tasks.copy.158')}
                </Text>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const makeStyles = () =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
    // 0.2.80(Vincent 2026-09-19 截图):桌面端四个筛选 chip 被撑成整屏高的竖条。
    // 这一行是 `root: { flex: 1 }` 里的横向 ScrollView,react-native-web 下它保留
    // 默认的 flex-grow: 1 ⇒ 吃掉整块剩余高度,内容行默认 align-items: stretch 再把
    // 每个 chip 拉到那么高。实测(同一个运行中的构建,一次只改一处):
    //   原样                        chip 361px / 容器 385px
    //   只给内容行 alignItems:center chip  31px / 容器 385px ← chip 好了,底下留 330px 空带
    //   只给 ScrollView flexGrow:0   chip  31px / 容器  55px ← 两个都好了
    // 所以承重的是 flexGrow: 0,而且必须落在 ScrollView 的 style 上——它和
    // contentContainerStyle 是两个不同的元素。横向滚动本身要保留(窄窗口用)。
    filterScroll: { flexGrow: 0 },
    filterRow: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      gap: spacing.sm,
      flexDirection: 'row',
    },
    // 极简:筛选从描边胶囊改为安静的分段标签——未选中无底无框,选中一档中性底色 + 正文色。
    chip: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs + 2,
      borderRadius: radius.pill,
    },
    chipActive: {
      backgroundColor: colors.rowActive,
    },
    chipText: { color: colors.textSecondary, fontSize: 12, fontWeight: '500' },
    chipTextActive: { color: colors.text, fontWeight: '600' },
    countRow: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.sm,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    countText: { color: colors.textMuted, fontSize: 11 },
    countError: { color: colors.failed, fontSize: 11 },
    // 极简:任务卡不描边,靠卡片色与地面的一档差区分;圆角进 token。
    card: {
      backgroundColor: colors.card,
      borderRadius: radius.surface,
      padding: spacing.lg,
      marginBottom: spacing.sm,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginBottom: spacing.xs,
    },
    statusDot: { width: 8, height: 8, borderRadius: radius.pill },
    status: { color: colors.textSecondary, fontSize: 12, fontWeight: '600', flex: 1 },
    high: { color: colors.failed, fontSize: 10, fontWeight: '600' },
    time: { color: colors.textMuted, fontSize: 10 },
    aliasRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs + 2,
      marginBottom: spacing.xs,
    },
    aliasText: { color: colors.text, fontSize: 13, flexShrink: 1 },
    aliasArrow: { color: colors.textMuted, fontSize: 12 },
    preview: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
    beginning: {
      color: colors.textMuted,
      fontSize: 11,
      textAlign: 'center',
      marginVertical: spacing.md,
    },
    emptyBox: { alignItems: 'center', paddingVertical: spacing.xl * 2, gap: spacing.sm },
    emptyTitle: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
    emptySub: { color: colors.textMuted, fontSize: 12 },
    errorTitle: { color: colors.failed, fontSize: 14, fontWeight: '600', marginBottom: spacing.sm },
    errorBody: { color: colors.textSecondary, fontSize: 12, textAlign: 'center', marginBottom: spacing.md },
    retryBtn: { ...buttonStyle('secondary') },
    retryText: { ...buttonTextStyle('secondary') },
  });

let styles = makeStyles();
onThemeChange(() => {
  styles = makeStyles();
});
