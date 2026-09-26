import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ActivityIndicator, Alert, BackHandler, Modal, Platform, Pressable, RefreshControl, ScrollView, StatusBar, StyleSheet, Switch, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, TextInput } from './ui-text';
import {
  cancelScheduledTask,
  createExternalScheduleEdit,
  createScheduledTask,
  fetchExternalScheduleEdits,
  fetchExternalSchedules,
  fetchHubNodes,
  fetchStatus,
  fetchScheduledRuns,
  fetchScheduledTasks,
  HubConfig,
  HubExternalSchedule,
  HubExternalScheduleEditIntent,
  HubNode,
  HubNodeExternalSchedules,
  HubScheduledRun,
  HubScheduledTask,
  HubMisfirePolicy,
  HubScheduleSpec,
  Session,
  ScheduledTaskError,
  runScheduledTaskNow,
  selectOpenIntents,
  setScheduledTaskStatus,
  updateScheduledTask,
} from './api';
import AliasAvatar from './AliasAvatar';
import MacTitleStrip from './mac-title-strip';
import WinTitleBar from './win-title-bar';
import NodePickerSheet, { NodePickerField } from './NodePicker';
import { pickerNodes } from './node-picker-model';
import { modalSafePadding } from './modal-safe-area';
import { loadChatPins } from './chat-pins';
import { loadScheduleTargetRecents, rememberScheduleTarget } from './schedule-target-recents';
import { colors, onThemeChange, radius, spacing, type as fontSize, weight } from './theme';
import { scheduledTaskActions } from './scheduled-task-actions';
import {
  DEFAULT_SCHEDULE_FILTER,
  countByStatus,
  describeMisfire,
  describeSchedule,
  emptyStateFor,
  filterChips,
  formatAbsolute,
  formatRelative,
  isMasterDetail,
  masterListWidth,
  reconcileSelection,
  runErrorText,
  runStatusMeta,
  scheduleRowModel,
  scheduleStatusMeta,
  visibleSchedules,
} from './scheduled-view-model';
import type { ScheduleStatus, StatusTone } from './scheduled-view-model';

const DAYS = ['日', '一', '二', '三', '四', '五', '六'];

const fmt = (value?: string | null) => {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : value;
};

const EXTERNAL_KIND_LABEL: Record<HubExternalSchedule['kind'], string> = {
  cron: 'crontab', systemd: 'systemd', tmux: 'tmux', playwright: 'playwright', custom: '自定义',
};
const EXTERNAL_STATUS_LABEL: Record<HubExternalSchedule['last_status'], string> = {
  success: '成功', failed: '失败', running: '运行中', unknown: '未知',
};
const INTENT_STATUS_LABEL: Record<HubExternalScheduleEditIntent['status'], string> = {
  pending: '待节点领取', delivered: '节点已领取', applied: '已应用', rejected: '被节点拒绝', expired: '已过期',
};

/** 与 Hub 端 parseManagedCronExpression 同一形状预检（五段、字符白名单），
 *  只为把明显敲错的输入挡在本地；权威校验仍在 Hub。 */
const looksLikeCron = (raw: string) => {
  const fields = raw.trim().split(/ +/);
  return fields.length === 5 && fields.every(f => /^[0-9*/,-]+$/.test(f));
};

const describeIntentPatch = (patch: HubExternalScheduleEditIntent['patch']) => [
  patch.enabled !== undefined ? (patch.enabled ? '启用' : '停用') : null,
  patch.cron ? `cron → ${patch.cron}` : null,
].filter(Boolean).join('，') || '—';

const editIntentErrorText = (e: unknown): string => {
  if (e instanceof ScheduledTaskError) {
    if (e.code === 'revision_conflict') return '计划在节点侧已变化，列表已刷新，请重新操作。';
    if (e.code === 'edit_in_flight') return '已有一条待应用的编辑意向，等节点确认后再试。';
    if (e.code === 'schedule_read_only') return '该计划为只读（仅托管 cron 条目可改）。';
    if (e.code === 'node_owner_required' || e.code === 'node_owner_unclaimed') return '仅节点 owner 能修改该节点的计划。';
    if (e.code === 'cross_network_node') return '节点不在当前网络内。';
  }
  return e instanceof Error ? e.message : String(e);
};

type IntervalUnit = 'seconds' | 'minutes' | 'hours' | 'days';

const toLocalDateTimeInput = (value: string) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const intervalFormValue = (seconds: number): { every: string; unit: IntervalUnit } => {
  if (seconds % 86400 === 0) return { every: String(seconds / 86400), unit: 'days' };
  if (seconds % 3600 === 0) return { every: String(seconds / 3600), unit: 'hours' };
  if (seconds % 60 === 0) return { every: String(seconds / 60), unit: 'minutes' };
  return { every: String(seconds), unit: 'seconds' };
};

const DEVICE_TIMEZONE = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined; } catch { return undefined; }
})();

const toneColor = (tone: StatusTone) =>
  tone === 'running' ? colors.running : tone === 'blocked' ? colors.blocked : tone === 'failed' ? colors.failed : colors.textMuted;

type ScheduleAction = 'toggle' | 'run' | 'cancel';

