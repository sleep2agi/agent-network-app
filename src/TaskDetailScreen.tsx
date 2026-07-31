import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AliasAvatar from './AliasAvatar';
import {
  fetchTaskDetail,
  fetchTaskEvents,
  HubConfig,
  HubTask,
  HubTaskEvent,
  FetchTaskEventsResult,
} from './api';
import {
  eventsResultToState,
  statusBucket,
  POLL_DETAIL_MS,
  type StatusBucket,
} from './tasks-filter';
import { colors, onThemeChange, spacing } from './theme';
import { formatTime } from './time';
import { usePoll } from './usePoll';

// Detail screen for one task. Mirrors the dashboard `/tasks` detail
// pane's four blocks (timeline, info, content, result), pared down for
// the phone: full-screen list of stacked cards, no side pane, no
// keyboard input. Events feed is a distinct fifth block with an
// explicit "not-wired" state — see api.ts fetchTaskEvents + eventsResultToState.

const BUCKET_COLOR: Record<StatusBucket, string> = {
  running: colors.running,
  failed: colors.failed,
  replied: colors.accent,
  pending: colors.blocked,
  unknown: colors.rest,
};

interface TimelineStep {
  key: string;
  label: string;
  at?: string;
}

function buildTimeline(task: HubTask): TimelineStep[] {
  return [
    { key: 'created',   label: '创建',   at: task.created_at },
    { key: 'delivered', label: '已送达', at: task.delivered_at },
    { key: 'started',   label: '开始',   at: task.started_at },
    { key: 'completed', label: '完成',   at: task.completed_at },
  ];
}

