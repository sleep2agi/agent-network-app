import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  cancelScheduledTask,
  createExternalScheduleEdit,
  createScheduledTask,
  fetchExternalScheduleEdits,
  fetchExternalSchedules,
  fetchHubNodes,
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
  ScheduledTaskError,
  runScheduledTaskNow,
  selectOpenIntents,
  setScheduledTaskStatus,
  updateScheduledTask,
} from './api';
import { colors, onThemeChange, spacing } from './theme';
import { scheduledTaskActions } from './scheduled-task-actions';

const DAYS = ['日', '一', '二', '三', '四', '五', '六'];

const fmt = (value?: string | null) => {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : value;
};

function describe(spec: HubScheduleSpec, timezone: string) {
  if (spec.type === 'once') return `单次 · ${fmt(spec.run_at)}`;
  if (spec.type === 'interval') {
    if (spec.every_seconds % 86400 === 0) return `每 ${spec.every_seconds / 86400} 天`;
    if (spec.every_seconds % 3600 === 0) return `每 ${spec.every_seconds / 3600} 小时`;
    return `每 ${spec.every_seconds / 60} 分钟`;
  }
  if (spec.type === 'daily') return `每天 ${spec.time} · ${timezone}`;
  return `每周 ${spec.weekdays.map(d => DAYS[d]).join('、')} ${spec.time} · ${timezone}`;
}

const describeMisfire = (policy?: HubMisfirePolicy) => policy === 'skip' ? '错过后跳过' : '错过后补跑一次';

