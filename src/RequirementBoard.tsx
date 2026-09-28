import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import type { HubConfig } from './api';
import {
  REQ_COLUMN_LABEL,
  REQ_COLUMNS,
  REQ_PRIORITIES,
  REQ_PRIORITY_LABEL,
  columnsOf,
  createRequirement,
  nextColumn,
  type ReqPriority,
  type Requirement,
} from './requirements-model';
import { readRequirements, requirementsKey, writeRequirements } from './requirements-store';
import { createRequirementOnHub, filterAssigneeChoices, listRequirements, migrateLocalRequirements, moveRequirementOnHub, RequirementsHubError } from './requirements-hub';
import { fetchHubNodes } from './api';
import { colors, radius, spacing } from './theme';

const NOTE = '存在 Hub 上，手机和电脑是同一份。';
const UNSUPPORTED = '这个 Hub 还没有需求池。升级 Hub 之后，手机和电脑才能看到同一份。';

export default function RequirementBoard({ cfg }: { cfg: HubConfig }) {
  const localKey = requirementsKey(cfg.profileId || cfg.username || 'local');
  const [items, setItems] = useState<Requirement[]>([]);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'unsupported' | 'error'>('loading');
  const [hubError, setHubError] = useState('');
  const [name, setName] = useState('');
  const [assignee, setAssignee] = useState('');
  const [nodes, setNodes] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [nodeQuery, setNodeQuery] = useState('');
  const [due, setDue] = useState('');
  const [priority, setPriority] = useState<ReqPriority>('normal');
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const styles = useMemo(() => StyleSheet.create({
    root: { flex: 1 },
    note: { color: colors.textMuted, fontSize: 12, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
    form: { paddingHorizontal: spacing.lg, gap: spacing.sm },
    input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.text, fontSize: 14 },
    picker: { maxHeight: 220, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm },
    pickRow: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 4, borderBottomWidth: 1, borderBottomColor: colors.border },
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

  useEffect(() => {
    if (phase !== 'ready') return;
    let dead = false;
    void fetchHubNodes(cfg).then(res => {
      if (!dead) setNodes((res.nodes || []).map(node => node.alias || '').filter(Boolean));
    }).catch(() => { if (!dead) setNodes([]); });
    return () => { dead = true; };
  }, [phase, cfg.serverUrl, cfg.token, cfg.networkId]);

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
  const move = async (item: Requirement) => {
    const column = nextColumn(item.column);
    try {
      const updated = await moveRequirementOnHub(cfg, item.id, column);
      setItems(prev => prev.map(row => row.id === item.id ? updated : row));
    } catch (e) {
      setError(e instanceof Error ? e.message : '没有存到 Hub');
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
          <Pressable testID="req-assignee" onPress={() => setPickerOpen(open => !open)} style={styles.input}>
            <Text style={assignee ? styles.title : styles.meta}>{assignee || '选择负责节点，可空'}</Text>
          </Pressable>
          {pickerOpen ? (
            <View testID="req-assignee-list">
              <TextInput value={nodeQuery} onChangeText={setNodeQuery} placeholder="搜索节点" placeholderTextColor={colors.textMuted} style={styles.input} testID="req-assignee-search" />
              <ScrollView style={styles.picker} keyboardShouldPersistTaps="handled">
                <Pressable testID="req-node-clear" onPress={() => { setAssignee(''); setPickerOpen(false); setNodeQuery(''); }} style={styles.pickRow}>
                  <Text style={styles.meta}>不指定</Text>
                </Pressable>
                {filterAssigneeChoices(nodes, nodeQuery).map(alias => (
                  <Pressable key={alias} testID={`req-node-${alias}`} onPress={() => { setAssignee(alias); setPickerOpen(false); setNodeQuery(''); }} style={styles.pickRow}>
                    <Text style={styles.title}>{alias}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : null}
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
                <Pressable key={item.id} style={styles.card} testID={`req-card-${item.id}`} onPress={() => { void move(item); }}>
                  <Text style={styles.title}>{item.name}</Text>
                  <Text style={styles.meta}>{REQ_PRIORITY_LABEL[item.priority]} · {item.assignee || '未分配'} · {item.due || '未定期限'}</Text>
                  <Text style={styles.addText}>移到{REQ_COLUMN_LABEL[nextColumn(item.column)]}</Text>
                </Pressable>
              ))}
            </View>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}
