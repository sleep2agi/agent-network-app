import ModalKeyboardAvoider from './ModalKeyboardAvoider';
import { t as tr } from './i18n';
import { validationText } from './i18n-task-presentation';
import { useTranslation } from './i18n-react';
import { taskText } from './i18n-tasks';
// 管理项目:新建、改名、换颜色、归档 / 恢复。桌面是居中对话框,手机是底部面板。
// 军团项目 / TMAI 由 owner 在这里建(Hub 不预置任何项目)。每个动作立即写 Hub,失败留在原处提示。
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';
import { useModalSafePadding } from './safe-area-runtime';
import { withBasePadding } from './modal-safe-area';
import { colors, radius, spacing, themeMode, type as typeScale, weight } from './theme';
import type { RequirementProject } from './requirements-model';
import { activeProjects, checkProjectName, nameBlurOutcome, nextProjectColor, parentPatchForPick, projectRenamePatch, PROJECT_COLORS } from './task-board-model';
import { hubExposesProjectParent, parentProjectOptions } from './task-tree';
import { liftedShadow, useTaskStyles } from './TaskBoardParts';
import { useTaskBoard } from './task-board-store';
import { fieldStyles } from './TaskCreateDialog';

export default function TaskProjectManager({ open, sheet, projects, counts, onCreate, onUpdate, onClose, focus }: {
  open: boolean;
  sheet: boolean;
  projects: readonly RequirementProject[];
  /** 每个项目的卡片数(归档前让人知道影响多少张卡)。 */
  counts: ReadonlyMap<string, number>;
  onCreate: (name: string, color: string, parentId?: string | null) => Promise<string | null>;
  onUpdate: (id: string, patch: { name?: string; color?: string; archived?: boolean; parentId?: string | null }) => Promise<string | null>;
  onClose: () => void;
  /** 从项目菜单「改名」打开(#760):直接进这个项目的改名。 */
  focus?: string | null;
}) {
  useTranslation();
  const s = useTaskStyles();
  const f = fieldStyles();
  const styles = makeStyles();
  const safe = useModalSafePadding(sheet ? 'fullScreen' : 'overlay');
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(PROJECT_COLORS[0]);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  // #2113:新建 / 编辑时选父项目。Hub 没有这个字段时整块控件不渲染。
  // #2220：从左栏项目行「新建子项目」进来时，父项目已预选。
  const creatingProject = useTaskBoard(st => st.creatingProject);
  const [parentId, setParentId] = useState<string | null>(creatingProject?.parent ?? null);
  const [editParentId, setEditParentId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // #2127(parent_forms):点父项目 chip 时 pointerdown(→onPressIn) 先于名称框 blur。先记下「正在选父项目」,
  // blur 就不提交;否则编辑行连同 chip 一起消失,父项目选择被吞掉。
  const pickingParent = useRef(false);
  useEffect(() => {
    if (open && !focus) setParentId(creatingProject?.parent ?? null);
  }, [open, focus, creatingProject?.parent]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const p = open && focus ? projects.find(x => x.id === focus) : undefined;
    if (p) { setEditing({ id: p.id, name: p.name }); setEditParentId(p.parentId ?? null); }
  }, [open, focus]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null;
  const active = activeProjects(projects);
  const archived = projects.filter(p => p.archived);
  // 只有新 Hub(payload 里出现过 parent_id)才显示父项目控件;旧 Hub 完全隐藏。
  const supportsParent = hubExposesProjectParent(projects);
  // #2127 F2:候选从**完整图**算(父项目被归档也不影响「自己+后代」的禁选),再用 available 过滤归档。
  const createParents = supportsParent ? parentProjectOptions(projects, undefined, p => !p.archived) : [];
  const editParents = supportsParent && editing ? parentProjectOptions(projects, editing.id, p => !p.archived) : [];
  const parentLabel = (id: string | null) => (id ? projects.find(p => p.id === id)?.name ?? id : tr('tasks.copy.243'));
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
    if (await run(() => onCreate(c.name, color, parentId))) { setName(''); setColor(nextProjectColor(color)); setParentId(null); }
  };
  // #2127(parent_forms):pickedParent = 刚刚点下的父项目 chip(不传 = 用当前 state)。
  const rename = async (pickedParent?: string | null) => {
    if (!editing) return;
    const current = projects.find(p => p.id === editing.id);
    const c = checkProjectName(editing.name, projects, editing.id);
    if (!c.ok) { setError(validationText(c.message)); return; }
    const patch = projectRenamePatch(current, c.name, supportsParent ? (pickedParent !== undefined ? pickedParent : editParentId) : null, supportsParent);
    if (!patch) { setEditing(null); return; }
    if (await run(() => onUpdate(editing.id, patch))) setEditing(null);
  };
  const row = (p: RequirementProject) => (
    <View key={p.id} style={styles.row} testID={`project-row-${p.id}`}>
      <Pressable accessibilityRole="button" accessibilityLabel={tr('tasks.copy.204', { v0: p.name })} disabled={p.archived} onPress={() => { void run(() => onUpdate(p.id, { color: nextProjectColor(p.color) })); }} style={styles.swatchHit} testID={`project-color-${p.id}`}>
        <View style={[styles.swatch, { backgroundColor: p.color, opacity: p.archived ? 0.4 : 1 }]} />
      </Pressable>
      {editing?.id === p.id ? (
        <TextInput autoFocus value={editing.name} onChangeText={v => setEditing({ id: p.id, name: v })} onSubmitEditing={() => { void rename(); }} onBlur={() => { const d = nameBlurOutcome(pickingParent.current); pickingParent.current = d.picking; if (!d.commit) return; void rename(); }} maxLength={40} style={[f.input, { flex: 1, minHeight: 34, paddingVertical: 4 }]} testID={`project-name-input-${p.id}`} accessibilityLabel={tr('tasks.copy.205')} />
      ) : (
        <Pressable style={{ flex: 1 }} disabled={p.archived} onPress={() => { setEditing({ id: p.id, name: p.name }); setEditParentId(p.parentId ?? null); }} accessibilityRole="button" accessibilityLabel={tr('tasks.copy.206', { v0: p.name })} testID={`project-name-${p.id}`}>
          <Text style={{ color: p.archived ? colors.textMuted : colors.text, fontSize: typeScale.body }} numberOfLines={1}>{p.name}</Text>
        </Pressable>
      )}
      {editing?.id === p.id && supportsParent ? parentChips(editParentId, editParents, id => { pickingParent.current = false; setEditParentId(id); void rename(parentPatchForPick(id).parentId); }, `project-parent-${p.id}`, () => { pickingParent.current = true; }, () => { pickingParent.current = false; }) : <Text style={s.muted}>{counts.get(p.id) ?? 0} {tr('tasks.copy.207')}</Text>}
      <Pressable accessibilityRole="button" onPress={() => { void run(() => onUpdate(p.id, { archived: !p.archived })); }} style={styles.action} testID={`project-${p.archived ? 'restore' : 'archive'}-${p.id}`}>
        <Text style={s.link}>{p.archived ? tr('tasks.copy.208') : tr('tasks.copy.209')}</Text>
      </Pressable>
    </View>
  );
  // 父项目 chips:只列未归档候选;编辑时已排除自己与后代(服务端仍拒绝环/超深)。
  const parentChips = (value: string | null, options: RequirementProject[], onPick: (id: string | null) => void, testID: string, onChipPressIn?: () => void, onChipPressOut?: () => void) => (
    <View style={{ gap: 4 }} testID={testID}>
      <Text style={[s.muted, { fontSize: typeScale.caption }]}>{tr('tasks.copy.244')}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs, alignItems: 'center' }}>
        <Pressable accessibilityRole="button" {...a11yStateLocal(value === null)} {...(onChipPressIn ? { onPressIn: onChipPressIn } : {})} {...(onChipPressOut ? { onPressOut: onChipPressOut } : {})} onPress={() => onPick(null)} testID={`${testID}-none`}
          style={[styles.chip, value === null && { borderColor: colors.accent }]}>
          <Text style={{ color: value === null ? colors.accent : colors.textSecondary, fontSize: 12 }}>{tr('tasks.copy.243')}</Text>
        </Pressable>
        {options.map(p => (
          <Pressable key={p.id} accessibilityRole="button" {...a11yStateLocal(value === p.id)} {...(onChipPressIn ? { onPressIn: onChipPressIn } : {})} {...(onChipPressOut ? { onPressOut: onChipPressOut } : {})} onPress={() => onPick(p.id)} testID={`${testID}-${p.id}`}
            style={[styles.chip, value === p.id && { borderColor: colors.accent }]}>
            <View style={[styles.chipDot, { backgroundColor: p.color }]} />
            <Text style={{ color: value === p.id ? colors.accent : colors.textSecondary, fontSize: 12 }} numberOfLines={1}>{p.name}</Text>
          </Pressable>
        ))}
      </ScrollView>
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
          {supportsParent ? parentChips(parentId, createParents, setParentId, 'project-new-parent') : null}
          {error ? <Text style={s.err} accessibilityRole="alert" testID="project-error">{error}</Text> : null}
          <Text style={s.muted}>{tr('tasks.copy.215')}</Text>
        </View>
      </View>
      </ModalKeyboardAvoider>
    </Modal>
  );
}

const a11yStateLocal = (selected: boolean) => ({ accessibilityState: { selected } as const });

const makeStyles = () => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 40 },
  swatchHit: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  swatch: { width: 16, height: 16, borderRadius: radius.pill },
  action: { paddingHorizontal: spacing.sm, paddingVertical: 4 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 28, paddingHorizontal: spacing.sm, borderRadius: radius.control, borderWidth: 1, borderColor: colors.border },
  chipDot: { width: 8, height: 8, borderRadius: radius.pill },
});