const confirmScheduleCancellation = (name: string, onConfirm: () => void) => {
  if (Platform.OS === 'web' && typeof globalThis.confirm === 'function') {
    if (globalThis.confirm(`取消计划？\n\n${name}`)) onConfirm();
    return;
  }
  Alert.alert('取消计划？', name, [
    { text: '返回', style: 'cancel' },
    { text: '取消计划', style: 'destructive', onPress: onConfirm },
  ]);
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
  const [history, setHistory] = useState<{ title: string; runs: HubScheduledRun[] } | null>(null);
  const [tab, setTab] = useState<'hub' | 'node'>('hub');
  const [external, setExternal] = useState<HubNodeExternalSchedules[]>([]);
  const [externalLoaded, setExternalLoaded] = useState(false);
  const [cronEdit, setCronEdit] = useState<{ node: HubNodeExternalSchedules; schedule: HubExternalSchedule } | null>(null);
  const [intents, setIntents] = useState<{ title: string; edits: HubExternalScheduleEditIntent[] } | null>(null);
  const [openIntents, setOpenIntents] = useState<Record<string, HubExternalScheduleEditIntent>>({});

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

  const act = async (row: HubScheduledTask, action: 'toggle' | 'run' | 'cancel' | 'history') => {
    setBusy(true); setError('');
    try {
      if (action === 'toggle') await setScheduledTaskStatus(cfg, row, row.status === 'active' ? 'paused' : 'active');
      if (action === 'run') await runScheduledTaskNow(cfg, row.schedule_id);
      if (action === 'cancel') await cancelScheduledTask(cfg, row.schedule_id);
      if (action === 'history') {
        const data = await fetchScheduledRuns(cfg, row.schedule_id);
        setHistory({ title: row.name, runs: data.runs || [] });
      }
      if (action !== 'history') await load();
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

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View><Text style={styles.title}>定时任务</Text><Text style={styles.subtitle}>{tab === 'hub' ? 'Hub 统一调度 · 节点离线自动排队' : '节点上报的本机计划 · owner 可改托管 cron'}</Text></View>
        {tab === 'hub' ? <Pressable style={styles.primarySmall} onPress={() => { setEditing(null); setShowForm(true); }}><Text style={styles.primaryText}>新建</Text></Pressable> : null}
      </View>
      <View style={styles.tabs}>
        {(['hub', 'node'] as const).map(value => (
          <Pressable key={value} onPress={() => setTab(value)} style={[styles.segmentItem, tab === value && styles.segmentActive]}>
            <Text style={tab === value ? styles.segmentTextActive : styles.segmentText}>{value === 'hub' ? 'Hub 计划' : '节点计划'}</Text>
          </Pressable>
        ))}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {tab === 'node' ? (
        !externalLoaded ? <View style={styles.center}><ActivityIndicator color={colors.accent} /></View> : (
          <ScrollView
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadExternal(true)} tintColor={colors.accent} />}
          >
            {external.length === 0 ? (
              <View style={styles.empty}><Text style={styles.emptyTitle}>暂无节点计划</Text><Text style={styles.muted}>节点升级后会自动上报本机 crontab 等计划。</Text></View>
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
      ) : loading ? <View style={styles.center}><ActivityIndicator color={colors.accent} /></View> : (
        <ScrollView
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.accent} />}
        >
          {items.length === 0 ? <View style={styles.empty}><Text style={styles.emptyTitle}>还没有定时任务</Text><Text style={styles.muted}>点击右上角新建，由 Hub 统一执行。</Text></View> : items.map(row => {
            const availableActions = scheduledTaskActions(row.status);
            return (
            <View key={row.schedule_id} style={styles.card}>
              <View style={styles.cardTop}><Text style={styles.cardTitle}>{row.name}</Text><Text style={[styles.badge, row.status === 'active' ? styles.badgeActive : styles.badgeIdle]}>{row.status}</Text></View>
              <Text style={styles.node}>{row.target_alias}</Text>
              <Text style={styles.task} numberOfLines={3}>{row.task_content}</Text>
              <Text style={styles.meta}>{describe(row.schedule, row.timezone)}</Text>
              <Text style={styles.meta}>{describeMisfire(row.misfire_policy)}</Text>
              <Text style={styles.meta}>下次：{fmt(row.next_run_at)}　上次：{fmt(row.last_run_at)}</Text>
              <View style={styles.actions}>
                {availableActions.includes('edit') && <Pressable disabled={busy} style={[styles.action, busy && styles.actionDisabled]} onPress={() => { setEditing(row); setShowForm(true); }}><Text style={styles.actionText}>编辑</Text></Pressable>}
                {availableActions.includes('toggle') && <Pressable disabled={busy} style={[styles.action, busy && styles.actionDisabled]} onPress={() => act(row, 'toggle')}><Text style={styles.actionText}>{row.status === 'active' ? '暂停' : '恢复'}</Text></Pressable>}
                {availableActions.includes('run') && <Pressable disabled={busy} style={[styles.action, busy && styles.actionDisabled]} onPress={() => act(row, 'run')}><Text style={styles.actionText}>立即执行</Text></Pressable>}
                <Pressable disabled={busy} style={[styles.action, busy && styles.actionDisabled]} onPress={() => act(row, 'history')}><Text style={styles.actionText}>记录</Text></Pressable>
                {availableActions.includes('cancel') && <Pressable disabled={busy} style={[styles.action, styles.danger, busy && styles.actionDisabled]} onPress={() => confirmScheduleCancellation(row.name, () => void act(row, 'cancel'))}><Text style={styles.dangerText}>取消</Text></Pressable>}
              </View>
            </View>
            );
          })}
        </ScrollView>
      )}
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
      <HistoryModal value={history} onClose={() => setHistory(null)} />
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
  return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
    <View style={styles.modalRoot}><View style={styles.modalHeader}><Pressable onPress={onClose}><Text style={styles.link}>取消</Text></Pressable><Text style={styles.modalTitle}>{editing ? '编辑定时任务' : '新建定时任务'}</Text><Pressable disabled={busy || !name.trim() || !task.trim() || !target || !timezone.trim() || invalidSchedule} onPress={submit}><Text style={styles.link}>保存</Text></Pressable></View>
      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Label text="名称"><TextInput style={styles.input} value={name} onChangeText={setName} placeholder="每日巡检" placeholderTextColor={colors.textMuted} /></Label>
        <Label text="执行节点"><View style={styles.nodePicker}>{nodes.map(n => <Pressable key={n.node_id} onPress={() => setTarget(n.node_id)} style={[styles.nodeChoice, target === n.node_id && styles.nodeChoiceActive]}><Text style={target === n.node_id ? styles.nodeChoiceTextActive : styles.actionText}>{n.alias}</Text></Pressable>)}</View></Label>
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
    </View>
  </Modal>;
}

function Label({ text, children }: { text: string; children: ReactNode }) { const s = useMemo(makeStyles, []); return <View style={s.field}><Text style={s.label}>{text}</Text>{children}</View>; }

function HistoryModal({ value, onClose }: { value: { title: string; runs: HubScheduledRun[] } | null; onClose: () => void }) {
  const s = useMemo(makeStyles, [value]);
  return <Modal visible={!!value} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}><View style={s.modalRoot}><View style={s.modalHeader}><Pressable onPress={onClose}><Text style={s.link}>关闭</Text></Pressable><Text style={s.modalTitle}>{value?.title || '执行记录'}</Text><View style={{ width: 40 }} /></View><ScrollView contentContainerStyle={s.form}>{value?.runs.length ? value.runs.map(run => <View key={run.run_id} style={s.run}><View><Text style={s.cardTitle}>{run.status}</Text><Text style={s.meta}>{fmt(run.scheduled_for)}</Text></View><Text style={s.runTask}>{run.task_id?.slice(0, 10) || run.error_code || '—'}</Text></View>) : <Text style={s.muted}>暂无执行记录</Text>}</ScrollView></View></Modal>;
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
  return <Modal visible={!!value} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
    <View style={s.modalRoot}>
      <View style={s.modalHeader}>
        <Pressable onPress={onClose}><Text style={s.link}>取消</Text></Pressable>
        <Text style={s.modalTitle}>改执行时间</Text>
        <Pressable disabled={busy || !valid} onPress={() => onSubmit(cron.trim().split(/ +/).join(' '))}><Text style={[s.link, (busy || !valid) && s.linkDisabled]}>提交</Text></Pressable>
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
  return <Modal visible={!!value} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
    <View style={s.modalRoot}>
      <View style={s.modalHeader}><Pressable onPress={onClose}><Text style={s.link}>关闭</Text></Pressable><Text style={s.modalTitle}>{value?.title || '意向记录'}</Text><View style={{ width: 40 }} /></View>
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
  root: { flex: 1, backgroundColor: colors.bg }, header: { padding: spacing.lg, paddingBottom: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, title: { color: colors.text, fontSize: 24, fontWeight: '700' }, subtitle: { color: colors.textMuted, fontSize: 12, marginTop: 3 },
  primarySmall: { backgroundColor: colors.accent, borderRadius: 9, paddingHorizontal: 16, paddingVertical: 9 }, primaryText: { color: colors.bg, fontWeight: '700' }, center: { flex: 1, alignItems: 'center', justifyContent: 'center' }, list: { padding: spacing.lg, paddingTop: 0, paddingBottom: spacing.xl },
  card: { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 13, padding: spacing.md, marginBottom: spacing.md }, cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, cardTitle: { color: colors.text, fontWeight: '700', fontSize: 15, flex: 1 }, badge: { fontSize: 11, overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 }, badgeActive: { color: colors.running, backgroundColor: `${colors.running}20` }, badgeIdle: { color: colors.textMuted, backgroundColor: colors.bg },
  node: { color: colors.accent, fontSize: 13, marginTop: spacing.xs }, task: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: spacing.sm }, meta: { color: colors.textMuted, fontSize: 11, marginTop: spacing.xs }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }, action: { borderWidth: 1, borderColor: colors.border, borderRadius: 7, paddingHorizontal: 11, paddingVertical: 7 }, actionText: { color: colors.textSecondary, fontSize: 12 }, danger: { borderColor: `${colors.failed}50` }, dangerText: { color: colors.failed, fontSize: 12 },
  error: { color: colors.failed, marginHorizontal: spacing.lg, marginBottom: spacing.md, fontSize: 13 }, empty: { paddingVertical: 80, alignItems: 'center' }, emptyTitle: { color: colors.text, fontSize: 16, fontWeight: '600', marginBottom: spacing.sm }, muted: { color: colors.textMuted, fontSize: 13 },
  modalRoot: { flex: 1, backgroundColor: colors.bg }, modalHeader: { minHeight: 58, paddingHorizontal: spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.border }, modalTitle: { color: colors.text, fontWeight: '700', fontSize: 16 }, link: { color: colors.accent, minWidth: 40 }, form: { padding: spacing.lg, paddingBottom: 60 }, field: { marginBottom: spacing.lg }, label: { color: colors.textMuted, fontSize: 12, marginBottom: spacing.sm }, input: { color: colors.text, backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 9, paddingHorizontal: spacing.md, paddingVertical: 11 }, textarea: { minHeight: 100, textAlignVertical: 'top' },
  nodePicker: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, nodeChoice: { borderRadius: 18, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 8 }, nodeChoiceActive: { backgroundColor: colors.accent, borderColor: colors.accent }, nodeChoiceTextActive: { color: colors.bg, fontSize: 12, fontWeight: '600' }, segment: { flexDirection: 'row', borderWidth: 1, borderColor: colors.border, borderRadius: 9, overflow: 'hidden' }, segmentItem: { flex: 1, alignItems: 'center', paddingVertical: 10, backgroundColor: colors.card }, segmentActive: { backgroundColor: colors.accent }, segmentText: { color: colors.textMuted, fontSize: 12 }, segmentTextActive: { color: colors.bg, fontSize: 12, fontWeight: '700' }, weekdays: { flexDirection: 'row', justifyContent: 'space-between' }, day: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }, dayActive: { backgroundColor: colors.accent, borderColor: colors.accent }, dayTextActive: { color: colors.bg, fontWeight: '700' },
  run: { paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, runTask: { color: colors.textMuted, fontFamily: 'monospace', fontSize: 11 },
  tabs: { flexDirection: 'row', borderWidth: 1, borderColor: colors.border, borderRadius: 9, overflow: 'hidden', marginHorizontal: spacing.lg, marginBottom: spacing.md },
  extRow: { borderTopWidth: 1, borderTopColor: colors.border, marginTop: spacing.md, paddingTop: spacing.md },
  extError: { color: colors.failed, fontSize: 11, marginTop: spacing.xs },
  linkDisabled: { opacity: 0.4 },
  intentBadge: { color: colors.accent, fontSize: 11, marginTop: spacing.sm },
  actionDisabled: { opacity: 0.4 },
}); }
