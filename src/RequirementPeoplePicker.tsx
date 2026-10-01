import ModalKeyboardAvoider from './ModalKeyboardAvoider';
import { t as tr } from './i18n';
import { useTranslation } from './i18n-react';
import { taskText } from './i18n-tasks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text, TextInput } from './ui-text';
import { colors, onThemeChange, radius, spacing } from './theme';
import { useModalSafePadding } from './safe-area-runtime';
import { withBasePadding } from './modal-safe-area';
import AliasAvatar from './AliasAvatar';
import { meFirst, peopleInNetwork, personKey, personSubtitle, togglePerson, uniquePeople, type RequirementPerson, type RequirementPersonRef } from './requirement-people';
import { useTaskBoard } from './task-board-store';
import { elevated } from './elevation';
import { anchorSelectMenu, type SelectAnchor } from './task-select-model';

/** 桌面:窗口至少这么宽才把选择器锚在字段下面;更窄(手机 / 分屏)照旧居中面板。 */
export const PEOPLE_DROPDOWN_MIN_WIDTH = 600;
const DROP_ROW_H = 40;

/** 量触发字段在窗口里的位置(锚点);量不了(原生没挂上 / 测试桩)给 null = 用居中面板。 */
export function measureAnchor(el: any, done: (anchor: SelectAnchor | null) => void): void {
  if (el?.measureInWindow) el.measureInWindow((x: number, y: number, w: number, h: number) => done(w > 0 ? { x, y, w, h } : null));
  else done(null);
}

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
  /** 函数 = 跟着当前勾选数变(「已选 N 人」),不要传已保存的数。 */
  hint?: string | ((selected: number) => string);
  /** 我的 user id:排第一、标「（我）」,参与人模式给「加我」。省略 = 用任务看板读到的那个。 */
  meId?: string | null;
  /**
   * 触发字段的位置(桌面传,measureAnchor 量)。有锚点且窗口够宽 ⇒ 锚在字段下面的下拉(不盖住详情面板):
   * 打字就筛、↑↓ 走、回车选(负责人选完即生效;参与人回车勾 / 取消,⌘/Ctrl+回车确定)、Esc 取消。
   * 没有 ⇒ 居中面板(手机)。
   */
  anchor?: SelectAnchor | null;
};

/** Mount when opened. Cancel discards the draft; only Confirm invokes the caller. */
export default function RequirementPeoplePicker(props: Props) {
  useTranslation();
  return <Picker key={`${props.networkId}:${props.mode}`} {...props} />;
}

