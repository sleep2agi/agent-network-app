import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { colors, onThemeChange, radius, spacing } from './theme';
import { useModalSafePadding } from './safe-area-runtime';
import { withBasePadding } from './modal-safe-area';
import AliasAvatar from './AliasAvatar';
import { peopleInNetwork, personKey, togglePerson, uniquePeople, type RequirementPerson, type RequirementPersonRef } from './requirement-people';
import { elevated } from './elevation';

type Props = {
  networkId: string;
  mode: 'owner' | 'participants';
  people: readonly RequirementPerson[];
  selected: readonly RequirementPersonRef[];
  onConfirm: (selected: RequirementPersonRef[]) => void;
  onClose: () => void;
};

/** Mount when opened. Cancel discards the draft; only Confirm invokes the caller. */
export default function RequirementPeoplePicker(props: Props) {
  return <Picker key={`${props.networkId}:${props.mode}`} {...props} />;
}

function Picker({ networkId, mode, people, selected, onConfirm, onClose }: Props) {
  const safe = useModalSafePadding('overlay');
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<RequirementPersonRef[]>(() => uniquePeople(selected));
  const [themeVersion, setThemeVersion] = useState(0);
  useEffect(() => onThemeChange(() => setThemeVersion(n => n + 1)), []);
  const candidates = peopleInNetwork(people, networkId);
  const rows = peopleInNetwork(people, networkId, query);
  const chosen = new Set(draft.map(personKey));
  const missing = draft.filter(person => !candidates.some(candidate => personKey(candidate) === personKey(person)));
  const invalid = !networkId || missing.length > 0 || (mode === 'owner' && draft.length > 1) || draft.some(person => candidates.some(candidate => personKey(candidate) === personKey(person) && candidate.unavailable));
  const styles = useMemo(() => StyleSheet.create({
    backdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.45)' },
    panel: { width: '100%', maxWidth: 520, maxHeight: '85%', borderRadius: radius.surface, padding: spacing.lg, backgroundColor: colors.card, gap: spacing.md, ...elevated('floating') },
    title: { fontSize: 20, fontWeight: '600', color: colors.text },
    muted: { color: colors.textMuted, fontSize: 13 },
    input: { padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, color: colors.text, fontSize: 14 },
    row: { minHeight: 52, padding: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.item },
    selected: { backgroundColor: colors.rowActive },
    name: { color: colors.text, fontSize: 14 },
    flex: { flex: 1 },
    actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.md },
    button: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.md },
    action: { color: colors.accent, fontSize: 14 },
    checkOff: { opacity: 0 },
    disabled: { opacity: 0.5 },
  }), [themeVersion]);

  return <Modal visible transparent animationType="fade" onRequestClose={onClose}>
    <View style={[styles.backdrop, withBasePadding(safe, spacing.lg)]}>
      <View style={styles.panel} accessibilityViewIsModal>
        <Text style={styles.title}>{mode === 'owner' ? '选择负责人' : '选择参与人'}</Text>
        <Text style={styles.muted}>{mode === 'owner' ? '选择一名人类或 Agent，也可以暂不分配' : `已选 ${draft.length} 人，可同时选择人类和 Agent`}</Text>
        <TextInput accessibilityLabel="搜索人类或 Agent" placeholder="搜索姓名或 ID" placeholderTextColor={colors.textMuted} value={query} onChangeText={setQuery} style={styles.input} testID="people-search" />
        <ScrollView keyboardShouldPersistTaps="handled">
          {missing.map(person => <Pressable key={personKey(person)} accessibilityRole="button" onPress={() => setDraft(prev => prev.filter(row => personKey(row) !== personKey(person)))} style={styles.row}>
            <Text style={styles.muted}>已失效 · {personKey(person)} · 点击移除</Text>
          </Pressable>)}
          {rows.map(person => <Pressable key={personKey(person)} testID={`person-${personKey(person)}`} accessibilityRole="checkbox" accessibilityState={{ checked: chosen.has(personKey(person)), disabled: !!person.unavailable && !chosen.has(personKey(person)) }} disabled={!!person.unavailable && !chosen.has(personKey(person))} onPress={() => setDraft(prev => togglePerson(prev, person, mode))} style={[styles.row, chosen.has(personKey(person)) && styles.selected]}>
            <AliasAvatar alias={person.name || person.id} size={36} />
            <View style={styles.flex}><Text style={styles.name}>{person.name || person.id}</Text><Text style={styles.muted}>{person.kind === 'user' ? '人类' : 'Agent'} · {person.id}{person.unavailable ? ' · 已失效' : ''}</Text></View>
            <Text accessible={false} importantForAccessibility="no" style={[styles.action, !chosen.has(personKey(person)) && styles.checkOff]}>✓</Text>
          </Pressable>)}
          {!rows.length ? <Text style={styles.muted}>{query ? '没有匹配的人类或 Agent' : '这个网络还没有可选成员'}</Text> : null}
        </ScrollView>
        {invalid ? <Text style={styles.muted} accessibilityRole="alert">请移除已失效的选择后再保存</Text> : null}
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" style={styles.button} testID="people-cancel" onPress={onClose}><Text style={styles.action}>取消</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: invalid }} disabled={invalid} style={[styles.button, invalid && styles.disabled]} testID="people-confirm" onPress={() => { if (!invalid) onConfirm(draft); }}><Text style={styles.action}>确认选择</Text></Pressable>
        </View>
      </View>
    </View>
  </Modal>;
}