export default function ScheduledTasksScreen({ cfg }: { cfg: HubConfig }) {
  const [themeVersion, setThemeVersion] = useState(0);
  useEffect(() => onThemeChange(() => setThemeVersion(v => v + 1)), []);
  const styles = useMemo(makeStyles, [themeVersion]);
  const [items, setItems] = useState<HubScheduledTask[]>([]);
  const [nodes, setNodes] = useState<HubNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<HubScheduledTask | null>(null);
  const [cancelCandidate, setCancelCandidate] = useState<HubScheduledTask | null>(null);
  const [tab, setTab] = useState<'hub' | 'node'>('hub');
  const [filter, setFilter] = useState<ScheduleStatus>(DEFAULT_SCHEDULE_FILTER);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [runs, setRuns] = useState<{ id: string; runs: HubScheduledRun[]; error: string } | null>(null);
  const [external, setExternal] = useState<HubNodeExternalSchedules[]>([]);
  const [externalLoaded, setExternalLoaded] = useState(false);
  const [cronEdit, setCronEdit] = useState<{ node: HubNodeExternalSchedules; schedule: HubExternalSchedule } | null>(null);
  const [intents, setIntents] = useState<{ title: string; edits: HubExternalScheduleEditIntent[] } | null>(null);
  const [openIntents, setOpenIntents] = useState<Record<string, HubExternalScheduleEditIntent>>({});
  // 双栏按本屏实际宽度判断(Android 展开时本屏在导航栏右侧,不是整窗宽)。
  const { width: windowWidth } = useWindowDimensions();
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
  const wide = isMasterDetail(measuredWidth ?? windowWidth);

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const [scheduleData, nodeData] = await Promise.all([fetchScheduledTasks(cfg), fetchHubNodes(cfg)]);
      setItems(scheduleData.schedules || []);
      setNodes((nodeData.nodes || []).filter(n => n.node_id && n.alias));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, [cfg]);

  const loadExternal = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const rows = await fetchExternalSchedules(cfg);
      setExternal(rows);
      // 只查带托管条目的节点；非 owner 的 GET 会 403（node_owner_required）——
      // 静默跳过，代价只是那台节点看不到在途意向徽标。
      const lists = await Promise.all(rows.filter(n => n.schedules.some(x => x.editable === true)).map(async n => {
        try { return (await fetchExternalScheduleEdits(cfg, n.node_id)).edits || []; }
        catch { return []; }
      }));
      setOpenIntents(selectOpenIntents(lists.flat(), Date.now()));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExternalLoaded(true); setRefreshing(false);
    }
  }, [cfg]);

  useEffect(() => {
    const tick = tab === 'hub' ? load : loadExternal;
    void tick();
    const timer = setInterval(tick, 10_000);
    return () => clearInterval(timer);
  }, [tab, load, loadExternal]);

  const counts = useMemo(() => countByStatus(items), [items]);
  const visible = useMemo(() => visibleSchedules(items, filter), [items, filter]);
  // 选中项由当前筛选派生:宽屏总有一条(第一条),窄屏只有点过才有。
  const activeId = reconcileSelection(visible, selectedId, wide);
  const selected = visible.find(row => row.schedule_id === activeId) ?? null;
  const now = Date.now();

  const loadRuns = useCallback(async (scheduleId: string) => {
    try {
      const data = await fetchScheduledRuns(cfg, scheduleId);
      setRuns({ id: scheduleId, runs: data.runs || [], error: '' });
    } catch (e) {
      setRuns({ id: scheduleId, runs: [], error: e instanceof Error ? e.message : String(e) });
    }
  }, [cfg]);

  // 执行记录跟着选中项走;计划被执行过(last_run_at/revision 变了)再拉一次。
  const runsKey = selected ? `${selected.schedule_id}:${selected.last_run_at ?? ''}:${selected.revision}` : '';
  useEffect(() => {
    if (!selected) return;
    void loadRuns(selected.schedule_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runsKey, loadRuns]);

  // 窄屏详情:系统返回键回到列表(后注册的监听先被调用,盖过 App 的返回处理)。
  useEffect(() => {
    if (wide || !selected) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { setSelectedId(null); return true; });
    return () => sub.remove();
  }, [wide, selected]);

  const act = async (row: HubScheduledTask, action: ScheduleAction) => {
    setBusy(true); setError('');
    try {
      if (action === 'toggle') await setScheduledTaskStatus(cfg, row, row.status === 'active' ? 'paused' : 'active');
      if (action === 'run') await runScheduledTaskNow(cfg, row.schedule_id);
      if (action === 'cancel') await cancelScheduledTask(cfg, row.schedule_id);
      await load();
      if (action === 'run') await loadRuns(row.schedule_id);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const submitEditIntent = async (node: HubNodeExternalSchedules, schedule: HubExternalSchedule, patch: { enabled?: boolean; cron?: string }) => {
    if (typeof schedule.revision !== 'number') return;
    setBusy(true); setError('');
    try {
      await createExternalScheduleEdit(cfg, node.node_id, { schedule_id: schedule.id, base_revision: schedule.revision, patch });
      setCronEdit(null);
      Alert.alert('意向已提交', '节点在线时会自行应用并回执；结果见「意向记录」。');
    } catch (e) {
      setError(editIntentErrorText(e));
    } finally {
      setBusy(false);
      await loadExternal();
    }
  };

  const showIntents = async (node: HubNodeExternalSchedules) => {
    setBusy(true); setError('');
    try {
      const data = await fetchExternalScheduleEdits(cfg, node.node_id);
      setIntents({ title: `${node.alias} · 意向记录`, edits: data.edits || [] });
    } catch (e) { setError(editIntentErrorText(e)); }
    finally { setBusy(false); }
  };

  const openCreate = () => { setEditing(null); setShowForm(true); };

  const detail = selected ? (
    <ScheduleDetail
      row={selected}
      now={now}
      busy={busy}
      runs={runs?.id === selected.schedule_id ? runs : null}
      onBack={wide ? undefined : () => setSelectedId(null)}
      onEdit={row => { setEditing(row); setShowForm(true); }}
      onAction={(row, action) => void act(row, action)}
      onCancel={row => setCancelCandidate(row)}
    />
  ) : null;

  const hubBody = loading ? <View style={styles.center}><ActivityIndicator color={colors.accent} /></View> : (
    <View style={styles.hubBody}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll} contentContainerStyle={styles.chips}>
        {filterChips(counts, filter).map(chip => (
          <Pressable
            key={chip.status}
            testID={`schedule-filter-${chip.status}`}
            accessibilityRole="button"
            accessibilityState={{ selected: chip.selected }}
            onPress={() => { setFilter(chip.status); setSelectedId(null); }}
            style={[styles.chip, chip.selected && styles.chipActive]}
          >
            <Text style={chip.selected ? styles.chipTextActive : styles.chipText}>{chip.label}</Text>
            <Text style={chip.selected ? styles.chipCountActive : styles.chipCount}>{chip.count}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <View style={styles.masterDetail}>
        <View style={wide ? [styles.masterList, { width: masterListWidth(measuredWidth ?? windowWidth) }] : styles.flex}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.accent} />}
        >
          {visible.length === 0 ? (() => {
            const empty = emptyStateFor(filter, items.length);
            return (
              <View style={styles.empty} testID="schedule-empty">
                <Text style={styles.emptyTitle}>{empty.title}</Text>
                <Text style={styles.emptyBody}>{empty.body}</Text>
                {empty.showCreate ? <Pressable style={[styles.primarySmall, { marginTop: spacing.lg }]} onPress={openCreate}><Text style={styles.primaryText}>新建定时任务</Text></Pressable> : null}
              </View>
            );
          })() : visible.map(row => (
            <ScheduleRow
              key={row.schedule_id}
              row={row}
              now={now}
              busy={busy}
              selected={wide && row.schedule_id === activeId}
              onOpen={() => setSelectedId(row.schedule_id)}
              onToggle={() => void act(row, 'toggle')}
            />
          ))}
        </ScrollView>
        </View>
        {wide ? (
          <View style={styles.detailPane} testID="schedule-detail-pane">
            {detail ?? <View style={styles.center}><Text style={styles.muted}>选择一个计划查看详情</Text></View>}
          </View>
        ) : null}
      </View>
    </View>
  );

  return (
    <View style={styles.root} onLayout={e => setMeasuredWidth(e.nativeEvent.layout.width)}>
      {!wide && selected ? detail : <>
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={1}>定时任务</Text>
          <View style={styles.tabs}>
            {(['hub', 'node'] as const).map(value => (
              <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: tab === value }} onPress={() => setTab(value)} style={[styles.tabItem, tab === value && styles.tabActive]}>
                <Text style={tab === value ? styles.tabTextActive : styles.tabText}>{value === 'hub' ? 'Hub 计划' : '节点计划'}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.flex} />
          {tab === 'hub' ? <Pressable style={styles.primarySmall} onPress={openCreate}><Text style={styles.primaryText}>新建</Text></Pressable> : null}
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {tab === 'node' ? (
          !externalLoaded ? <View style={styles.center}><ActivityIndicator color={colors.accent} /></View> : (
            <ScrollView
              contentContainerStyle={styles.list}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadExternal(true)} tintColor={colors.accent} />}
            >
              <Text style={[styles.muted, { marginBottom: spacing.md }]}>节点上报的本机计划 · owner 可改托管 cron</Text>
              {external.length === 0 ? (
                <View style={styles.empty}><Text style={styles.emptyTitle}>暂无节点计划</Text><Text style={styles.emptyBody}>节点升级后会自动上报本机 crontab 等计划。</Text></View>
              ) : external.map(node => (
                <View key={node.node_id} style={styles.card}>
                  <View style={styles.cardTop}>
                    <Text style={styles.cardTitle}>{node.alias}</Text>
                    <Pressable disabled={busy} style={styles.action} onPress={() => void showIntents(node)}><Text style={styles.actionText}>意向记录</Text></Pressable>
                  </View>
                  <Text style={styles.meta}>快照：{fmt(node.observed_at)}{node.error ? ` · 上报异常（${node.error}）` : ''}</Text>
                  {node.schedules.length === 0 ? <Text style={[styles.muted, { marginTop: spacing.sm }]}>该节点未上报计划</Text> : node.schedules.map(sch => (
                    <View key={sch.id} style={styles.extRow}>
                      <View style={styles.cardTop}>
                        <Text style={styles.cardTitle}>{sch.name}</Text>
                        <Text style={[styles.badge, sch.enabled ? styles.badgeActive : styles.badgeIdle]}>{sch.enabled ? '启用' : '停用'}</Text>
                      </View>
                      <Text style={styles.meta}>{EXTERNAL_KIND_LABEL[sch.kind]} · {sch.frequency}</Text>
                      <Text style={styles.meta}>上次：{fmt(sch.last_run_at)}（{EXTERNAL_STATUS_LABEL[sch.last_status]}）　下次：{fmt(sch.next_run_at)}</Text>
                      {sch.last_error ? <Text style={styles.extError}>{sch.last_error}</Text> : null}
                      {sch.editable === true && sch.kind === 'cron' && typeof sch.revision === 'number' ? (() => {
                        const open = openIntents[`${node.node_id}:${sch.id}`];
                        return <>
                          {open ? <Text style={styles.intentBadge}>意向在途（{INTENT_STATUS_LABEL[open.status]}）：{describeIntentPatch(open.patch)}</Text> : null}
                          <View style={styles.actions}>
                            <Pressable disabled={busy || !!open} style={[styles.action, open && styles.actionDisabled]} onPress={() => void submitEditIntent(node, sch, { enabled: !sch.enabled })}><Text style={styles.actionText}>{sch.enabled ? '停用' : '启用'}</Text></Pressable>
                            <Pressable disabled={busy || !!open} style={[styles.action, open && styles.actionDisabled]} onPress={() => setCronEdit({ node, schedule: sch })}><Text style={styles.actionText}>改时间</Text></Pressable>
                          </View>
                        </>;
                      })() : null}
                    </View>
                  ))}
                </View>
              ))}
            </ScrollView>
          )
        ) : hubBody}
      </>}
      <ScheduleFormModal
        cfg={cfg}
        nodes={nodes}
        visible={showForm}
        editing={editing}
        onClose={() => { setShowForm(false); setEditing(null); }}
        onSaved={async () => { setShowForm(false); setEditing(null); await load(); }}
        onConflict={async () => {
          setShowForm(false); setEditing(null); await load();
          setError('计划已在其他设备更新，已刷新最新内容，请重新编辑。');
        }}
      />
      <CancelScheduleModal
        value={cancelCandidate}
        busy={busy}
        onClose={() => setCancelCandidate(null)}
        onConfirm={() => {
          const row = cancelCandidate;
          setCancelCandidate(null);
          if (row) void act(row, 'cancel');
        }}
      />
      <CronEditModal
        value={cronEdit}
        busy={busy}
        onClose={() => setCronEdit(null)}
        onSubmit={cron => { if (cronEdit) void submitEditIntent(cronEdit.node, cronEdit.schedule, { cron }); }}
      />
      <IntentsModal value={intents} onClose={() => setIntents(null)} />
    </View>
  );
}