function Picker({ networkId, mode, people: allPeople, selected, onConfirm, onClose, kinds, title, hint, meId: meIdProp, anchor }: Props) {
  useTranslation();
  const win = useWindowDimensions();
  const boardMe = useTaskBoard(s => s.meId);
  const meId = meIdProp === undefined ? boardMe : meIdProp;
  const people = kinds ? allPeople.filter(person => kinds.includes(person.kind)) : allPeople;
  const safe = useModalSafePadding('overlay');
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<RequirementPersonRef[]>(() => uniquePeople(selected));
  const [themeVersion, setThemeVersion] = useState(0);
  useEffect(() => onThemeChange(() => setThemeVersion(n => n + 1)), []);
  const candidates = peopleInNetwork(people, networkId);
  const rows = meFirst(peopleInNetwork(people, networkId, query), meId);
  const isMe = (person: RequirementPersonRef) => !!meId && person.kind === 'user' && person.id === meId;
  // 「加我」:参与人模式、我在可选名单里、还没选上、不是已停用。
  const me = mode === 'participants' ? candidates.find(person => isMe(person) && !person.unavailable) : undefined;
  const canAddMe = !!me && !draft.some(isMe);
  const subtitle = (person: RequirementPerson) => {
    const sub = personSubtitle(person, query);
    return [
      sub.role === 'agent' ? 'Agent' : sub.role === 'admin' ? tr('tasks.peopleRoleAdmin') : tr('tasks.peopleRoleMember'),
      ...(sub.online === undefined ? [] : [sub.online ? tr('tasks.peopleOnline') : tr('tasks.peopleOffline')]),
      ...(sub.id ? [sub.id] : []),
    ].join(' · ') + (person.unavailable ? tr('tasks.copy.73') : '');
  };
  const chosen = new Set(draft.map(personKey));
  const missing = draft.filter(person => !candidates.some(candidate => personKey(candidate) === personKey(person)));
  const invalid = !networkId || missing.length > 0 || (mode === 'owner' && draft.length > 1) || draft.some(person => candidates.some(candidate => personKey(candidate) === personKey(person) && candidate.unavailable));
  const styles = useMemo(() => StyleSheet.create({
    backdrop: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    panel: { width: '100%', maxWidth: 520, maxHeight: '85%', borderRadius: radius.surface, padding: spacing.lg, backgroundColor: colors.card, gap: spacing.md, ...elevated('floating') },
    title: { fontSize: 20, fontWeight: '600', color: colors.text },
    muted: { color: colors.textMuted, fontSize: 13 },
    input: { padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, color: colors.text, fontSize: 14 },
    row: { minHeight: 52, padding: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.item },
    selected: { backgroundColor: colors.rowActive },
    name: { color: colors.text, fontSize: 14 },
    flex: { flex: 1 },
    actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.md },
    headRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    addMe: { minHeight: 32, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.accent },
    button: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.md },
    action: { color: colors.accent, fontSize: 14 },
    checkOff: { opacity: 0 },
    disabled: { opacity: 0.5 },
  }), [themeVersion]);

  const anchored = !!anchor && win.width >= PEOPLE_DROPDOWN_MIN_WIDTH;
  const pickRow = (person: RequirementPerson) => {
    if (person.unavailable && !chosen.has(personKey(person))) return;
    const next = togglePerson(draft, person, mode);
    // 下拉里选负责人 = 单选菜单:点了就生效,不再多一步「确定」。
    if (anchored && mode === 'owner') { onConfirm(next); return; }
    setDraft(next);
  };
  if (anchored) return <PeopleDropdown anchor={anchor!} viewport={win} mode={mode} rows={rows} missing={missing} chosen={chosen} invalid={invalid}
    query={query} setQuery={setQuery} title={title || (mode === 'owner' ? tr('tasks.copy.65') : tr('tasks.copy.66'))}
    hint={(typeof hint === 'function' ? hint(draft.length) : hint) || (mode === 'owner' ? tr('tasks.copy.67') : tr('tasks.copy.68', { v0: draft.length }))}
    nameOf={person => isMe(person) ? tr('tasks.copy.62', { v0: person.name || person.id }) : person.name || person.id} subtitle={subtitle}
    onAddMe={canAddMe && me ? () => setDraft(prev => togglePerson(prev, me, mode)) : undefined}
    empty={query ? tr('tasks.copy.74') : kinds?.length === 1 ? (kinds[0] === 'node' ? tr('tasks.copy.75') : tr('tasks.copy.76')) : tr('tasks.copy.77')}
    onPick={pickRow} onDropMissing={person => setDraft(prev => prev.filter(row => personKey(row) !== personKey(person)))}
    onConfirm={() => { if (!invalid) onConfirm(draft); }} onClose={onClose} />;

  return <Modal visible transparent animationType="fade" onRequestClose={onClose}>
    <ModalKeyboardAvoider scrim="rgba(0,0,0,0.45)">
    <View style={[styles.backdrop, withBasePadding(safe, spacing.lg)]}>
      <View style={styles.panel} accessibilityViewIsModal testID="people-panel">
        <View style={styles.headRow}>
          <Text style={[styles.title, styles.flex]}>{title || (mode === 'owner' ? tr('tasks.copy.65') : tr('tasks.copy.66'))}</Text>
          {canAddMe && me ? <Pressable accessibilityRole="button" accessibilityLabel={tr('tasks.peopleAddMeA11y')} testID="people-add-me" onPress={() => setDraft(prev => togglePerson(prev, me, mode))} style={styles.addMe}><Text style={styles.action}>{tr('tasks.peopleAddMe')}</Text></Pressable> : null}
        </View>
        <Text style={styles.muted} testID="people-hint">{(typeof hint === 'function' ? hint(draft.length) : hint) || (mode === 'owner' ? tr('tasks.copy.67') : tr('tasks.copy.68', { v0: draft.length }))}</Text>
        <TextInput accessibilityLabel={tr('tasks.copy.69')} placeholder={tr('tasks.copy.70')} placeholderTextColor={colors.textMuted} value={query} onChangeText={setQuery} style={styles.input} testID="people-search" />
        <ScrollView keyboardShouldPersistTaps="handled">
          {missing.map(person => <Pressable key={personKey(person)} accessibilityRole="button" onPress={() => setDraft(prev => prev.filter(row => personKey(row) !== personKey(person)))} style={styles.row}>
            <Text style={styles.muted}>{tr('tasks.copy.71')}{personKey(person)} {tr('tasks.copy.72')}</Text>
          </Pressable>)}
          {rows.map(person => <Pressable key={personKey(person)} testID={`person-${personKey(person)}`} accessibilityRole="checkbox" accessibilityState={{ checked: chosen.has(personKey(person)), disabled: !!person.unavailable && !chosen.has(personKey(person)) }} disabled={!!person.unavailable && !chosen.has(personKey(person))} onPress={() => setDraft(prev => togglePerson(prev, person, mode))} style={[styles.row, chosen.has(personKey(person)) && styles.selected]}>
            <AliasAvatar alias={person.name || person.id} size={36} />
            <View style={styles.flex}><Text style={styles.name} testID={`person-name-${personKey(person)}`}>{isMe(person) ? tr('tasks.copy.62', { v0: person.name || person.id }) : person.name || person.id}</Text><Text style={styles.muted} testID={`person-sub-${personKey(person)}`}>{subtitle(person)}</Text></View>
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
    </ModalKeyboardAvoider>
  </Modal>;
}

/** 桌面锚定下拉:位置用 TaskSelectMenu 同一个 anchorSelectMenu(下面放不下翻上去、夹进窗口)。没有遮罩变暗,点外面 = 取消。 */
function PeopleDropdown({ anchor, viewport, mode, rows, missing, chosen, invalid, query, setQuery, title, hint, empty, nameOf, subtitle, onAddMe, onPick, onDropMissing, onConfirm, onClose }: {
  anchor: SelectAnchor; viewport: { width: number; height: number }; mode: 'owner' | 'participants';
  rows: RequirementPerson[]; missing: RequirementPersonRef[]; chosen: ReadonlySet<string>; invalid: boolean;
  query: string; setQuery: (q: string) => void; title: string; hint: string; empty: string;
  nameOf: (person: RequirementPerson) => string; subtitle: (person: RequirementPerson) => string; onAddMe?: () => void;
  onPick: (person: RequirementPerson) => void; onDropMissing: (person: RequirementPersonRef) => void; onConfirm: () => void; onClose: () => void;
}) {
  useTranslation();
  const safe = useModalSafePadding('fullScreen');
  const [active, setActive] = useState(0);
  const rowEls = useRef(new Map<number, any>());
  // Esc 不在这里接:Modal 自己在 keyup 上 onRequestClose(= 取消)。在 keydown 上关掉的话,同一下 keyup 会落到下面那层
  // Modal(窄窗口的整页详情)上,把详情也关了。
  const search = useRef<any>(null);
  useEffect(() => { const t = setTimeout(() => search.current?.focus?.(), 0); return () => clearTimeout(t); }, []);
  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => { rowEls.current.get(active)?.scrollIntoView?.({ block: 'nearest' }); }, [active]);
  const keyRef = useRef({ rows, active, onPick, onConfirm, onClose });
  keyRef.current = { rows, active, onPick, onConfirm, onClose };
  useEffect(() => {
    const doc = (globalThis as any).document;
    if (!doc?.addEventListener) return;
    const onKey = (e: any) => {
      const k = keyRef.current;
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(Math.max(0, k.rows.length - 1), i + 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(0, i - 1)); }
      else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && mode === 'participants') { e.preventDefault(); k.onConfirm(); }
      else if (e.key === 'Enter') { const person = k.rows[k.active]; if (person) { e.preventDefault(); k.onPick(person); } }
    };
    doc.addEventListener('keydown', onKey, true);
    return () => doc.removeEventListener('keydown', onKey, true);
  }, [mode]);
  const footer = mode === 'participants';
  const pos = anchorSelectMenu(anchor, viewport, { rows: Math.max(1, rows.length + missing.length) + (footer ? 2 : 0), rowH: DROP_ROW_H, search: true, maxWidth: 360 });
  const up = pos.top < anchor.y;
  return <Modal visible transparent animationType="none" onRequestClose={onClose}>
    <Pressable style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} onPress={onClose} accessibilityLabel={tr('taskSel.close')} testID="people-scrim" />
    <View style={{ position: 'absolute', left: Math.max(pos.left, safe.paddingLeft + 8), width: pos.width,
      // 翻到字段上面时贴着字段的上沿往上长(内容比估的矮时不悬空)。
      ...(up ? { bottom: viewport.height - (anchor.y - 4) } : { top: Math.max(pos.top, safe.paddingTop + 8) }), maxHeight: pos.maxHeight, padding: 6, gap: 4, borderRadius: radius.control, backgroundColor: colors.card, ...elevated('floating') }}
      testID="people-dropdown" accessibilityRole="menu" accessibilityLabel={title}>
      {onAddMe ? <Pressable accessibilityRole="button" accessibilityLabel={tr('tasks.peopleAddMeA11y')} testID="people-add-me" onPress={onAddMe}
        style={state => ({ position: 'absolute', right: 10, top: 10, zIndex: 1, height: 26, justifyContent: 'center', paddingHorizontal: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.accent, backgroundColor: state.pressed ? colors.rowHover : colors.inputBg })}>
        <Text style={{ color: colors.accent, fontSize: 12 }}>{tr('tasks.peopleAddMe')}</Text>
      </Pressable> : null}
      <TextInput ref={search} autoFocus value={query} onChangeText={setQuery} placeholder={tr('tasks.copy.70')} placeholderTextColor={colors.textMuted} accessibilityLabel={tr('tasks.copy.69')} testID="people-search"
        style={{ height: 34, paddingHorizontal: spacing.md, paddingRight: onAddMe ? 64 : spacing.md, borderRadius: radius.control, borderWidth: 1, borderColor: colors.accent, color: colors.text, fontSize: 13, backgroundColor: colors.inputBg, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : null) } as object} />
      <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled">
        {missing.map(person => <Pressable key={personKey(person)} accessibilityRole="button" onPress={() => onDropMissing(person)} style={{ minHeight: DROP_ROW_H, justifyContent: 'center', paddingHorizontal: spacing.sm }}>
          <Text style={{ color: colors.textMuted, fontSize: 12 }} numberOfLines={1}>{tr('tasks.copy.71')}{personKey(person)} {tr('tasks.copy.72')}</Text>
        </Pressable>)}
        {rows.map((person, i) => {
          const on = chosen.has(personKey(person));
          const off = !!person.unavailable && !on;
          return <Pressable key={personKey(person)} ref={(el: any) => { if (el) rowEls.current.set(i, el); else rowEls.current.delete(i); }}
            testID={`person-${personKey(person)}`} accessibilityRole={mode === 'owner' ? 'menuitem' : 'checkbox'} accessibilityState={{ checked: on, selected: on, disabled: off }} disabled={off}
            onPress={() => onPick(person)} onHoverIn={() => setActive(i)}
            style={state => ({ height: DROP_ROW_H, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: spacing.sm, borderRadius: radius.item, opacity: off ? 0.45 : 1,
              backgroundColor: i === active || state.pressed ? colors.rowHover : on ? colors.rowActive : 'transparent' })}>
            <AliasAvatar alias={person.name || person.id} size={24} />
            <Text style={{ flex: 1, minWidth: 0, color: colors.text, fontSize: 13 }} numberOfLines={1} testID={`person-name-${personKey(person)}`}>{nameOf(person)}<Text style={{ color: colors.textMuted, fontSize: 12 }} testID={`person-sub-${personKey(person)}`}>{'  '}{subtitle(person)}</Text></Text>
            {on ? <Text accessible={false} style={{ color: colors.accent, fontSize: 14 }}>✓</Text> : null}
          </Pressable>;
        })}
        {!rows.length ? <Text style={{ color: colors.textMuted, fontSize: 13, padding: spacing.md }}>{empty}</Text> : null}
      </ScrollView>
      {footer ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingTop: 4, paddingLeft: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
        <Text style={{ flex: 1, color: invalid ? colors.failed : colors.textMuted, fontSize: 12 }} numberOfLines={1} accessibilityRole={invalid ? 'alert' : undefined}>{invalid ? tr('tasks.copy.78') : hint}</Text>
        <Pressable accessibilityRole="button" testID="people-cancel" onPress={onClose} style={{ height: 30, justifyContent: 'center', paddingHorizontal: spacing.sm }}><Text style={{ color: colors.textSecondary, fontSize: 13 }}>{tr('tasks.copy.79')}</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: invalid }} disabled={invalid} testID="people-confirm" onPress={onConfirm}
          style={{ height: 30, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.control, backgroundColor: colors.accent, opacity: invalid ? 0.5 : 1 }}><Text style={{ color: colors.onAccent, fontSize: 13, fontWeight: '600' }}>{tr('tasks.copy.80')}</Text></Pressable>
      </View> : null}
    </View>
  </Modal>;
}
