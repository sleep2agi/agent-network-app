import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
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
  createScheduledTask,
  fetchHubNodes,
  fetchScheduledRuns,
  fetchScheduledTasks,
  HubConfig,
  HubNode,
  HubScheduledRun,
  HubScheduledTask,
  HubMisfirePolicy,
  HubScheduleSpec,
  runScheduledTaskNow,
  setScheduledTaskStatus,
} from './api';
import { colors, onThemeChange, spacing } from './theme';

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
  const [showCreate, setShowCreate] = useState(false);
  const [history, setHistory] = useState<{ title: string; runs: HubScheduledRun[] } | null>(null);

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

  useEffect(() => {
    void load();
    const timer = setInterval(load, 10_000);
    return () => clearInterval(timer);
  }, [load]);

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

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View><Text style={styles.title}>定时任务</Text><Text style={styles.subtitle}>Hub 统一调度 · 节点离线自动排队</Text></View>
        <Pressable style={styles.primarySmall} onPress={() => setShowCreate(true)}><Text style={styles.primaryText}>新建</Text></Pressable>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {loading ? <View style={styles.center}><ActivityIndicator color={colors.accent} /></View> : (
        <ScrollView
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.accent} />}
        >
          {items.length === 0 ? <View style={styles.empty}><Text style={styles.emptyTitle}>还没有定时任务</Text><Text style={styles.muted}>点击右上角新建，由 Hub 统一执行。</Text></View> : items.map(row => (
            <View key={row.schedule_id} style={styles.card}>
              <View style={styles.cardTop}><Text style={styles.cardTitle}>{row.name}</Text><Text style={[styles.badge, row.status === 'active' ? styles.badgeActive : styles.badgeIdle]}>{row.status}</Text></View>
              <Text style={styles.node}>{row.target_alias}</Text>
              <Text style={styles.task} numberOfLines={3}>{row.task_content}</Text>
              <Text style={styles.meta}>{describe(row.schedule, row.timezone)}</Text>
              <Text style={styles.meta}>{describeMisfire(row.misfire_policy)}</Text>
              <Text style={styles.meta}>下次：{fmt(row.next_run_at)}　上次：{fmt(row.last_run_at)}</Text>
              <View style={styles.actions}>
                {['active', 'paused'].includes(row.status) && <Pressable disabled={busy} style={styles.action} onPress={() => act(row, 'toggle')}><Text style={styles.actionText}>{row.status === 'active' ? '暂停' : '恢复'}</Text></Pressable>}
                <Pressable disabled={busy || row.status === 'cancelled'} style={styles.action} onPress={() => act(row, 'run')}><Text style={styles.actionText}>立即执行</Text></Pressable>
                <Pressable disabled={busy} style={styles.action} onPress={() => act(row, 'history')}><Text style={styles.actionText}>记录</Text></Pressable>
                <Pressable disabled={busy || row.status === 'cancelled'} style={[styles.action, styles.danger]} onPress={() => Alert.alert('取消计划？', row.name, [{ text: '返回' }, { text: '取消计划', style: 'destructive', onPress: () => void act(row, 'cancel') }])}><Text style={styles.dangerText}>取消</Text></Pressable>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
      <CreateModal cfg={cfg} nodes={nodes} visible={showCreate} onClose={() => setShowCreate(false)} onCreated={async () => { setShowCreate(false); await load(); }} />
      <HistoryModal value={history} onClose={() => setHistory(null)} />
    </View>
  );
}

function CreateModal({ cfg, nodes, visible, onClose, onCreated }: { cfg: HubConfig; nodes: HubNode[]; visible: boolean; onClose: () => void; onCreated: () => void }) {
  const styles = useMemo(makeStyles, [visible]);
  const [name, setName] = useState(''); const [task, setTask] = useState('');
  const [target, setTarget] = useState(''); const [kind, setKind] = useState<HubScheduleSpec['type']>('once');
  const [when, setWhen] = useState(''); const [every, setEvery] = useState('60'); const [clock, setClock] = useState('09:00');
  const [weekdays, setWeekdays] = useState([1]); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [misfirePolicy, setMisfirePolicy] = useState<HubMisfirePolicy>('catch_up_once');
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const invalidSchedule = (kind === 'once' && !when) ||
    (kind === 'interval' && (!Number.isFinite(Number(every)) || Number(every) < 1)) ||
    (kind === 'weekly' && weekdays.length === 0);
  const submit = async () => {
    setBusy(true); setError('');
    try {
      let schedule: HubScheduleSpec;
      if (kind === 'once') schedule = { type: 'once', run_at: new Date(when).toISOString() };
      else if (kind === 'interval') schedule = { type: 'interval', every_seconds: Number(every) * 60 };
      else if (kind === 'daily') schedule = { type: 'daily', time: clock };
      else schedule = { type: 'weekly', time: clock, weekdays };
      await createScheduledTask(cfg, { name: name.trim(), target_node_id: target, task: task.trim(), priority: 'normal', timezone, schedule, misfire_policy: misfirePolicy });
      setName(''); setTask(''); setTarget(''); setMisfirePolicy('catch_up_once'); onCreated();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
    <View style={styles.modalRoot}><View style={styles.modalHeader}><Pressable onPress={onClose}><Text style={styles.link}>取消</Text></Pressable><Text style={styles.modalTitle}>新建定时任务</Text><Pressable disabled={busy || !name.trim() || !task.trim() || !target || invalidSchedule} onPress={submit}><Text style={styles.link}>保存</Text></Pressable></View>
      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Label text="名称"><TextInput style={styles.input} value={name} onChangeText={setName} placeholder="每日巡检" placeholderTextColor={colors.textMuted} /></Label>
        <Label text="执行节点"><View style={styles.nodePicker}>{nodes.map(n => <Pressable key={n.node_id} onPress={() => setTarget(n.node_id)} style={[styles.nodeChoice, target === n.node_id && styles.nodeChoiceActive]}><Text style={target === n.node_id ? styles.nodeChoiceTextActive : styles.actionText}>{n.alias}</Text></Pressable>)}</View></Label>
        <Label text="任务内容"><TextInput style={[styles.input, styles.textarea]} multiline value={task} onChangeText={setTask} placeholder="节点收到的任务" placeholderTextColor={colors.textMuted} /></Label>
        <Label text="类型"><View style={styles.segment}>{(['once','interval','daily','weekly'] as const).map((x, i) => <Pressable key={x} onPress={() => setKind(x)} style={[styles.segmentItem, kind === x && styles.segmentActive]}><Text style={kind === x ? styles.segmentTextActive : styles.segmentText}>{['单次','间隔','每天','每周'][i]}</Text></Pressable>)}</View></Label>
        <Label text="错过执行"><View style={styles.segment}>{(['catch_up_once','skip'] as const).map((policy) => <Pressable key={policy} onPress={() => setMisfirePolicy(policy)} style={[styles.segmentItem, misfirePolicy === policy && styles.segmentActive]}><Text style={misfirePolicy === policy ? styles.segmentTextActive : styles.segmentText}>{policy === 'catch_up_once' ? '补跑一次' : '跳过本次'}</Text></Pressable>)}</View><Text style={styles.meta}>{misfirePolicy === 'catch_up_once' ? '适合新闻抓取；恢复后最多补跑一次' : '错过后等待下一周期'}</Text></Label>
        {kind === 'once' && <Label text="执行时间（ISO 或 YYYY-MM-DDTHH:mm）"><TextInput style={styles.input} autoCapitalize="none" value={when} onChangeText={setWhen} placeholder="2026-08-10T09:00" placeholderTextColor={colors.textMuted} /></Label>}
        {kind === 'interval' && <Label text="间隔分钟（最少 1）"><TextInput style={styles.input} keyboardType="number-pad" value={every} onChangeText={setEvery} /></Label>}
        {(kind === 'daily' || kind === 'weekly') && <Label text={`时间 · ${timezone}`}><TextInput style={styles.input} value={clock} onChangeText={setClock} placeholder="09:00" placeholderTextColor={colors.textMuted} /></Label>}
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

function makeStyles() { return StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg }, header: { padding: spacing.lg, paddingBottom: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, title: { color: colors.text, fontSize: 24, fontWeight: '700' }, subtitle: { color: colors.textMuted, fontSize: 12, marginTop: 3 },
  primarySmall: { backgroundColor: colors.accent, borderRadius: 9, paddingHorizontal: 16, paddingVertical: 9 }, primaryText: { color: colors.bg, fontWeight: '700' }, center: { flex: 1, alignItems: 'center', justifyContent: 'center' }, list: { padding: spacing.lg, paddingTop: 0, paddingBottom: spacing.xl },
  card: { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 13, padding: spacing.md, marginBottom: spacing.md }, cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, cardTitle: { color: colors.text, fontWeight: '700', fontSize: 15, flex: 1 }, badge: { fontSize: 11, overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 }, badgeActive: { color: colors.running, backgroundColor: `${colors.running}20` }, badgeIdle: { color: colors.textMuted, backgroundColor: colors.bg },
  node: { color: colors.accent, fontSize: 13, marginTop: spacing.xs }, task: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: spacing.sm }, meta: { color: colors.textMuted, fontSize: 11, marginTop: spacing.xs }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }, action: { borderWidth: 1, borderColor: colors.border, borderRadius: 7, paddingHorizontal: 11, paddingVertical: 7 }, actionText: { color: colors.textSecondary, fontSize: 12 }, danger: { borderColor: `${colors.failed}50` }, dangerText: { color: colors.failed, fontSize: 12 },
  error: { color: colors.failed, marginHorizontal: spacing.lg, marginBottom: spacing.md, fontSize: 13 }, empty: { paddingVertical: 80, alignItems: 'center' }, emptyTitle: { color: colors.text, fontSize: 16, fontWeight: '600', marginBottom: spacing.sm }, muted: { color: colors.textMuted, fontSize: 13 },
  modalRoot: { flex: 1, backgroundColor: colors.bg }, modalHeader: { minHeight: 58, paddingHorizontal: spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.border }, modalTitle: { color: colors.text, fontWeight: '700', fontSize: 16 }, link: { color: colors.accent, minWidth: 40 }, form: { padding: spacing.lg, paddingBottom: 60 }, field: { marginBottom: spacing.lg }, label: { color: colors.textMuted, fontSize: 12, marginBottom: spacing.sm }, input: { color: colors.text, backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 9, paddingHorizontal: spacing.md, paddingVertical: 11 }, textarea: { minHeight: 100, textAlignVertical: 'top' },
  nodePicker: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, nodeChoice: { borderRadius: 18, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 8 }, nodeChoiceActive: { backgroundColor: colors.accent, borderColor: colors.accent }, nodeChoiceTextActive: { color: colors.bg, fontSize: 12, fontWeight: '600' }, segment: { flexDirection: 'row', borderWidth: 1, borderColor: colors.border, borderRadius: 9, overflow: 'hidden' }, segmentItem: { flex: 1, alignItems: 'center', paddingVertical: 10, backgroundColor: colors.card }, segmentActive: { backgroundColor: colors.accent }, segmentText: { color: colors.textMuted, fontSize: 12 }, segmentTextActive: { color: colors.bg, fontSize: 12, fontWeight: '700' }, weekdays: { flexDirection: 'row', justifyContent: 'space-between' }, day: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }, dayActive: { backgroundColor: colors.accent, borderColor: colors.accent }, dayTextActive: { color: colors.bg, fontWeight: '700' },
  run: { paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, runTask: { color: colors.textMuted, fontFamily: 'monospace', fontSize: 11 },
}); }