function StatusPill({ label, tone }: { label: string; tone: StatusTone }) {
  const s = useMemo(makeStyles, [label, tone]);
  const c = toneColor(tone);
  return <Text style={[s.pill, { color: c, backgroundColor: `${c}1f` }]}>{label}</Text>;
}

/** 列表行:56–72dp。头像 = 执行节点;没有下次也没有上次时不画时间(不出「—」)。 */
function ScheduleRow({ row, now, busy, selected, onOpen, onToggle }: {
  row: HubScheduledTask;
  now: number;
  busy: boolean;
  selected: boolean;
  onOpen: () => void;
  onToggle: () => void;
}) {
  const s = useMemo(makeStyles, [row, selected]);
  const vm = scheduleRowModel(row, now, DEVICE_TIMEZONE);
  return (
    <View style={[s.row, selected && s.rowSelected]} testID={`schedule-row-${row.schedule_id}`}>
      <Pressable style={s.rowMain} onPress={onOpen} accessibilityRole="button" accessibilityLabel={`${vm.name}，${vm.status.label}`}>
        <AliasAvatar alias={vm.target} size={36} />
        <View style={s.rowText}>
          <View style={s.rowLine}>
            <Text style={s.rowName} numberOfLines={1}>{vm.name}</Text>
            <StatusPill label={vm.status.label} tone={vm.status.tone} />
          </View>
          <View style={s.rowLine}>
            <Text style={s.rowTarget} numberOfLines={1}>{vm.target}</Text>
            <Text style={s.scheduleChip} numberOfLines={1}>{vm.scheduleText}</Text>
            {vm.when ? <Text style={s.rowWhen} numberOfLines={1}>{vm.when.text}</Text> : null}
          </View>
        </View>
      </Pressable>
      {vm.toggle !== null ? (
        <Switch
          accessibilityLabel={vm.toggle ? `暂停 ${vm.name}` : `恢复 ${vm.name}`}
          value={vm.toggle}
          disabled={busy}
          onValueChange={onToggle}
          trackColor={{ true: colors.accent, false: colors.border }}
          thumbColor={colors.card}
        />
      ) : null}
    </View>
  );
}

