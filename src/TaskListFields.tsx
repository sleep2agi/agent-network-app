import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';
import { colors, radius } from './theme';
import { useModalSafePadding } from './safe-area-runtime';
import { withBasePadding } from './modal-safe-area';
import { t } from './i18n';
import { useTranslation } from './i18n-react';
import './i18n-task-fields';
import { defaultFields, moveField, resetWidths, toggleField, type FieldId, type FieldPref } from './task-list-fields';

export default function TaskListFields({ fields, onChange, projects, needsUpdateUpgrade, touch }: { fields: FieldPref[]; onChange: (next: FieldPref[]) => void; projects: boolean; needsUpdateUpgrade: boolean; touch: boolean }) {
  useTranslation();
  const safe = useModalSafePadding('overlay');
  const anchor = useRef<View>(null);
  const panel = useRef<View>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [query, setQuery] = useState('');
  const drag = useRef<FieldId | null>(null);
  const [target, setTarget] = useState<FieldId | null>(null);
  const { width, height } = useWindowDimensions();
  const close = () => { setPosition(null); drag.current = null; setTarget(null); };
  useEffect(() => { close(); }, [width, height]);
  const available = fields.filter(f => projects || f.id !== 'project');
  const rows = available.filter(f => t(`fields.${f.id}`).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  // RN Web filters drag props on View/Pressable. Attach native listeners only to
  // this desktop popover, never to task cards or the surrounding document.
  useEffect(() => {
    const root = panel.current as unknown as HTMLElement | null;
    if (!position || !root?.querySelectorAll) return;
    const handles = root.querySelectorAll<HTMLElement>('[data-testid^="task-field-drag-"]');
    handles.forEach(el => { el.setAttribute('draggable', 'true'); el.style.cursor = 'grab'; });
    const field = (e: Event, prefix: string) => {
      const el = (e.target as HTMLElement)?.closest?.(`[data-testid^="${prefix}"]`);
      return el?.getAttribute('data-testid')?.slice(prefix.length) as FieldId | undefined;
    };
    const start = (e: DragEvent) => { const id = field(e, 'task-field-drag-'); if (!id) return; drag.current = id; e.dataTransfer?.setData('text/plain', id); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'; };
    const row = (e: Event) => (e.target as HTMLElement)?.closest?.('[data-field-row]')?.getAttribute('data-field-row') as FieldId | undefined;
    const over = (e: DragEvent) => { const id = row(e); if (drag.current && id) { e.preventDefault(); setTarget(id); } };
    const end = () => { drag.current = null; setTarget(null); };
    const drop = (e: DragEvent) => { const id = row(e); if (drag.current && id) { e.preventDefault(); onChange(moveField(fields, drag.current, id)); } end(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { close(); return; } const id = field(e, 'task-field-drag-'); if (!id || !['ArrowUp', 'ArrowDown'].includes(e.key)) return; e.preventDefault(); const index = available.findIndex(f => f.id === id), next = available[index + (e.key === 'ArrowUp' ? -1 : 1)]; if (next) onChange(moveField(fields, id, next.id)); };
    root.addEventListener('dragstart', start); root.addEventListener('dragover', over); root.addEventListener('drop', drop); root.addEventListener('dragend', end); root.addEventListener('keydown', key);
    return () => { root.removeEventListener('dragstart', start); root.removeEventListener('dragover', over); root.removeEventListener('drop', drop); root.removeEventListener('dragend', end); root.removeEventListener('keydown', key); };
  }, [position, fields, query, projects]);
  const button = { minHeight: 40, paddingHorizontal: 12, justifyContent: 'center' as const, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 };
  return <>
    <View ref={anchor} collapsable={false}>
      <Pressable testID="task-fields-button" accessibilityRole="button" accessibilityLabel={t('fields.configure')} onPress={() => {
        setQuery(''); anchor.current?.measureInWindow((x, y, w, h) => setPosition({ x: Math.max(8, Math.min(x + w - 304, width - 312)), y: y + h + 6 }));
      }} style={[button, { borderWidth: 1, borderColor: colors.border, borderRadius: radius.item }]}>
        <Ionicons name="options-outline" size={16} color={colors.text} /><Text style={{ color: colors.text }}>{t('fields.configure')}</Text>
      </Pressable>
    </View>
    <Modal visible={!!position} transparent animationType="none" onRequestClose={close}>
      <Pressable testID="task-fields-backdrop" accessibilityLabel={t('fields.close')} style={{ position: 'absolute', inset: 0 }} onPress={close} />
      <View ref={panel} testID="task-fields-popover" style={{ position: 'absolute', left: position?.x ?? 0, top: position?.y ?? 0, width: 304, maxHeight: Math.max(120, height - (position?.y ?? 0) - 12), backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, ...withBasePadding(safe, 12), gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}><Text style={{ color: colors.text, fontWeight: '600', flex: 1 }}>{t('fields.configure')}</Text><Pressable accessibilityLabel={t('fields.close')} onPress={close} style={button}><Ionicons name="close" size={18} color={colors.textMuted} /></Pressable></View>
        <TextInput autoFocus={!touch} testID="task-fields-search" value={query} onChangeText={setQuery} placeholder={t('fields.search')} accessibilityLabel={t('fields.search')} style={{ minHeight: 40, paddingHorizontal: 10, color: colors.text, borderWidth: 1, borderColor: colors.border, borderRadius: radius.item }} />
        <ScrollView style={{ flexShrink: 1 }}>
          {!rows.length ? <Text style={{ color: colors.textMuted, padding: 12 }}>{t('fields.empty')}</Text> : null}
          {rows.map(f => <View key={f.id} testID={`task-field-${f.id}`} {...({ dataSet: { fieldRow: f.id } } as object)} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', borderTopWidth: 2, borderTopColor: target === f.id ? colors.accent : 'transparent' }}>
            <Pressable testID={`task-field-drag-${f.id}`} {...({ draggable: true } as object)} accessibilityRole="button" accessibilityLabel={t('fields.reorder', { name: t(`fields.${f.id}`) })}  style={{ padding: 10 }}><Ionicons name="reorder-two" size={18} color={colors.textMuted} /></Pressable>
            <View style={{ flex: 1 }}><Text style={{ color: colors.text }}>{t(`fields.${f.id}`)}</Text>{f.id === 'updated' && needsUpdateUpgrade ? <Text testID="task-fields-upgrade" style={{ color: colors.textMuted, fontSize: 11 }}>{t('fields.upgrade')}</Text> : null}</View>
            {touch ? ([-1, 1] as const).map(delta => {
              const neighbour = available[available.findIndex(v => v.id === f.id) + delta];
              return <Pressable key={delta} testID={`task-field-${delta < 0 ? 'up' : 'down'}-${f.id}`} accessibilityRole="button" accessibilityLabel={t(delta < 0 ? 'fields.up' : 'fields.down', { name: t(`fields.${f.id}`) })} disabled={!neighbour} onPress={() => { if (neighbour) onChange(moveField(fields, f.id, neighbour.id)); }} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: neighbour ? 1 : 0.3 }}><Ionicons name={delta < 0 ? 'chevron-up' : 'chevron-down'} size={16} color={colors.text} /></Pressable>;
            }) : null}
            <Pressable testID={`task-field-toggle-${f.id}`} accessibilityRole="button" disabled={f.id === 'title'} accessibilityLabel={f.id === 'title' ? t('fields.locked') : t(f.visible ? 'fields.hide' : 'fields.show', { name: t(`fields.${f.id}`) })} onPress={() => onChange(toggleField(fields, f.id))} style={{ padding: 12 }}><Ionicons name={f.id === 'title' ? 'lock-closed-outline' : f.visible ? 'eye-outline' : 'eye-off-outline'} size={18} color={f.visible ? colors.accent : colors.textMuted} /></Pressable>
          </View>)}
        </ScrollView>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Pressable testID="task-fields-reset" onPress={() => { onChange(defaultFields()); setQuery(''); }} accessibilityRole="button" style={button}><Text style={{ color: colors.accent }}>{t('fields.reset')}</Text></Pressable>
          <Pressable testID="task-fields-reset-widths" disabled={!fields.some(f => f.width !== undefined)} onPress={() => onChange(resetWidths(fields))} accessibilityRole="button" style={[button, { opacity: fields.some(f => f.width !== undefined) ? 1 : 0.4 }]}><Text style={{ color: colors.accent }}>{t('fields.resetWidths')}</Text></Pressable>
        </View>
      </View>
    </Modal>
  </>;
}
