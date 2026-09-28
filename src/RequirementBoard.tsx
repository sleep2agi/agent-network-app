import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';
import AliasAvatar from './AliasAvatar';
import type { HubConfig } from './api';
import { fetchHubNodes } from './api';
import {
  REQ_COLUMN_LABEL,
  REQ_PRIORITIES,
  REQ_PRIORITY_LABEL,
  columnsOf,
  createRequirement,
  nextColumn,
  type ReqPriority,
  type Requirement,
  type RequirementIssue,
} from './requirements-model';
import { readRequirements, requirementsKey, writeRequirements } from './requirements-store';
import { createRequirementOnHub, filterAssigneeChoices, issueUrl, listRequirements, migrateLocalRequirements, moveRequirementOnHub, searchGithubIssues, setRequirementIssues, RequirementsHubError } from './requirements-hub';
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
  const [issues, setIssues] = useState<RequirementIssue[]>([]);
  const [issueQuery, setIssueQuery] = useState('');
  const [issueHits, setIssueHits] = useState<RequirementIssue[]>([]);
  const [issueFor, setIssueFor] = useState<string | null>(null);
  const [priority, setPriority] = useState<ReqPriority>('normal');
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const styles = useMemo(() => StyleSheet.create({
    root: { flex: 1 },
    note: { color: colors.textMuted, fontSize: 12, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
    formWrap: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
    composer: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.lg, gap: spacing.md },
    name: { color: colors.text, fontSize: 15, padding: 0 },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 36 },
    rowLabel: { color: colors.textSecondary, fontSize: 13, width: 72 },
    rowValue: { color: colors.text, fontSize: 13, flex: 1 },
    rowMuted: { color: colors.textMuted, fontSize: 13, flex: 1 },
    dueInput: { flex: 1, color: colors.text, fontSize: 13, padding: 0, textAlign: 'right' },
    chips: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2, borderRadius: radius.sm },
    chipOn: { backgroundColor: colors.rowActive },
    chipText: { color: colors.textSecondary, fontSize: 12, fontWeight: '500' },
    chipTextOn: { color: colors.text, fontWeight: '600' },
    add: { marginLeft: 'auto', backgroundColor: colors.rowActive, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2 },
    addText: { color: colors.text, fontSize: 13, fontWeight: '600' },
    search: { color: colors.text, fontSize: 13, paddingVertical: spacing.sm, paddingHorizontal: 0 },
    pickList: { maxHeight: 240 },
    pickRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
    err: { color: colors.failed, fontSize: 12, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
    board: { flexGrow: 0 },
    boardRow: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: spacing.lg, gap: spacing.md, paddingBottom: spacing.lg },
    col: { width: 280 },
    head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: spacing.sm, minHeight: 28 },
    headText: { color: colors.text, fontSize: 13, fontWeight: '600' },
    count: { color: colors.textMuted, fontSize: 12 },
    card: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.sm, gap: spacing.xs },
    cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    cardTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
    high: { color: colors.failed, fontSize: 10, fontWeight: '600' },
    due: { marginLeft: 'auto', color: colors.textMuted, fontSize: 11 },
    who: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2 },
    whoText: { color: colors.textSecondary, fontSize: 13, flexShrink: 1 },
    move: { color: colors.textMuted, fontSize: 12 },
    issueRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
    issueChip: { backgroundColor: colors.rowActive, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
    issueText: { color: colors.textSecondary, fontSize: 12 },
    empty: { color: colors.textMuted, fontSize: 12, paddingVertical: spacing.md },
  }), []);

  useEffect(() => {
    let dead = false;
    setPhase('loading');
    (async () => {
      try {
        await migrateLocalRequirements(
          cfg,
          () => readRequirements(localKey),
          (next) => writeRequirements(localKey, next),
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
      const created = await createRequirementOnHub(cfg, { name: item.name, priority: item.priority, assignee: item.assignee, due: item.due, issues });
      setName(''); setDue(''); setIssues([]); setIssueFor(null);
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
  const choose = (alias: string) => {
    setAssignee(alias);
    setPickerOpen(false);
    setNodeQuery('');
  };
  const bindIssue = async (issue: RequirementIssue) => {
    const key = `${issue.repo}#${issue.number}`;
    if (issueFor && issueFor !== 'new') {
      const card = items.find(row => row.id === issueFor);
      if (!card) return;
      const next = card.issues.some(row => `${row.repo}#${row.number}` === key) ? card.issues : [...card.issues, issue].slice(0, 8);
      try {
        const updated = await setRequirementIssues(cfg, card.id, next);
        setItems(prev => prev.map(row => row.id === card.id ? updated : row));
        setIssueFor(null); setIssueQuery(''); setIssueHits([]);
      } catch (e) {
        setError(e instanceof Error ? e.message : '没有绑上');
      }
      return;
    }
    setIssues(prev => prev.some(row => `${row.repo}#${row.number}` === key) ? prev : [...prev, issue].slice(0, 8));
    setIssueFor(null); setIssueQuery(''); setIssueHits([]);
  };
  const lookUpIssues = async (query: string) => {
    setIssueQuery(query);
    try { setIssueHits(await searchGithubIssues(query)); } catch { setIssueHits([]); }
  };
  const columns = columnsOf(items);
  const choices = filterAssigneeChoices(nodes, nodeQuery);

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
        <View style={styles.formWrap}>
          <View style={styles.composer}>
            <TextInput value={name} onChangeText={setName} placeholder="新建一条需求" placeholderTextColor={colors.textMuted} style={styles.name} testID="req-name" />
            <Pressable testID="req-assignee" onPress={() => setPickerOpen(open => !open)} style={styles.row}>
              <Text style={styles.rowLabel}>负责节点</Text>
              {assignee ? <AliasAvatar alias={assignee} size={22} /> : null}
              <Text style={assignee ? styles.rowValue : styles.rowMuted} numberOfLines={1}>{assignee || '选择负责节点，可空'}</Text>
              <Ionicons name={pickerOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
            </Pressable>
            {pickerOpen ? (
              <View testID="req-assignee-list">
                <TextInput value={nodeQuery} onChangeText={setNodeQuery} placeholder="搜索节点" placeholderTextColor={colors.textMuted} style={styles.search} testID="req-assignee-search" />
                <ScrollView style={styles.pickList} keyboardShouldPersistTaps="handled">
                  <Pressable testID="req-node-clear" onPress={() => choose('')} style={styles.pickRow}>
                    <Text style={styles.rowMuted}>不指定</Text>
                  </Pressable>
                  {choices.map(alias => (
                    <Pressable key={alias} testID={`req-node-${alias}`} onPress={() => choose(alias)} style={styles.pickRow}>
                      <AliasAvatar alias={alias} size={22} />
                      <Text style={styles.rowValue} numberOfLines={1}>{alias}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            ) : null}
            <Pressable testID="req-issues" onPress={() => setIssueFor(issueFor === 'new' ? null : 'new')} style={styles.row}>
              <Text style={styles.rowLabel}>相关 issue</Text>
              <Text style={issues.length ? styles.rowValue : styles.rowMuted}>{issues.length ? issues.map(issue => `#${issue.number}`).join(' ') : '从 GitHub 里点'}</Text>
              <Ionicons name={issueFor === 'new' ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
            </Pressable>
            {issueFor === 'new' ? (
              <View testID="req-issue-list">
                <TextInput value={issueQuery} onChangeText={text => { void lookUpIssues(text); }} placeholder="搜标题，或粘贴 issue 链接" placeholderTextColor={colors.textMuted} style={styles.search} testID="req-issue-search" />
                <ScrollView style={styles.pickList} keyboardShouldPersistTaps="handled">
                  {issueHits.map(issue => (
                    <Pressable key={`${issue.repo}#${issue.number}`} testID={`req-issue-${issue.number}`} onPress={() => { void bindIssue(issue); }} style={styles.pickRow}>
                      <Text style={styles.rowValue} numberOfLines={1}>#{issue.number} {issue.title || issue.repo}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            ) : null}
            <View style={styles.row}>
              <Text style={styles.rowLabel}>预计完成</Text>
              <TextInput value={due} onChangeText={setDue} placeholder="可空，如 2026-10-01" placeholderTextColor={colors.textMuted} style={styles.dueInput} testID="req-due" />
            </View>
            <View style={styles.chips}>
              {REQ_PRIORITIES.map(p => (
                <Pressable key={p} onPress={() => setPriority(p)} style={[styles.chip, priority === p && styles.chipOn]} testID={`req-priority-${p}`}>
                  <Text style={[styles.chipText, priority === p && styles.chipTextOn]}>{REQ_PRIORITY_LABEL[p]}</Text>
                </Pressable>
              ))}
              <Pressable onPress={() => { void add(); }} style={styles.add} testID="req-add"><Text style={styles.addText}>添加</Text></Pressable>
            </View>
          </View>
        </View>
      ) : null}
      {error ? <Text style={styles.err} testID="req-error">{error}</Text> : null}
      {phase === 'ready' ? (
        <ScrollView horizontal style={styles.board} contentContainerStyle={styles.boardRow}>
          {columns.map(col => (
            <View key={col.column} style={styles.col} testID={`req-col-${col.column}`}>
              <View style={styles.head}>
                <Text style={styles.headText}>{REQ_COLUMN_LABEL[col.column]}</Text>
                <Text style={styles.count}>{col.items.length}</Text>
              </View>
              {col.items.length === 0 ? <Text style={styles.empty}>还没有</Text> : null}
              {col.items.map(item => (
                <Pressable key={item.id} style={styles.card} testID={`req-card-${item.id}`} onPress={() => { void move(item); }}>
                  <View style={styles.cardTop}>
                    {item.priority === 'high' ? <Text style={styles.high}>高</Text> : null}
                    <Text style={styles.due}>{item.due || '未定期限'}</Text>
                  </View>
                  <Text style={styles.cardTitle}>{item.name}</Text>
                  <View style={styles.who}>
                    {item.assignee ? <AliasAvatar alias={item.assignee} size={22} /> : null}
                    <Text style={styles.whoText} numberOfLines={1}>{item.assignee || '未指定'}</Text>
                  </View>
                  {item.issues.length ? (
                    <View style={styles.issueRow}>
                      {item.issues.map(issue => (
                        <Pressable key={`${issue.repo}#${issue.number}`} style={styles.issueChip} onPress={() => { void Linking.openURL(issueUrl(issue)); }}>
                          <Text style={styles.issueText}>#{issue.number}</Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                  <Pressable onPress={() => setIssueFor(issueFor === item.id ? null : item.id)}><Text style={styles.move}>{issueFor === item.id ? '收起' : '绑定 issue'}</Text></Pressable>
                  {issueFor === item.id ? (
                    <View>
                      <TextInput value={issueQuery} onChangeText={text => { void lookUpIssues(text); }} placeholder="搜标题，或粘贴 issue 链接" placeholderTextColor={colors.textMuted} style={styles.search} />
                      {issueHits.map(issue => (
                        <Pressable key={`${issue.repo}#${issue.number}`} onPress={() => { void bindIssue(issue); }} style={styles.pickRow}>
                          <Text style={styles.rowValue} numberOfLines={1}>#{issue.number} {issue.title || issue.repo}</Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                  <Text style={styles.move}>移到{REQ_COLUMN_LABEL[nextColumn(item.column)]}</Text>
                </Pressable>
              ))}
            </View>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}