function ScheduleDetail({ row, now, busy, runs, onBack, onEdit, onAction, onCancel }: {
  row: HubScheduledTask;
  now: number;
  busy: boolean;
  runs: { runs: HubScheduledRun[]; error: string } | null;
  onBack?: () => void;
  onEdit: (row: HubScheduledTask) => void;
  onAction: (row: HubScheduledTask, action: ScheduleAction) => void;
  onCancel: (row: HubScheduledTask) => void;
}) {
  const s = useMemo(makeStyles, [row]);
  const status = scheduleStatusMeta(row.status);
  const availableActions = scheduledTaskActions(row.status);
  const misfire = describeMisfire(row.misfire_policy);
  const timeLine = (raw: string | null | undefined, none: string) => {
    const abs = formatAbsolute(raw, now);
    return abs ? `${abs}（${formatRelative(raw, now)}）` : none;
  };
  return (
    <View style={s.flex} testID="schedule-detail">
      {onBack ? (
        <View style={s.detailBar}>
          <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="返回定时任务" style={s.backButton}>
            <Text style={s.backText}>‹ 定时任务</Text>
          </Pressable>
        </View>
      ) : null}
      <ScrollView contentContainerStyle={s.detailContent}>
        <View style={s.rowLine}>
          <Text style={s.detailTitle} selectable>{row.name}</Text>
          <StatusPill label={status.label} tone={status.tone} />
        </View>
        <View style={[s.rowLine, { marginTop: spacing.sm }]}>
          <AliasAvatar alias={row.target_alias} size={22} />
          <Text style={s.detailTarget}>{row.target_alias}</Text>
          {row.priority !== 'normal' ? <Text style={s.metaInline}>{row.priority === 'high' ? '高优先级' : '低优先级'}</Text> : null}
        </View>
        {availableActions.some(a => a !== 'history') ? <View style={s.actionsRow}>
          {availableActions.includes('run') && <Pressable disabled={busy} style={[s.primarySmall, busy && s.actionDisabled]} onPress={() => onAction(row, 'run')}><Text style={s.primaryText}>立即执行</Text></Pressable>}
          {availableActions.includes('toggle') && <Pressable disabled={busy} style={[s.action, busy && s.actionDisabled]} onPress={() => onAction(row, 'toggle')}><Text style={s.actionText}>{row.status === 'active' ? '暂停' : '恢复'}</Text></Pressable>}
          {availableActions.includes('edit') && <Pressable disabled={busy} style={[s.action, busy && s.actionDisabled]} onPress={() => onEdit(row)}><Text style={s.actionText}>编辑</Text></Pressable>}
          {availableActions.includes('cancel') && <Pressable disabled={busy} style={[s.action, s.danger, busy && s.actionDisabled]} onPress={() => onCancel(row)}><Text style={s.dangerText}>取消计划</Text></Pressable>}
        </View> : null}

        <Text style={s.sectionLabel}>任务内容</Text>
        <Text style={s.prompt} selectable>{row.task_content}</Text>

        <Text style={s.sectionLabel}>计划</Text>
        <View style={s.facts}>
          <Fact label="频率" value={describeSchedule(row.schedule, row.timezone, DEVICE_TIMEZONE, now)} />
          <Fact label="时区" value={row.timezone} />
          <Fact label="错过执行" value={misfire.short} hint={misfire.long} />
          <Fact label="下次执行" value={row.status === 'active' ? timeLine(row.next_run_at, '暂无') : row.status === 'paused' ? '已暂停，恢复后继续' : '不会再执行'} />
          <Fact label="上次执行" value={timeLine(row.last_run_at, '还没执行过')} last />
        </View>

        <Text style={s.sectionLabel}>执行记录</Text>
        {!runs ? <ActivityIndicator color={colors.accent} style={{ alignSelf: 'flex-start', marginTop: spacing.sm }} />
          : runs.error ? <Text style={s.error}>{runs.error}</Text>
          : runs.runs.length === 0 ? <Text style={s.muted}>还没有执行记录</Text>
          : <View style={s.facts}>{runs.runs.map((run, i) => {
            const meta = runStatusMeta(run.status);
            const err = runErrorText(run);
            return (
              <View key={run.run_id} style={[s.runRow, i === runs.runs.length - 1 && s.lastFact]}>
                <View style={s.flex}>
                  <Text style={s.runTime}>{formatAbsolute(run.scheduled_for, now) || run.scheduled_for}</Text>
                  {err ? <Text style={s.runError}>{err}</Text> : null}
                </View>
                <StatusPill label={meta.label} tone={meta.tone} />
              </View>
            );
          })}</View>}
      </ScrollView>
    </View>
  );
}