export default function TaskDetailScreen({
  cfg,
  taskId,
  onBack,
}: {
  cfg: HubConfig;
  taskId: string;
  onBack: () => void;
}) {
  const [task, setTask] = useState<HubTask | null>(null);
  const [taskLoaded, setTaskLoaded] = useState(false);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [eventsResult, setEventsResult] = useState<FetchTaskEventsResult | null>(null);

  const load = useCallback(async () => {
    try {
      const t = await fetchTaskDetail(cfg, taskId);
      setTask(t);
      setTaskError(null);
    } catch (e) {
      setTaskError(e instanceof Error ? e.message : String(e));
    } finally {
      setTaskLoaded(true);
    }
    // Events feed: fetch in parallel via its discriminated helper. Its
    // return type already encodes the three failure kinds — we never
    // swallow them. See tasks-filter.eventsResultToState().
    const evR = await fetchTaskEvents(cfg, taskId);
    setEventsResult(evR);
  }, [cfg, taskId]);

  useEffect(() => {
    setTask(null);
    setTaskLoaded(false);
    setTaskError(null);
    setEventsResult(null);
  }, [taskId]);

  usePoll(load, POLL_DETAIL_MS, [load]);

  const eventsState = eventsResultToState(eventsResult);

  return (
    <View
      style={styles.root}
      testID={`task-detail-screen-poll-detail-ms-${POLL_DETAIL_MS}`}
    >
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.backBtn} testID="task-detail-back">
          <Ionicons name="chevron-back" size={22} color={colors.text} />
          <Text style={styles.backText}>任务</Text>
        </Pressable>
        <Text style={styles.taskIdChip} numberOfLines={1}>
          {taskId}
        </Text>
      </View>

      {!taskLoaded ? (
        <View style={styles.center} testID="task-detail-loading">
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : taskError && !task ? (
        <View style={styles.center} testID="task-detail-error">
          <Text style={styles.errTitle}>加载任务详情失败</Text>
          <Text style={styles.errBody}>{taskError}</Text>
          <Pressable onPress={load} style={styles.retryBtn}>
            <Text style={styles.retryText}>重试</Text>
          </Pressable>
        </View>
      ) : !task ? (
        <View style={styles.center} testID="task-detail-not-found">
          <Text style={styles.errTitle}>找不到任务</Text>
          <Text style={styles.errBody}>task_id = {taskId}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
          {/* Block 1 — TIMELINE */}
          <Section title="时间线" testID="task-detail-block-timeline">
            <View style={styles.timelineRow}>
              {buildTimeline(task).map((step, i, arr) => (
                <View key={step.key} style={styles.timelineStep}>
                  <View
                    style={[
                      styles.timelineDot,
                      { backgroundColor: step.at ? colors.accent : colors.border },
                    ]}
                  />
                  <Text style={styles.timelineLabel}>{step.label}</Text>
                  <Text style={styles.timelineTime}>
                    {step.at ? formatTime(step.at) : '—'}
                  </Text>
                  {i < arr.length - 1 ? <View style={styles.timelineBar} /> : null}
                </View>
              ))}
            </View>
          </Section>

          {/* Block 2 — INFO */}
          <Section title="信息" testID="task-detail-block-info">
            <InfoRow label="task_id" value={task.task_id ?? '—'} monospace />
            <InfoRow
              label="状态"
              valueNode={
                <View style={styles.statusInline}>
                  <View
                    style={[
                      styles.statusDot,
                      { backgroundColor: BUCKET_COLOR[statusBucket(task.status)] },
                    ]}
                  />
                  <Text style={styles.infoVal}>{task.status || 'pending'}</Text>
                </View>
              }
            />
            <InfoRow
              label="优先级"
              value={task.priority === 'high' ? 'HIGH' : task.priority || 'normal'}
            />
            <InfoRow
              label="发起"
              valueNode={
                <View style={styles.aliasInline}>
                  <AliasAvatar alias={task.from_name || '?'} size={20} />
                  <Text style={styles.infoVal}>{task.from_name || '?'}</Text>
                </View>
              }
            />
            <InfoRow
              label="接收"
              valueNode={
                <View style={styles.aliasInline}>
                  <AliasAvatar alias={task.to_name || '?'} size={20} />
                  <Text style={styles.infoVal}>{task.to_name || '?'}</Text>
                </View>
              }
            />
            {task.expires_at ? (
              <InfoRow label="过期" value={formatTime(task.expires_at)} />
            ) : null}
          </Section>

          {/* Block 3 — CONTENT */}
          <Section title="内容" testID="task-detail-block-content">
            <Text style={styles.bodyText} selectable>
              {task.content || '（无内容）'}
            </Text>
          </Section>

          {/* Block 4 — RESULT (only if the task actually has a reply). Absence
              of a result is real (the task hasn't been replied yet) — render
              a visible "尚未回复" placeholder rather than dropping the block
              silently, per the /messages parity discipline that "empty" and
              "not wired" must look different. */}
          <Section title="结果" testID="task-detail-block-result">
            <Text
              style={[styles.bodyText, !task.result ? styles.bodyMuted : null]}
              selectable
            >
              {task.result || '尚未回复'}
            </Text>
          </Section>

          {/* Block 5 — EVENTS FEED — 4-state render, never silently omitted.
              🔴 A blank block can't distinguish "hub 未暴露" from "本来无 events"
              from "connection failed" — an unknown UI state has to say what
              it doesn't know AND where the user can look. Each state gets
              its own banner + testID so QA can tell them apart. */}
          <Section title="事件流" testID="task-detail-block-events">
            {eventsState.kind === 'loading' ? (
              <ActivityIndicator color={colors.textMuted} testID="task-events-loading" />
            ) : eventsState.kind === 'ok' ? (
              eventsState.count === 0 ? (
                <Text
                  style={[styles.bodyText, styles.bodyMuted]}
                  testID="task-events-ok-empty"
                >
                  暂无事件
                </Text>
              ) : (
                <View testID="task-events-ok-list">
                  {eventsState.events.map((ev, i) => (
                    <EventRow key={ev.id ?? i} ev={ev} />
                  ))}
                </View>
              )
            ) : eventsState.kind === 'not-wired' ? (
              <View style={styles.notWiredBanner} testID="task-events-not-wired">
                <Text style={styles.notWiredTitle}>事件流未接入</Text>
                <Text style={styles.notWiredBody}>
                  当前 hub 未暴露 /api/task_events（下划线路径）。App 只在 hub
                  升级或该 endpoint 上线后才能显示事件流。想查完整事件请到
                  dashboard /tasks。
                </Text>
                <Text style={styles.notWiredErr} numberOfLines={2}>
                  {eventsState.error}
                </Text>
              </View>
            ) : (
              <View style={styles.errorBanner} testID="task-events-error">
                <Text style={styles.errorTitleSm}>事件流暂时无法刷新</Text>
                <Text style={styles.errorBodySm}>{eventsState.error}</Text>
              </View>
            )}
          </Section>

          {/* Transient task-detail refresh error — the previously loaded
              task stays visible; we surface the error non-intrusively. */}
          {taskError && task ? (
            <Text
              style={styles.transientError}
              testID="task-detail-transient-error"
            >
              上次刷新失败: {taskError}
            </Text>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

function Section({
  title,
  children,
  testID,
}: {
  title: string;
  children: React.ReactNode;
  testID: string;
}) {
  return (
    <View style={styles.section} testID={testID}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function InfoRow({
  label,
  value,
  valueNode,
  monospace,
}: {
  label: string;
  value?: string;
  valueNode?: React.ReactNode;
  monospace?: boolean;
}) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLbl}>{label}</Text>
      {valueNode ? (
        <View style={{ flexShrink: 1 }}>{valueNode}</View>
      ) : (
        <Text
          style={[styles.infoVal, monospace ? styles.mono : null]}
          numberOfLines={1}
        >
          {value}
        </Text>
      )}
    </View>
  );
}

function EventRow({ ev }: { ev: HubTaskEvent }) {
  return (
    <View style={styles.eventRow}>
      <View style={styles.eventBullet} />
      <View style={{ flex: 1 }}>
        <Text style={styles.eventTitle} numberOfLines={1}>
          {ev.event_type || '(unnamed)'}
          {ev.from_status && ev.to_status ? (
            <Text style={styles.eventTransition}>
              {' '}
              {ev.from_status} → {ev.to_status}
            </Text>
          ) : null}
        </Text>
        {ev.detail ? (
          <Text style={styles.eventDetail} numberOfLines={2}>
            {ev.detail}
          </Text>
        ) : null}
        <Text style={styles.eventTime}>{formatTime(ev.created_at)}</Text>
      </View>
    </View>
  );
}

const makeStyles = () =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      gap: spacing.md,
    },
    backBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.xs },
    backText: { color: colors.text, fontSize: 15 },
    taskIdChip: {
      flex: 1,
      color: colors.textMuted,
      fontSize: 12,
      fontFamily: 'monospace',
      textAlign: 'right',
    },
    section: {
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 12,
      padding: spacing.lg,
      gap: spacing.sm,
    },
    sectionTitle: { color: colors.textSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },
    sectionBody: { gap: spacing.sm },
    timelineRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
    timelineStep: { flex: 1, alignItems: 'center', gap: 4, position: 'relative' },
    timelineDot: { width: 10, height: 10, borderRadius: 5 },
    timelineLabel: { color: colors.textSecondary, fontSize: 11 },
    timelineTime: { color: colors.textMuted, fontSize: 10, textAlign: 'center' },
    timelineBar: {
      position: 'absolute',
      top: 4,
      left: '60%',
      right: '-40%',
      height: 2,
      backgroundColor: colors.border,
      zIndex: -1,
    },
    infoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    infoLbl: { color: colors.textMuted, fontSize: 12 },
    infoVal: { color: colors.text, fontSize: 13, flexShrink: 1 },
    mono: { fontFamily: 'monospace', fontSize: 11 },
    statusInline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    statusDot: { width: 8, height: 8, borderRadius: 4 },
    aliasInline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    bodyText: { color: colors.text, fontSize: 14, lineHeight: 20 },
    bodyMuted: { color: colors.textMuted, fontStyle: 'italic' },
    notWiredBanner: {
      padding: spacing.md,
      backgroundColor: colors.blocked + '15',
      borderColor: colors.blocked,
      borderWidth: 1,
      borderRadius: 8,
      gap: spacing.xs,
    },
    notWiredTitle: { color: colors.blocked, fontSize: 13, fontWeight: '700' },
    notWiredBody: { color: colors.textSecondary, fontSize: 12, lineHeight: 17 },
    notWiredErr: { color: colors.textMuted, fontSize: 10, fontFamily: 'monospace' },
    errorBanner: {
      padding: spacing.md,
      backgroundColor: colors.failed + '15',
      borderColor: colors.failed,
      borderWidth: 1,
      borderRadius: 8,
      gap: 4,
    },
    errorTitleSm: { color: colors.failed, fontSize: 12, fontWeight: '600' },
    errorBodySm: { color: colors.textSecondary, fontSize: 11 },
    eventRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
      paddingVertical: spacing.xs + 2,
    },
    eventBullet: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent, marginTop: 6 },
    eventTitle: { color: colors.text, fontSize: 12, fontWeight: '600' },
    eventTransition: { color: colors.textMuted, fontWeight: '400' },
    eventDetail: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },
    eventTime: { color: colors.textMuted, fontSize: 10, marginTop: 2 },
    retryBtn: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      borderRadius: 8,
      backgroundColor: colors.accent + '22',
      borderColor: colors.accent,
      borderWidth: 1,
      marginTop: spacing.md,
    },
    retryText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
    errTitle: { color: colors.failed, fontSize: 14, fontWeight: '700', marginBottom: spacing.sm },
    errBody: { color: colors.textSecondary, fontSize: 12, textAlign: 'center' },
    transientError: {
      color: colors.failed,
      fontSize: 11,
      textAlign: 'center',
      marginTop: spacing.sm,
    },
  });

let styles = makeStyles();
onThemeChange(() => {
  styles = makeStyles();
});
