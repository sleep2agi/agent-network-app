import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import {
  PRIORITY_LABEL,
  PROJECT_PRIORITIES,
  STATUS_LABEL,
  createProject,
  cycleStatus,
  sortProjects,
  type ProjectItem,
  type ProjectPriority,
} from './projects-model';
import { projectsStorageKey, readProjects, writeProjects } from './projects-store';
import { colors, radius, spacing } from './theme';

export default function ProjectsPanel({ profileId }: { profileId: string }) {
  const key = projectsStorageKey(profileId);
  const [items, setItems] = useState<ProjectItem[]>(() => readProjects(key));
  const [name, setName] = useState('');
  const [assignee, setAssignee] = useState('');
  const [due, setDue] = useState('');
  const [priority, setPriority] = useState<ProjectPriority>('normal');
  const [error, setError] = useState('');
  const styles = useMemo(() => StyleSheet.create({
    root: { flex: 1 },
    note: { color: colors.textMuted, fontSize: 12, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
    form: { paddingHorizontal: spacing.lg, gap: spacing.sm },
    input: {
      borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
      color: colors.text, fontSize: 14,
    },
    row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
    chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2, borderRadius: radius.sm },
    chipOn: { backgroundColor: colors.rowActive },
    chipText: { color: colors.textSecondary, fontSize: 12 },
    chipTextOn: { color: colors.text, fontWeight: '600' },
    add: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
    addText: { color: colors.accent, fontSize: 14, fontWeight: '600' },
    err: { color: colors.failed, fontSize: 12, paddingHorizontal: spacing.lg },
    list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, gap: spacing.sm },
    card: { paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 4 },
    title: { color: colors.text, fontSize: 15, fontWeight: '600' },
    meta: { color: colors.textMuted, fontSize: 12 },
    empty: { color: colors.textMuted, fontSize: 13, padding: spacing.lg },
  }), []);

  const save = (next: ProjectItem[]) => {
    setItems(next);
    writeProjects(key, next);
  };

  const add = () => {
    const item = createProject({ name, priority, assignee, due });
    if (!item) {
      setError(name.trim() ? '预计完成要写成 2026-09-30，或留空' : '先写项目名字');
      return;
    }
    setError('');
    setName('');
    setDue('');
    save(sortProjects([item, ...items]));
  };

  const shown = sortProjects(items);

  return (
    <ScrollView style={styles.root} testID="projects-panel">
      <Text style={styles.note}>存在这台电脑上。不进 Hub，也不连 GitHub。</Text>
      <View style={styles.form}>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="项目名字"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          testID="projects-name"
        />
        <TextInput
          value={assignee}
          onChangeText={setAssignee}
          placeholder="负责节点，可空"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          testID="projects-assignee"
        />
        <TextInput
          value={due}
          onChangeText={setDue}
          placeholder="预计完成，如 2026-10-01，可空"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          testID="projects-due"
        />
        <View style={styles.row}>
          {PROJECT_PRIORITIES.map(p => (
            <Pressable key={p} onPress={() => setPriority(p)} style={[styles.chip, priority === p && styles.chipOn]} testID={`projects-priority-${p}`}>
              <Text style={[styles.chipText, priority === p && styles.chipTextOn]}>{PRIORITY_LABEL[p]}</Text>
            </Pressable>
          ))}
          <Pressable onPress={add} style={styles.add} testID="projects-add">
            <Text style={styles.addText}>添加</Text>
          </Pressable>
        </View>
      </View>
      {error ? <Text style={styles.err} testID="projects-error">{error}</Text> : null}
      <View style={styles.list}>
        {shown.length === 0 ? <Text style={styles.empty}>还没有项目。</Text> : null}
        {shown.map(item => (
          <View key={item.id} style={styles.card} testID={`projects-row-${item.id}`}>
            <Text style={styles.title}>{item.name}</Text>
            <Text style={styles.meta}>
              {PRIORITY_LABEL[item.priority]} · {item.assignee || '未分配'} · {item.due || '未定期限'}
            </Text>
            <View style={styles.row}>
              <Pressable
                onPress={() => save(items.map(x => x.id === item.id ? { ...x, status: cycleStatus(x.status) } : x))}
                testID={`projects-status-${item.id}`}
              >
                <Text style={styles.addText}>{STATUS_LABEL[item.status]}</Text>
              </Pressable>
              <Pressable onPress={() => save(items.filter(x => x.id !== item.id))} testID={`projects-delete-${item.id}`}>
                <Text style={styles.meta}>删除</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