function Fact({ label, value, hint, last }: { label: string; value: string; hint?: string; last?: boolean }) {
  const s = useMemo(makeStyles, [label, value]);
  return (
    <View style={[s.fact, last && s.lastFact]}>
      <Text style={s.factLabel}>{label}</Text>
      <View style={s.flex}>
        <Text style={s.factValue} selectable>{value}</Text>
        {hint ? <Text style={s.factHint}>{hint}</Text> : null}
      </View>
    </View>
  );
}

function ScheduleFormModal({ cfg, nodes, visible, editing, onClose, onSaved, onConflict }: {
  cfg: HubConfig;
  nodes: HubNode[];
  visible: boolean;
  editing: HubScheduledTask | null;
  onClose: () => void;
  onSaved: () => void;
  onConflict: () => void;
}) {
  const styles = useMemo(makeStyles, [visible]);
  const [name, setName] = useState(''); const [task, setTask] = useState('');
  const [target, setTarget] = useState(''); const [kind, setKind] = useState<HubScheduleSpec['type']>('once');
  const [when, setWhen] = useState(''); const [every, setEvery] = useState('1'); const [unit, setUnit] = useState<IntervalUnit>('hours'); const [clock, setClock] = useState('09:00');
  const [weekdays, setWeekdays] = useState([1]); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [misfirePolicy, setMisfirePolicy] = useState<HubMisfirePolicy>('catch_up_once');
  const [priority, setPriority] = useState<'high' | 'normal' | 'low'>('normal');
  const detectedTimezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);
  const [timezone, setTimezone] = useState(detectedTimezone);
  // 执行节点选择器(NodePicker.tsx):状态点来自会话表,置顶与节点列表同一份,最近使用按本设备 + Hub 账号。
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [pins, setPins] = useState<string[]>([]);
  const [recents, setRecents] = useState<string[]>([]);
  const safe = modalSafePadding(Platform.OS, 'pageSheet', useSafeAreaInsets(), StatusBar.currentHeight);
  useEffect(() => {
    if (!visible) { setPickerOpen(false); return; }
    let live = true;
    fetchStatus(cfg).then(d => { if (live) setSessions(d.sessions ?? []); }).catch(() => { /* 没有状态就全画成离线,仍可选 */ });
    loadChatPins(cfg).then(p => { if (live) setPins(p); }).catch(() => {});
    loadScheduleTargetRecents(cfg).then(r => { if (live) setRecents(r); }).catch(() => {});
    return () => { live = false; };
  }, [visible, cfg]);
  const choices = useMemo(() => pickerNodes(nodes, sessions), [nodes, sessions]);
  const chosen = choices.find(n => n.node_id === target) ?? null;
  const fallbackAlias = editing && editing.target_node_id === target ? editing.target_alias : null;

  useEffect(() => {
    if (!visible) return;
    setError('');
    if (!editing) {
      setName(''); setTask(''); setTarget(''); setKind('once'); setWhen(''); setEvery('1'); setUnit('hours');
      setClock('09:00'); setWeekdays([1]); setMisfirePolicy('catch_up_once'); setPriority('normal'); setTimezone(detectedTimezone);
      return;
    }
    setName(editing.name); setTask(editing.task_content); setTarget(editing.target_node_id);
    setKind(editing.schedule.type); setMisfirePolicy(editing.misfire_policy || 'catch_up_once');
    setPriority(editing.priority); setTimezone(editing.timezone);
    if (editing.schedule.type === 'once') setWhen(toLocalDateTimeInput(editing.schedule.run_at));
    if (editing.schedule.type === 'interval') {
      const value = intervalFormValue(editing.schedule.every_seconds);
      setEvery(value.every); setUnit(value.unit);
    }
    if (editing.schedule.type === 'daily') setClock(editing.schedule.time);
    if (editing.schedule.type === 'weekly') { setClock(editing.schedule.time); setWeekdays(editing.schedule.weekdays); }
  }, [visible, editing, detectedTimezone]);

  const invalidSchedule = (kind === 'once' && !when) ||
    (kind === 'interval' && (!Number.isInteger(Number(every)) || Number(every) < (unit === 'seconds' ? 60 : 1))) ||
    (kind === 'weekly' && weekdays.length === 0);
  const submit = async () => {
    setBusy(true); setError('');
    try {
      let schedule: HubScheduleSpec;
      if (kind === 'once') schedule = { type: 'once', run_at: new Date(when).toISOString() };
      else if (kind === 'interval') {
        const multiplier = unit === 'seconds' ? 1 : unit === 'minutes' ? 60 : unit === 'hours' ? 3600 : 86400;
        schedule = { type: 'interval', every_seconds: Number(every) * multiplier };
      }
      else if (kind === 'daily') schedule = { type: 'daily', time: clock };
      else schedule = { type: 'weekly', time: clock, weekdays };
      const input = { name: name.trim(), target_node_id: target, task: task.trim(), priority, timezone: timezone.trim(), schedule, misfire_policy: misfirePolicy };
      if (editing) await updateScheduledTask(cfg, editing, input);
      else await createScheduledTask(cfg, input);
      onSaved();
    } catch (e) {
      if (e instanceof ScheduledTaskError && e.status === 409 && e.code === 'revision_conflict') { onConflict(); return; }
      setError(e instanceof Error ? e.message : String(e));
    }
    finally { setBusy(false); }
  };
  const cannotSave = busy || !name.trim() || !task.trim() || !target || !timezone.trim() || invalidSchedule;
  // Android edge-to-edge:Modal 画到状态栏 / 挖孔底下,根 View 按安全区垫(modal-safe-area.ts,#387 同一张表)。
  return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
    <View testID="schedule-form" style={[styles.modalRoot, safe]}>
      <MacTitleStrip />
      <WinTitleBar />
      <View testID="schedule-form-header" style={styles.modalHeader}><Pressable testID="schedule-form-cancel" onPress={onClose} style={styles.headerSide}><Text style={styles.link}>取消</Text></Pressable><Text testID="schedule-form-title" style={styles.modalTitle} numberOfLines={1}>{editing ? '编辑定时任务' : '新建定时任务'}</Text><Pressable testID="schedule-form-save" disabled={cannotSave} onPress={submit} style={[styles.headerSide, styles.headerSideEnd]}><Text style={[styles.link, cannotSave && styles.linkDisabled]}>保存</Text></Pressable></View>
      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Label text="名称"><TextInput style={styles.input} value={name} onChangeText={setName} placeholder="每日巡检" placeholderTextColor={colors.textMuted} /></Label>
        <Label text="执行节点"><NodePickerField node={chosen} fallbackAlias={fallbackAlias} onPress={() => setPickerOpen(true)} /></Label>
        <Label text="任务内容"><TextInput style={[styles.input, styles.textarea]} multiline value={task} onChangeText={setTask} placeholder="节点收到的任务" placeholderTextColor={colors.textMuted} /></Label>
        <Label text="优先级"><View style={styles.segment}>{(['high','normal','low'] as const).map((value) => <Pressable key={value} onPress={() => setPriority(value)} style={[styles.segmentItem, priority === value && styles.segmentActive]}><Text style={priority === value ? styles.segmentTextActive : styles.segmentText}>{value === 'high' ? '高' : value === 'low' ? '低' : '普通'}</Text></Pressable>)}</View></Label>
        <Label text="类型"><View style={styles.segment}>{(['once','interval','daily','weekly'] as const).map((x, i) => <Pressable key={x} onPress={() => setKind(x)} style={[styles.segmentItem, kind === x && styles.segmentActive]}><Text style={kind === x ? styles.segmentTextActive : styles.segmentText}>{['单次','间隔','每天','每周'][i]}</Text></Pressable>)}</View></Label>
        <Label text="错过执行"><View style={styles.segment}>{(['catch_up_once','skip'] as const).map((policy) => <Pressable key={policy} onPress={() => setMisfirePolicy(policy)} style={[styles.segmentItem, misfirePolicy === policy && styles.segmentActive]}><Text style={misfirePolicy === policy ? styles.segmentTextActive : styles.segmentText}>{policy === 'catch_up_once' ? '补跑一次' : '跳过本次'}</Text></Pressable>)}</View><Text style={styles.meta}>{misfirePolicy === 'catch_up_once' ? '适合新闻抓取；恢复后最多补跑一次' : '错过后等待下一周期'}</Text></Label>
        {kind === 'once' && <Label text="执行时间（ISO 或 YYYY-MM-DDTHH:mm）"><TextInput style={styles.input} autoCapitalize="none" value={when} onChangeText={setWhen} placeholder="2026-08-10T09:00" placeholderTextColor={colors.textMuted} /></Label>}
        <Label text="时区（IANA）"><TextInput style={styles.input} autoCapitalize="none" value={timezone} onChangeText={setTimezone} placeholder="Asia/Shanghai" placeholderTextColor={colors.textMuted} /></Label>
        {kind === 'interval' && <Label text="固定间隔"><TextInput style={styles.input} keyboardType="number-pad" value={every} onChangeText={setEvery} /><View style={[styles.segment, { marginTop: spacing.sm }]}>{(['seconds','minutes','hours','days'] as const).map((value, index) => <Pressable key={value} onPress={() => setUnit(value)} style={[styles.segmentItem, unit === value && styles.segmentActive]}><Text style={unit === value ? styles.segmentTextActive : styles.segmentText}>{['秒','分钟','小时','天'][index]}</Text></Pressable>)}</View></Label>}
        {(kind === 'daily' || kind === 'weekly') && <Label text="时间"><TextInput style={styles.input} value={clock} onChangeText={setClock} placeholder="09:00" placeholderTextColor={colors.textMuted} /></Label>}
        {kind === 'weekly' && <View style={styles.weekdays}>{DAYS.map((d, i) => <Pressable key={d} onPress={() => setWeekdays(v => v.includes(i) ? v.filter(x => x !== i) : [...v, i].sort())} style={[styles.day, weekdays.includes(i) && styles.dayActive]}><Text style={weekdays.includes(i) ? styles.dayTextActive : styles.segmentText}>{d}</Text></Pressable>)}</View>}
      </ScrollView>
      <NodePickerSheet
        visible={visible && pickerOpen}
        nodes={choices}
        selectedId={target}
        recents={recents}
        pinned={pins}
        onClose={() => setPickerOpen(false)}
        onSelect={n => { setTarget(n.node_id); setRecents(rememberScheduleTarget(cfg, recents, n.node_id)); setPickerOpen(false); }}
      />
    </View>
  </Modal>;
}

