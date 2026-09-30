import ModalKeyboardAvoider from './ModalKeyboardAvoider';
import { t as tr } from './i18n';
import { validationText } from './i18n-task-presentation';
import { useTranslation } from './i18n-react';
import { taskText } from './i18n-tasks';
// 管理项目:新建、改名、换颜色、归档 / 恢复。桌面是居中对话框,手机是底部面板。
// 军团项目 / TMAI 由 owner 在这里建(Hub 不预置任何项目)。每个动作立即写 Hub,失败留在原处提示。
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';
import { useModalSafePadding } from './safe-area-runtime';
import { withBasePadding } from './modal-safe-area';
import { colors, radius, spacing, themeMode, type as typeScale, weight } from './theme';
import type { RequirementProject } from './requirements-model';
import { activeProjects, checkProjectName, nextProjectColor, PROJECT_COLORS } from './task-board-model';
import { liftedShadow, useTaskStyles } from './TaskBoardParts';
import { fieldStyles } from './TaskCreateDialog';

export default function TaskProjectManager({ open, sheet, projects, counts, onCreate, onUpdate, onClose }: {
  open: boolean;
  sheet: boolean;
  projects: readonly RequirementProject[];
  /** 每个项目的卡片数(归档前让人知道影响多少张卡)。 */
  counts: ReadonlyMap<string, number>;
  onCreate: (name: string, color: string) => Promise<string | null>;
  onUpdate: (id: string, patch: { name?: string; color?: string; archived?: boolean }) => Promise<string | null>;
  onClose: () => void;
}) {
  useTranslation();
  const s = useTaskStyles();
  const f = fieldStyles();
  const styles = makeStyles();
  const safe = useModalSafePadding(sheet ? 'fullScreen' : 'overlay');
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(PROJECT_COLORS[0]);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!open) return null;
  const active = activeProjects(projects);
  const archived = projects.filter(p => p.archived);
  const run = async (fn: () => Promise<string | null>) => {
    if (busy) return false;
    setBusy(true);
    setError('');
    const failed = await fn();
    setBusy(false);
    if (failed) setError(failed);
    return !failed;
  };
  const create = async () => {
    const c = checkProjectName(name, projects);
    if (!c.ok) { setError(validationText(c.message)); return; }
    if (await run(() => onCreate(c.name, color))) { setName(''); setColor(nextProjectColor(color)); }
  };
  const rename = async () => {
    if (!editing) return;
    const current = projects.find(p => p.id === editing.id);
    const c = checkProjectName(editing.name, projects, editing.id);
    if (!c.ok) { setError(validationText(c.message)); return; }
    if (current && c.name === current.name) { setEditing(null); return; }
    if (await run(() => onUpdate(editing.id, { name: c.name }))) setEditing(null);
  };
  const row = (p: RequirementProject) => (
    <View key={p.id} style={styles.row} testID={`project-row-${p.id}`}>
      <Pressable accessibilityRole="button" accessibilityLabel={tr('tasks.copy.204', { v0: p.name })} disabled={p.archived} onPress={() => { void run(() => onUpdate(p.id, { color: nextProjectColor(p.color) })); }} style={styles.swatchHit} testID={`project-color-${p.id}`}>
        <View style={[styles.swatch, { backgroundColor: p.color, opacity: p.archived ? 0.4 : 1 }]} />
      </Pressable>
      {editing?.id === p.id ? (
        <TextInput autoFocus value={editing.name} onChangeText={v => setEditing({ id: p.id, name: v })} onSubmitEditing={() => { void rename(); }} onBlur={() => { void rename(); }} maxLength={40} style={[f.input, { flex: 1, minHeight: 34, paddingVertical: 4 }]} testID={`project-name-input-${p.id}`} accessibilityLabel={tr('tasks.copy.205')} />
      ) : (
        <Pressable style={{ flex: 1 }} disabled={p.archived} onPress={() => setEditing({ id: p.id, name: p.name })} accessibilityRole="button" accessibilityLabel={tr('tasks.copy.206', { v0: p.name })} testID={`project-name-${p.id}`}>
          <Text style={{ color: p.archived ? colors.textMuted : colors.text, fontSize: typeScale.body }} numberOfLines={1}>{p.name}</Text>
        </Pressable>
      )}
      <Text style={s.muted}>{counts.get(p.id) ?? 0} {tr('tasks.copy.207')}</Text>
      <Pressable accessibilityRole="button" onPress={() => { void run(() => onUpdate(p.id, { archived: !p.archived })); }} style={styles.action} testID={`project-${p.archived ? 'restore' : 'archive'}-${p.id}`}>
        <Text style={s.link}>{p.archived ? tr('tasks.copy.208') : tr('tasks.copy.209')}</Text>
      </Pressable>
    </View>
  );
  const panel = {
    backgroundColor: colors.card, gap: spacing.lg, padding: spacing.xl,
    ...(sheet
      ? { borderTopLeftRadius: radius.surface, borderTopRightRadius: radius.surface, paddingBottom: spacing.xl + safe.paddingBottom, maxHeight: '85%' as const }
      : { width: '100%' as const, maxWidth: 520, maxHeight: '85%' as const, borderRadius: radius.surface, borderWidth: themeMode() === 'dark' ? 1 : 0, borderColor: colors.border }),
    ...liftedShadow(),
  };
  return (
    <Modal visible transparent animationType={sheet ? 'slide' : 'fade'} onRequestClose={onClose}>
      <ModalKeyboardAvoider scrim="rgba(0,0,0,0.4)">
      <View style={[{ flex: 1 }, sheet ? { justifyContent: 'flex-end' } : [{ alignItems: 'center', justifyContent: 'center' }, withBasePadding(safe, spacing.lg)]]}>
        <Pressable accessibilityLabel={tr('tasks.copy.210')} onPress={onClose} style={StyleSheet.absoluteFill} />
        <View style={panel} accessibilityViewIsModal testID="project-manager">
          <View style={[f.row, { justifyContent: 'space-between' }]}>
            <Text style={{ color: colors.text, fontSize: typeScale.title + 1, fontWeight: weight.strong }}>{tr('tasks.copy.64')}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={tr('tasks.copy.114')} onPress={onClose} style={s.iconButton} testID="project-manager-close">
              <Ionicons name="close" size={18} color={colors.textSecondary} />
            </Pressable>
          </View>
          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: spacing.xs }}>
            {active.length ? active.map(row) : <Text style={s.muted}>{tr('tasks.copy.211')}</Text>}
            {archived.length ? <Text style={[f.label, { marginTop: spacing.md }]}>{tr('tasks.copy.212')}</Text> : null}
            {archived.map(row)}
          </ScrollView>
          <View style={[f.row, { gap: spacing.sm }]}>
            <Pressable accessibilityRole="button" accessibilityLabel={tr('tasks.copy.213')} onPress={() => setColor(nextProjectColor(color))} style={styles.swatchHit} testID="project-new-color">
              <View style={[styles.swatch, { backgroundColor: color }]} />
            </Pressable>
            <TextInput value={name} onChangeText={v => { setName(v); setError(''); }} onSubmitEditing={() => { void create(); }} maxLength={40} placeholder={tr('tasks.copy.214')} placeholderTextColor={colors.textMuted} style={[f.input, { flex: 1 }]} testID="project-new-name" accessibilityLabel={tr('tasks.copy.214')} />
            <Pressable accessibilityRole="button" disabled={busy || !name.trim()} onPress={() => { void create(); }} style={[s.primary, (busy || !name.trim()) && { opacity: 0.5 }]} testID="project-new-add">
              <Ionicons name="add" size={16} color={colors.onAccent} />
              <Text style={s.primaryText}>{tr('tasks.copy.40')}</Text>
            </Pressable>
          </View>
          {error ? <Text style={s.err} accessibilityRole="alert" testID="project-error">{error}</Text> : null}
          <Text style={s.muted}>{tr('tasks.copy.215')}</Text>
        </View>
      </View>
      </ModalKeyboardAvoider>
    </Modal>
  );
}

const makeStyles = () => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 40 },
  swatchHit: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  swatch: { width: 16, height: 16, borderRadius: radius.pill },
  action: { paddingHorizontal: spacing.sm, paddingVertical: 4 },
});
