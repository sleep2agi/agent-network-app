import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import type { HubConfig } from './api';
import {
  REQ_COLUMN_LABEL,
  REQ_COLUMNS,
  REQ_PRIORITIES,
  REQ_PRIORITY_LABEL,
  columnsOf,
  createRequirement,
  type ReqColumn,
  type ReqPriority,
  type Requirement,
} from './requirements-model';
import { readRequirements, requirementsKey, writeRequirements } from './requirements-store';
import { createRequirementOnHub, listRequirements, migrateLocalRequirements, moveRequirementOnHub, RequirementsHubError } from './requirements-hub';
import { colors, radius, spacing } from './theme';

const NOTE = '存在 Hub 上，手机和电脑是同一份。';
const UNSUPPORTED = '这个 Hub 还没有需求池。升级 Hub 之后，手机和电脑才能看到同一份。';

export default function RequirementBoard({ cfg }: { cfg: HubConfig }) {
  return <ScopedRequirementBoard key={JSON.stringify([cfg.serverUrl, cfg.token, cfg.networkId, cfg.profileId, cfg.username])} cfg={cfg} />;
}

function ScopedRequirementBoard({ cfg }: { cfg: HubConfig }) {
  const localKey = requirementsKey(cfg.profileId || cfg.username || 'local');
  const [items, setItems] = useState<Requirement[]>([]);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'unsupported' | 'error'>('loading');
  const [hubError, setHubError] = useState('');
  const [name, setName] = useState('');
  const [assignee, setAssignee] = useState('');
  const [due, setDue] = useState('');
  const [priority, setPriority] = useState<ReqPriority>('normal');
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const movePending = useRef(false);
  const [moveError, setMoveError] = useState('');
  const selected = items.find(item => item.id === selectedId);
  const styles = useMemo(() => StyleSheet.create({
    root: { flex: 1 },
    note: { color: colors.textMuted, fontSize: 12, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
    form: { paddingHorizontal: spacing.lg, gap: spacing.sm },
    input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.text, fontSize: 14 },
    chips: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
    chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2, borderRadius: radius.sm },
    chipOn: { backgroundColor: colors.rowActive },
    chipText: { color: colors.textSecondary, fontSize: 12 },
    chipTextOn: { color: colors.text, fontWeight: '600' },
    addText: { color: colors.accent, fontSize: 14, fontWeight: '600' },
    err: { color: colors.failed, fontSize: 12, paddingHorizontal: spacing.lg, paddingTop: spacing.xs },
    row: { flexDirection: 'row', alignItems: 'flex-start', padding: spacing.md, gap: spacing.md },
    col: { width: 260, backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.sm },
    head: { flexDirection: 'row', justifyContent: 'space-between', padding: spacing.sm },
    headText: { color: colors.text, fontSize: 13, fontWeight: '600' },
    count: { color: colors.textMuted, fontSize: 12 },
    card: { padding: spacing.sm, borderRadius: radius.sm, marginBottom: spacing.sm, backgroundColor: colors.bg, gap: 4 },
    title: { color: colors.text, fontSize: 14, fontWeight: '600' },
    meta: { color: colors.textMuted, fontSize: 12 },
    empty: { color: colors.textMuted, fontSize: 12, padding: spacing.sm },
    overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.lg, backgroundColor: 'rgba(0,0,0,0.45)' },
    detail: { width: '100%', maxWidth: 560, maxHeight: '90%', backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.lg, gap: spacing.md },
    detailTitle: { color: colors.text, fontSize: 22, fontWeight: '600' },
    detailBody: { gap: spacing.md, paddingVertical: spacing.sm },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    action: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
    disabled: { opacity: 0.5 },
  }), []);

  useEffect(() => {
    let dead = false;
    setPhase('loading');
    (async () => {
      try {
        await migrateLocalRequirements(
          cfg,
          () => readRequirements(localKey),
          (items) => writeRequirements(localKey, items),
        );
        const list = await listRequirements(cfg);
        if (!dead) { setItems(list); setPhase('ready'); setHubError(''); }
      } catch (e) {
        if (dead) return;
        if (e instanceof RequirementsHubError && e.status === 404) {
          setPhase('unsupported');
          return;
        }
        setPhase('error');
        setHubError(e instanceof Error ? e.message : '需求池打不开');
      }
    })();
    return () => { dead = true; };
  }, [cfg.serverUrl, cfg.token, cfg.networkId, localKey, reloadKey]);

  const add = async () => {
    const item = createRequirement({ name, priority, assignee, due });
    if (!item) { setError(name.trim() ? '预计完成要写成 2026-10-01，或留空' : '先写需求'); return; }
    setError('');
    try {
      const created = await createRequirementOnHub(cfg, { name: item.name, priority: item.priority, assignee: item.assignee, due: item.due });
      setName(''); setDue('');
      setItems(prev => [created, ...prev.filter(row => row.id !== created.id)]);
    } catch (e) {
      setError(e instanceof Error ? e.message : '没有存到 Hub');
    }
  };
  const move = async (item: Requirement, column: ReqColumn) => {
    if (movePending.current || item.column === column) return;
    movePending.current = true;
    setMoving(true);
    setMoveError('');
    try {
      const updated = await moveRequirementOnHub(cfg, item.id, column);
      setItems(prev => prev.map(row => row.id === item.id ? updated : row));
    } catch (e) {
      setMoveError(e instanceof RequirementsHubError && e.status === 403 ? '你没有修改这条需求的权限' : '状态未保存，请重试');
    } finally {
      movePending.current = false;
      setMoving(false);
    }
  };
  const columns = columnsOf(items);

  return (
    <View style={styles.root} testID="requirement-board">
      <Text style={styles.note}>{phase === 'unsupported' ? UNSUPPORTED : NOTE}</Text>
      {phase === 'loading' ? <ActivityIndicator color={colors.accent} /> : null}
      {phase === 'error' ? (
        <Pressable onPress={() => setReloadKey(n => n + 1)} testID="req-retry">
          <Text style={styles.err}>{hubError}，点此重试</Text>
        </Pressable>
      ) : null}
      {phase === 'ready' ? (
        <View style={styles.form}>
          <TextInput value={name} onChangeText={setName} placeholder="新建一条需求" placeholderTextColor={colors.textMuted} style={styles.input} testID="req-name" />
          <TextInput value={assignee} onChangeText={setAssignee} placeholder="负责节点，可空" placeholderTextColor={colors.textMuted} style={styles.input} testID="req-assignee" />
          <TextInput value={due} onChangeText={setDue} placeholder="预计完成，如 2026-10-01，可空" placeholderTextColor={colors.textMuted} style={styles.input} testID="req-due" />
          <View style={styles.chips}>
            {REQ_PRIORITIES.map(p => (
              <Pressable key={p} onPress={() => setPriority(p)} style={[styles.chip, priority === p && styles.chipOn]} testID={`req-priority-${p}`}>
                <Text style={[styles.chipText, priority === p && styles.chipTextOn]}>{REQ_PRIORITY_LABEL[p]}</Text>
              </Pressable>
            ))}
            <Pressable onPress={() => { void add(); }} testID="req-add"><Text style={styles.addText}>添加</Text></Pressable>
          </View>
        </View>
      ) : null}
      {error ? <Text style={styles.err} testID="req-error">{error}</Text> : null}
      {phase === 'ready' ? (
        <ScrollView horizontal contentContainerStyle={styles.row}>
          {columns.map(col => (
            <View key={col.column} style={styles.col} testID={`req-col-${col.column}`}>
              <View style={styles.head}>
                <Text style={styles.headText}>{REQ_COLUMN_LABEL[col.column]}</Text>
                <Text style={styles.count}>{col.items.length}</Text>
              </View>
              {col.items.length === 0 ? <Text style={styles.empty}>没有</Text> : null}
              {col.items.map(item => (
                <Pressable key={item.id} style={styles.card} accessibilityRole="button" accessibilityLabel={`查看需求：${item.name}`} testID={`req-card-${item.id}`} onPress={() => { setMoveError(''); setSelectedId(item.id); }}>
                  <Text style={styles.title}>{item.name}</Text>
                  <Text style={styles.meta}>{REQ_PRIORITY_LABEL[item.priority]} · {item.assignee || '未分配'} · {item.due || '未定期限'}</Text>
                  <Text style={styles.addText}>查看详情</Text>
                </Pressable>
              ))}
            </View>
          ))}
        </ScrollView>
      ) : null}
      <Modal visible={!!selected} transparent animationType="fade" onRequestClose={() => setSelectedId(null)}>
        <View style={styles.overlay}>
          {selected ? <View style={styles.detail} accessibilityViewIsModal testID="req-detail">
            <View style={styles.head}>
              <Text style={styles.headText}>需求详情</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="关闭需求详情" style={styles.action} onPress={() => setSelectedId(null)} testID="req-detail-close"><Text style={styles.addText}>关闭</Text></Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.detailBody}>
              <Text style={styles.detailTitle}>{selected.name}</Text>
              <Text style={styles.meta}>状态 · {REQ_COLUMN_LABEL[selected.column]}</Text>
              <Text style={styles.meta}>负责人 · {selected.assignee || '未分配'}</Text>
              <Text style={styles.meta}>优先级 · {REQ_PRIORITY_LABEL[selected.priority]}</Text>
              <Text style={styles.meta}>预计完成 · {selected.due || '未定期限'}</Text>
              <Text style={styles.headText}>更改状态</Text>
              <View style={styles.actions}>
                {REQ_COLUMNS.map(column => <Pressable key={column} accessibilityRole="button" accessibilityState={{ disabled: moving || column === selected.column, selected: column === selected.column }} disabled={moving || column === selected.column} style={[styles.action, column === selected.column && styles.chipOn, moving && styles.disabled]} testID={`req-move-${column}`} onPress={() => { void move(selected, column); }}>
                  <Text style={styles.addText}>{column === selected.column ? `当前：${REQ_COLUMN_LABEL[column]}` : `移到${REQ_COLUMN_LABEL[column]}`}</Text>
                </Pressable>)}
              </View>
              {moving ? <Text style={styles.meta} accessibilityLiveRegion="polite">正在保存状态…</Text> : null}
              {moveError ? <Text style={styles.err} accessibilityRole="alert">{moveError}</Text> : null}
            </ScrollView>
          </View> : null}
        </View>
      </Modal>
    </View>
  );
}