function Label({ text, children }: { text: string; children: ReactNode }) { const s = useMemo(makeStyles, []); return <View style={s.field}><Text style={s.label}>{text}</Text>{children}</View>; }

function CancelScheduleModal({ value, busy, onClose, onConfirm }: {
  value: HubScheduledTask | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const s = useMemo(makeStyles, [value]);
  return <Modal transparent visible={!!value} animationType="fade" onRequestClose={onClose}>
    <View style={s.confirmOverlay}>
      <View style={s.confirmCard}>
        <Text style={s.confirmTitle}>取消计划？</Text>
        <Text style={s.confirmMessage}>{value?.name}</Text>
        <View style={s.confirmActions}>
          <Pressable disabled={busy} style={[s.confirmButton, busy && s.actionDisabled]} onPress={onClose}><Text style={s.actionText}>返回</Text></Pressable>
          <Pressable disabled={busy} style={[s.confirmButton, s.confirmDanger, busy && s.actionDisabled]} onPress={onConfirm}><Text style={s.dangerText}>取消计划</Text></Pressable>
        </View>
      </View>
    </View>
  </Modal>;
}

function CronEditModal({ value, busy, onClose, onSubmit }: {
  value: { node: HubNodeExternalSchedules; schedule: HubExternalSchedule } | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (cron: string) => void;
}) {
  const s = useMemo(makeStyles, [value]);
  const [cron, setCron] = useState('');
  useEffect(() => { setCron(''); }, [value?.schedule.id]);
  const valid = looksLikeCron(cron);
  const safe = modalSafePadding(Platform.OS, 'pageSheet', useSafeAreaInsets(), StatusBar.currentHeight);
  return <Modal visible={!!value} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
    <View style={[s.modalRoot, safe]}>
      <MacTitleStrip />
      <WinTitleBar />
      <View style={s.modalHeader}>
        <Pressable onPress={onClose} style={s.headerSide}><Text style={s.link}>取消</Text></Pressable>
        <Text style={s.modalTitle} numberOfLines={1}>改执行时间</Text>
        <Pressable disabled={busy || !valid} onPress={() => onSubmit(cron.trim().split(/ +/).join(' '))} style={[s.headerSide, s.headerSideEnd]}><Text style={[s.link, (busy || !valid) && s.linkDisabled]}>提交</Text></Pressable>
      </View>
      <ScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled">
        <Text style={s.meta}>{value?.node.alias} · {value?.schedule.name}</Text>
        <Text style={[s.meta, { marginBottom: spacing.md }]}>当前：{value?.schedule.frequency}</Text>
        <Label text="新的五段 cron（分 时 日 月 周）">
          <TextInput style={s.input} autoCapitalize="none" autoCorrect={false} value={cron} onChangeText={setCron} placeholder="*/30 * * * *" placeholderTextColor={colors.textMuted} />
        </Label>
        {cron && !valid ? <Text style={s.error}>需要五段，只能含数字和 * / , -（不含命令）。</Text> : null}
        <Text style={s.muted}>提交后生成编辑意向，由节点自行应用；只改时间与启停，绝不下发命令。</Text>
      </ScrollView>
    </View>
  </Modal>;
}

function IntentsModal({ value, onClose }: { value: { title: string; edits: HubExternalScheduleEditIntent[] } | null; onClose: () => void }) {
  const s = useMemo(makeStyles, [value]);
  const safe = modalSafePadding(Platform.OS, 'pageSheet', useSafeAreaInsets(), StatusBar.currentHeight);
  return <Modal visible={!!value} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
    <View style={[s.modalRoot, safe]}>
      <MacTitleStrip />
      <WinTitleBar />
      <View style={s.modalHeader}><Pressable onPress={onClose} style={s.headerSide}><Text style={s.link}>关闭</Text></Pressable><Text style={s.modalTitle} numberOfLines={1}>{value?.title || '意向记录'}</Text><View style={s.headerSide} /></View>
      <ScrollView contentContainerStyle={s.form}>
        {value?.edits.length ? value.edits.map(edit => (
          <View key={edit.intent_id} style={s.run}>
            <View style={{ flex: 1 }}>
              <Text style={s.cardTitle}>{edit.schedule_id} · {INTENT_STATUS_LABEL[edit.status] || edit.status}</Text>
              <Text style={s.meta}>{describeIntentPatch(edit.patch)}</Text>
              <Text style={s.meta}>{fmt(edit.created_at)}{edit.error_code ? ` · ${edit.error_code}` : ''}</Text>
            </View>
          </View>
        )) : <Text style={s.muted}>还没有编辑意向</Text>}
      </ScrollView>
    </View>
  </Modal>;
}

function makeStyles() { return StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg }, flex: { flex: 1 },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  title: { color: colors.text, fontSize: fontSize.heading, fontWeight: weight.strong },
  tabs: { flexDirection: 'row', backgroundColor: colors.subtleFill, borderRadius: radius.md, padding: 3 },
  tabItem: { paddingHorizontal: spacing.md, paddingVertical: 5, borderRadius: 7 },
  tabActive: { backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  tabText: { color: colors.textMuted, fontSize: fontSize.small },
  tabTextActive: { color: colors.text, fontSize: fontSize.small, fontWeight: weight.strong },
  primarySmall: { backgroundColor: colors.accent, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 8, alignItems: 'center' }, primaryText: { color: colors.onAccent, fontWeight: weight.strong, fontSize: fontSize.body },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl }, list: { padding: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xl },
  hubBody: { flex: 1 },
  chipsScroll: { flexGrow: 0 },
  chips: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, gap: spacing.sm, flexDirection: 'row' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 6, minHeight: 32 },
  chipActive: { backgroundColor: colors.text, borderColor: colors.text },
  chipText: { color: colors.textSecondary, fontSize: fontSize.small },
  chipTextActive: { color: colors.bg, fontSize: fontSize.small, fontWeight: weight.strong },
  chipCount: { color: colors.textMuted, fontSize: fontSize.small },
  chipCountActive: { color: colors.bg, fontSize: fontSize.small, opacity: 0.75 },
  masterDetail: { flex: 1, flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.border },
  masterList: { flexShrink: 0, borderRightWidth: 1, borderRightColor: colors.border },
  listContent: { paddingVertical: spacing.xs, paddingBottom: spacing.xl },
  detailPane: { flex: 1, backgroundColor: colors.bg },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 64, paddingRight: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowSelected: { backgroundColor: colors.rowActive },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingLeft: spacing.lg, paddingRight: spacing.sm, paddingVertical: 10 },
  rowText: { flex: 1, minWidth: 0, gap: 4 },
  rowLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minWidth: 0 },
  rowName: { flexShrink: 1, color: colors.text, fontSize: fontSize.body + 1, fontWeight: weight.strong },
  rowTarget: { flexShrink: 1, color: colors.textSecondary, fontSize: fontSize.small, maxWidth: 110 },
  scheduleChip: { flexShrink: 0, color: colors.textSecondary, fontSize: fontSize.caption, backgroundColor: colors.subtleFill, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden' },
  rowWhen: { flexShrink: 1, color: colors.textMuted, fontSize: fontSize.caption },
  pill: { flexShrink: 0, fontSize: fontSize.caption, fontWeight: weight.medium, overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill },
  detailBar: { minHeight: 48, justifyContent: 'center', paddingHorizontal: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  backButton: { paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, alignSelf: 'flex-start' },
  backText: { color: colors.accent, fontSize: fontSize.title },
  detailContent: { padding: spacing.xl, paddingBottom: 60, maxWidth: 760 },
  detailTitle: { flexShrink: 1, color: colors.text, fontSize: fontSize.heading, fontWeight: weight.strong },
  detailTarget: { color: colors.textSecondary, fontSize: fontSize.body },
  metaInline: { color: colors.textMuted, fontSize: fontSize.small },
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.lg },
  sectionLabel: { color: colors.textMuted, fontSize: fontSize.small, fontWeight: weight.medium, marginTop: spacing.xl, marginBottom: spacing.sm },
  prompt: { color: colors.text, fontSize: fontSize.body, lineHeight: 21, backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  facts: { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md },
  fact: { flexDirection: 'row', gap: spacing.md, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  lastFact: { borderBottomWidth: 0 },
  factLabel: { width: 72, color: colors.textMuted, fontSize: fontSize.small, paddingTop: 1 },
  factValue: { color: colors.text, fontSize: fontSize.body },
  factHint: { color: colors.textMuted, fontSize: fontSize.small, marginTop: 2, lineHeight: 17 },
  runRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  runTime: { color: colors.text, fontSize: fontSize.body },
  runError: { color: colors.textMuted, fontSize: fontSize.small, marginTop: 2 },
  card: { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 13, padding: spacing.md, marginBottom: spacing.md }, cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, cardTitle: { color: colors.text, fontWeight: '600', fontSize: 15, flex: 1 }, badge: { fontSize: 11, overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 }, badgeActive: { color: colors.running, backgroundColor: `${colors.running}20` }, badgeIdle: { color: colors.textMuted, backgroundColor: colors.bg },
  meta: { color: colors.textMuted, fontSize: 11, marginTop: spacing.xs }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }, action: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 8, alignItems: 'center' }, actionText: { color: colors.textSecondary, fontSize: fontSize.body }, danger: { borderColor: `${colors.failed}50` }, dangerText: { color: colors.failed, fontSize: fontSize.body },
  error: { color: colors.failed, marginHorizontal: spacing.lg, marginBottom: spacing.md, fontSize: 13 }, empty: { paddingVertical: 64, paddingHorizontal: spacing.xl, alignItems: 'center' }, emptyTitle: { color: colors.text, fontSize: fontSize.title, fontWeight: weight.strong, marginBottom: spacing.sm }, emptyBody: { color: colors.textMuted, fontSize: 13, textAlign: 'center', lineHeight: 19, maxWidth: 300 }, muted: { color: colors.textMuted, fontSize: 13 },
  modalRoot: { flex: 1, backgroundColor: colors.bg }, modalHeader: { minHeight: 58, paddingHorizontal: spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.border }, modalTitle: { flex: 1, textAlign: 'center', color: colors.text, fontWeight: '600', fontSize: 16 }, link: { color: colors.accent, fontSize: 15 }, headerSide: { minWidth: 56, minHeight: 44, justifyContent: 'center' }, headerSideEnd: { alignItems: 'flex-end' }, form: { padding: spacing.lg, paddingBottom: 60 }, field: { marginBottom: spacing.lg }, label: { color: colors.textMuted, fontSize: 12, marginBottom: spacing.sm }, input: { color: colors.text, backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 9, paddingHorizontal: spacing.md, paddingVertical: 11 }, textarea: { minHeight: 100, textAlignVertical: 'top' },
  segment: { flexDirection: 'row', borderWidth: 1, borderColor: colors.border, borderRadius: 9, overflow: 'hidden' }, segmentItem: { flex: 1, alignItems: 'center', paddingVertical: 10, backgroundColor: colors.card }, segmentActive: { backgroundColor: colors.accent }, segmentText: { color: colors.textMuted, fontSize: 12 }, segmentTextActive: { color: colors.onAccent, fontSize: 12, fontWeight: '600' }, weekdays: { flexDirection: 'row', justifyContent: 'space-between' }, day: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }, dayActive: { backgroundColor: colors.accent, borderColor: colors.accent }, dayTextActive: { color: colors.onAccent, fontWeight: '600' },
  run: { paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  extRow: { borderTopWidth: 1, borderTopColor: colors.border, marginTop: spacing.md, paddingTop: spacing.md },
  extError: { color: colors.failed, fontSize: 11, marginTop: spacing.xs },
  linkDisabled: { opacity: 0.4 },
  intentBadge: { color: colors.accent, fontSize: 11, marginTop: spacing.sm },
  actionDisabled: { opacity: 0.4 },
  confirmOverlay: { flex: 1, backgroundColor: '#00000099', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  confirmCard: { width: '100%', maxWidth: 420, backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: spacing.xl },
  confirmTitle: { color: colors.text, fontSize: 18, fontWeight: '600' },
  confirmMessage: { color: colors.textSecondary, fontSize: 14, marginTop: spacing.md },
  confirmActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.xl },
  confirmButton: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 9 },
  confirmDanger: { borderColor: `${colors.failed}70` },
}); }
