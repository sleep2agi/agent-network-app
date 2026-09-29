import { t as tr } from './i18n';
import { useTranslation } from './i18n-react';
import { taskText } from './i18n-tasks';
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
  /** 只列这些种类(负责人 = ['user'],负责 Agent = ['node'])。省略 = 人类和 Agent 都列。 */
  kinds?: readonly ('user' | 'node')[];
  /** 标题 / 说明覆盖(负责 Agent 用)。 */
  title?: string;
  hint?: string;
};

/** Mount when opened. Cancel discards the draft; only Confirm invokes the caller. */
export default function RequirementPeoplePicker(props: Props) {
  useTranslation();
  return <Picker key={`${props.networkId}:${props.mode}`} {...props} />;
}

function Picker({ networkId, mode, people: allPeople, selected, onConfirm, onClose, kinds, title, hint }: Props) {
  useTranslation();
  const people = kinds ? allPeople.filter(person => kinds.includes(person.kind)) : allPeople;
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
        <Text style={styles.title}>{title || (mode === 'owner' ? tr('tasks.copy.65') : tr('tasks.copy.66'))}</Text>
        <Text style={styles.muted}>{hint || (mode === 'owner' ? tr('tasks.copy.67') : tr('tasks.copy.68', { v0: draft.length }))}</Text>
        <TextInput accessibilityLabel={tr('tasks.copy.69')} placeholder={tr('tasks.copy.70')} placeholderTextColor={colors.textMuted} value={query} onChangeText={setQuery} style={styles.input} testID="people-search" />
        <ScrollView keyboardShouldPersistTaps="handled">
          {missing.map(person => <Pressable key={personKey(person)} accessibilityRole="button" onPress={() => setDraft(prev => prev.filter(row => personKey(row) !== personKey(person)))} style={styles.row}>
            <Text style={styles.muted}>{tr('tasks.copy.71')}{personKey(person)} {tr('tasks.copy.72')}</Text>
          </Pressable>)}
          {rows.map(person => <Pressable key={personKey(person)} testID={`person-${personKey(person)}`} accessibilityRole="checkbox" accessibilityState={{ checked: chosen.has(personKey(person)), disabled: !!person.unavailable && !chosen.has(personKey(person)) }} disabled={!!person.unavailable && !chosen.has(personKey(person))} onPress={() => setDraft(prev => togglePerson(prev, person, mode))} style={[styles.row, chosen.has(personKey(person)) && styles.selected]}>
            <AliasAvatar alias={person.name || person.id} size={36} />
            <View style={styles.flex}><Text style={styles.name}>{person.name || person.id}</Text><Text style={styles.muted}>{person.kind === 'user' ? tr('tasks.copy.1') : 'Agent'} · {person.id}{person.unavailable ? tr('tasks.copy.73') : ''}</Text></View>
            <Text accessible={false} importantForAccessibility="no" style={[styles.action, !chosen.has(personKey(person)) && styles.checkOff]}>✓</Text>
          </Pressable>)}
          {!rows.length ? <Text style={styles.muted}>{query ? tr('tasks.copy.74') : kinds?.length === 1 ? (kinds[0] === 'node' ? tr('tasks.copy.75') : tr('tasks.copy.76')) : tr('tasks.copy.77')}</Text> : null}
        </ScrollView>
        {invalid ? <Text style={styles.muted} accessibilityRole="alert">{tr('tasks.copy.78')}</Text> : null}
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" style={styles.button} testID="people-cancel" onPress={onClose}><Text style={styles.action}>{tr('tasks.copy.79')}</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: invalid }} disabled={invalid} style={[styles.button, invalid && styles.disabled]} testID="people-confirm" onPress={() => { if (!invalid) onConfirm(draft); }}><Text style={styles.action}>{tr('tasks.copy.80')}</Text></Pressable>
        </View>
      </View>
    </View>
  </Modal>;
}
