import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './ui-text';
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
import { colors, radius, spacing } from './theme';

export default function RequirementBoard({ profileId }: { profileId: string }) {
  const key = requirementsKey(profileId);
  const [items, setItems] = useState<Requirement[]>(() => readRequirements(key));
  const [name, setName] = useState('');
  const [assignee, setAssignee] = useState('');
  const [due, setDue] = useState('');
  const [priority, setPriority] = useState<ReqPriority>('normal');
  const [error, setError] = useState('');
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
  }), []);

  const save = (next: Requirement[]) => { setItems(next); writeRequirements(key, next); };
  const add = () => {
    const item = createRequirement({ name, priority, assignee, due });
    if (!item) { setError(name.trim() ? '预计完成要写成 2026-10-01，或留空' : '先写需求'); return; }
    setError(''); setName(''); setDue('');
    save([item, ...items]);
  };
  const columns = columnsOf(items);

  return (
    <View style={styles.root} testID="requirement-board">
      <Text style={styles.note}>需求池存在这台电脑上，关掉还在。不进 Hub。</Text>
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
          <Pressable onPress={add} testID="req-add"><Text style={styles.addText}>添加</Text></Pressable>
        </View>
      </View>
      {error ? <Text style={styles.err} testID="req-error">{error}</Text> : null}
      <ScrollView horizontal contentContainerStyle={styles.row}>
        {columns.map(col => (
          <View key={col.column} style={styles.col} testID={`req-col-${col.column}`}>
            <View style={styles.head}>
              <Text style={styles.headText}>{REQ_COLUMN_LABEL[col.column]}</Text>
              <Text style={styles.count}>{col.items.length}</Text>
            </View>
            {col.items.length === 0 ? <Text style={styles.empty}>没有</Text> : null}
            {col.items.map(item => (
              <Pressable
                key={item.id}
                style={styles.card}
                testID={`req-card-${item.id}`}
                onPress={() => save(items.map(x => x.id === item.id ? { ...x, column: nextColumn(x.column) } : x))}
              >
                <Text style={styles.title}>{item.name}</Text>
                <Text style={styles.meta}>{REQ_PRIORITY_LABEL[item.priority]} · {item.assignee || '未分配'} · {item.due || '未定期限'}</Text>
                <Text style={styles.addText}>移到{REQ_COLUMN_LABEL[nextColumn(item.column)]}</Text>
              </Pressable>
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
