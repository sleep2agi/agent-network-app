import { t as tr } from './i18n';
import { useTranslation } from './i18n-react';
import { taskText } from './i18n-tasks';
// 任务详情里的「子任务」:勾选、添加、删除;桌面按住左侧把手拖动排序(或 Alt+↑/↓)。
// 勾选立即保存(Hub 的单项接口,只改那一项);增、删、排序立即保存整张清单。手机没有拖动(owner:
// 桌面和安卓不是一回事),手机上删除按钮常驻,排序留给桌面。
import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';
import { colors, radius, spacing, type as typeScale } from './theme';
import type { ChecklistItem } from './requirements-model';
import { CHECKLIST_MAX_ITEMS, CHECKLIST_TEXT_MAX, checklistDropIndex, checklistProgress } from './task-board-model';
import { fieldStyles } from './TaskCreateDialog';
import { useTaskStyles, a11yState } from './TaskBoardParts';

export default function TaskChecklist({ items, pointer, onToggle, onAdd, onDelete, onMove, error }: {
  items: readonly ChecklistItem[];
  /** 鼠标界面:显示拖动把手、悬停才显示删除。 */
  pointer: boolean;
  onToggle: (id: string, done: boolean) => void;
  onAdd: (text: string) => boolean;
  onDelete: (id: string) => void;
  onMove: (from: number, to: number) => void;
  error: string;
}) {
  useTranslation();
  const s = useTaskStyles();
  const f = fieldStyles();
  const [text, setText] = useState('');
  const [hover, setHover] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const dragRef = useRef<{ from: number; to: number } | null>(null);
  const listRef = useRef<any>(null);
  const moveRef = useRef(onMove);
  moveRef.current = onMove;
  const progress = checklistProgress(items);

  // 拖动排序(只在鼠标界面):把手上按下 → 按各行上下沿算落点 → 松手提交。挂 document 捕获阶段,同看板。
  useEffect(() => {
    const doc = (globalThis as { document?: any }).document;
    if (!pointer || !doc?.addEventListener) return;
    const rows = () => [...(listRef.current?.querySelectorAll?.('[data-checklist-row]') ?? [])].map((el: any) => el.getBoundingClientRect());
    const down = (e: any) => {
      const handle = e.target?.closest?.('[data-checklist-handle]');
      if (!handle || e.button !== 0) return;
      const from = Number(handle.getAttribute('data-checklist-handle'));
      if (!Number.isInteger(from)) return;
      e.preventDefault?.();
      dragRef.current = { from, to: from };
      setDrag(dragRef.current);
    };
    const move = (e: any) => {
      if (!dragRef.current) return;
      const to = checklistDropIndex(rows(), e.clientY, dragRef.current.from);
      if (to !== dragRef.current.to) { dragRef.current = { ...dragRef.current, to }; setDrag(dragRef.current); }
    };
    const up = () => {
      const d = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (d && d.to !== d.from) moveRef.current(d.from, d.to);
    };
    doc.addEventListener('pointerdown', down, true);
    doc.addEventListener('pointermove', move, true);
    doc.addEventListener('pointerup', up, true);
    return () => {
      doc.removeEventListener('pointerdown', down, true);
      doc.removeEventListener('pointermove', move, true);
      doc.removeEventListener('pointerup', up, true);
    };
  }, [pointer]);

  const add = () => { if (onAdd(text)) setText(''); };
  const full = items.length >= CHECKLIST_MAX_ITEMS;

  return (
    <View style={{ gap: spacing.sm }} testID="req-checklist">
      <View style={[f.row, { justifyContent: 'space-between' }]}>
        <Text style={f.label}>{tr('tasks.copy.93')}</Text>
        {progress.total ? <Text style={s.muted} testID="req-checklist-progress">{progress.done}/{progress.total}</Text> : null}
      </View>
      {progress.total ? (
        <View style={{ height: 4, borderRadius: radius.pill, backgroundColor: colors.subtleFill, overflow: 'hidden' }}>
          <View style={{ width: `${Math.round(progress.ratio * 100)}%`, height: 4, backgroundColor: colors.running }} />
        </View>
      ) : null}
      <View ref={listRef} collapsable={false}>
        {items.map((item, index) => {
          const showDelete = !pointer || hover === item.id;
          const dropHere = drag && drag.to === index && drag.from !== index;
          return (
            <View key={item.id}>
              {dropHere && drag!.to < drag!.from ? <View style={[s.dropLine, { marginVertical: 1 }]} testID="req-checklist-drop" /> : null}
              <Pressable
                onHoverIn={() => setHover(item.id)}
                onHoverOut={() => setHover(h => (h === item.id ? null : h))}
                onPress={() => onToggle(item.id, !item.done)}
                accessibilityRole="checkbox"
                {...a11yState({ checked: item.done })}
                accessibilityLabel={item.text}
                accessibilityHint={pointer ? tr('tasks.copy.94') : undefined}
                {...({ onKeyDown: (e: any) => {
                  if (!pointer || !e?.altKey) return;
                  if (e.key === 'ArrowUp' && index > 0) { e.preventDefault?.(); onMove(index, index - 1); }
                  if (e.key === 'ArrowDown' && index < items.length - 1) { e.preventDefault?.(); onMove(index, index + 1); }
                } } as object)}
                style={state => [{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: pointer ? 36 : 44, paddingHorizontal: spacing.xs, borderRadius: radius.item },
                  ((state as { hovered?: boolean }).hovered || state.pressed) && { backgroundColor: colors.rowHover },
                  drag?.from === index && { opacity: 0.4 }]}
                testID={`req-checklist-item-${item.id}`}
                {...({ dataSet: { checklistRow: String(index) } } as object)}
              >
                {pointer ? (
                  // 把手自己是个 Pressable:点它不会顺带勾选这一行。
                  <Pressable onPress={() => {}} style={{ width: 14, alignItems: 'center', opacity: hover === item.id || drag ? 1 : 0.25, cursor: 'grab' } as object} accessibilityElementsHidden importantForAccessibility="no" {...({ dataSet: { checklistHandle: String(index) } } as object)} testID={`req-checklist-handle-${item.id}`}>
                    <Ionicons name="reorder-two-outline" size={14} color={colors.textMuted} />
                  </Pressable>
                ) : null}
                <Ionicons name={item.done ? 'checkbox' : 'square-outline'} size={18} color={item.done ? colors.running : colors.textMuted} />
                <Text style={{ flex: 1, color: item.done ? colors.textMuted : colors.text, fontSize: typeScale.body, textDecorationLine: item.done ? 'line-through' : 'none' }}>{item.text}</Text>
                {/* 删除按钮一直在(键盘能 Tab 到);鼠标界面不悬停时只是透明,聚焦时显出来。 */}
                <Pressable accessibilityRole="button" accessibilityLabel={tr('tasks.copy.95', { v0: item.text })} onPress={() => onDelete(item.id)} hitSlop={8}
                  style={state => ({ padding: 4, opacity: showDelete || (state as { focused?: boolean }).focused ? 1 : 0 })} testID={`req-checklist-delete-${item.id}`}>
                  <Ionicons name="close" size={14} color={colors.textMuted} />
                </Pressable>
              </Pressable>
              {dropHere && drag!.to > drag!.from ? <View style={[s.dropLine, { marginVertical: 1 }]} testID="req-checklist-drop" /> : null}
            </View>
          );
        })}
      </View>
      <View style={[f.row, { gap: spacing.sm }]}>
        <TextInput
          value={text}
          onChangeText={setText}
          onSubmitEditing={add}
          blurOnSubmit={false}
          editable={!full}
          maxLength={CHECKLIST_TEXT_MAX}
          placeholder={full ? tr('tasks.copy.96', { v0: CHECKLIST_MAX_ITEMS }) : tr('tasks.copy.97')}
          placeholderTextColor={colors.textMuted}
          style={[f.input, { flex: 1 }]}
          testID="req-checklist-input"
          accessibilityLabel={tr('tasks.copy.98')}
        />
        <Pressable accessibilityRole="button" accessibilityLabel={tr('tasks.copy.98')} disabled={!text.trim() || full} onPress={add} style={[s.primary, { backgroundColor: colors.subtleFill }, (!text.trim() || full) && { opacity: 0.5 }]} testID="req-checklist-add">
          <Ionicons name="add" size={16} color={colors.text} />
        </Pressable>
      </View>
      {error ? <Text style={s.err} accessibilityRole="alert" testID="req-checklist-error">{error}</Text> : null}
    </View>
  );
}
