// 成员的「任务权限」(RFC-038 §9):全部任务 / 仅相关任务 + 授权的项目(可看 / 可编辑)。
//
// 自成一体的区块:状态由调用方持有(mode + selection + onChange),这里只画 —— 现在的成员弹窗 / 成员页,
// 和正在设计的双栏成员弹窗(另一个 agent 的稿)都能直接放进去,不用改这里。
//   desktop —— 小节标题 + 分段控件「全部任务 / 仅相关任务」+ 说明 + 项目清单(复选框 · 色点 · 名称 · 可编辑开关)。
//   phone   —— 微信式分组:两个单选行 +「授权的项目 N 个 ›」(点开就地展开 ✓ 清单)+「可编辑的项目」开关组,
//              只用 settings-kit 的积木。
// viewer:没有「可编辑」开关(hub 上 viewer 本来就不能改),只显示「只看」。
import { Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useEffect, useState } from 'react';
import { Text } from './ui-text';
import { Ionicons } from './icons';
import { colors, onThemeChange, radius, spacing } from './theme';
import { t as tr } from './i18n';
import './i18n-users';
import { SettingsChoiceRow, SettingsGroup, SettingsRow, SettingsSwitchRow } from './settings-kit';
import {
  grantableProjects, prefillProjectsOnScope, setProjectEditable, taskGrantsChanged, taskGrantsFromHub, taskGrantsPayload, toggleProject,
  type GrantableProject, type ProjectGrantSelection, type TaskAccess,
} from './task-access';
import type { MemberRole } from './user-admin';
import { fetchTaskGrants, saveTaskGrants } from './user-admin-api';
import { listProjects } from './requirements-hub';
import type { HubConfig } from './api';

/**
 * 区块的状态:读 hub 的 task-grants 与项目、编辑、判断有没有改、保存。放在这里而不是成员编辑器里,
 * 现在的成员弹窗 / 成员页和双栏重设计都只需要「useTaskAccessState + <TaskAccessSection>」两行。
 * supported=false(旧 Hub 没有 task-grants,或读失败)⇒ 调用方整块不画,保存也不发。
 */
export function useTaskAccessState(cfg: HubConfig, networkId: string, userId: string, role: MemberRole, enabled: boolean) {
  const [supported, setSupported] = useState(false);
  const [projects, setProjects] = useState<GrantableProject[] | null>(null);
  const [before, setBefore] = useState<{ mode: TaskAccess; selection: Map<string, boolean> }>({ mode: 'all', selection: new Map() });
  const [mode, setModeState] = useState<TaskAccess>('all');
  const [selection, setSelection] = useState<Map<string, boolean>>(new Map());
  useEffect(() => {
    if (!enabled) { setSupported(false); return; }
    let live = true;
    void fetchTaskGrants(cfg, networkId, userId)
      .then(async resp => {
        if (!live) return;
        if (!resp) { setSupported(false); return; }
        const b = taskGrantsFromHub(resp);
        setBefore(b); setModeState(b.mode); setSelection(new Map(b.selection)); setSupported(true);
        const ps = await listProjects({ ...cfg, networkId }).catch(() => null);
        if (live) setProjects(ps ?? []);
      })
      .catch(() => { if (live) setSupported(false); });
    return () => { live = false; };
  }, [cfg, networkId, userId, enabled]);
  const setMode = (next: TaskAccess) => {
    if (next === 'scoped' && mode === 'all') setSelection(s => prefillProjectsOnScope(s, projects ?? []));
    setModeState(next);
  };
  // 角色改成 viewer 时 hub 上的「可编辑」要清掉:按规整后的 payload 比较,才能算出「有改动」。
  const normalized = new Map(taskGrantsPayload(mode, selection, role).project_grants.map(g => [g.project_id, g.can_edit] as [string, boolean]));
  const changed = supported && taskGrantsChanged(before, { mode, selection: normalized });
  const save = () => saveTaskGrants(cfg, networkId, userId, taskGrantsPayload(mode, selection, role));
  return { supported, projects, mode, setMode, selection, setSelection, changed, save };
}

export type TaskAccessSectionProps = {
  variant: 'desktop' | 'phone';
  mode: TaskAccess;
  onModeChange: (mode: TaskAccess) => void;
  /** null = 还在读。 */
  projects: readonly GrantableProject[] | null;
  selection: ProjectGrantSelection;
  onSelectionChange: (next: Map<string, boolean>) => void;
  role: MemberRole;
};

const MODES: readonly TaskAccess[] = ['all', 'scoped'];

export default function TaskAccessSection(props: TaskAccessSectionProps) {
  return props.variant === 'desktop' ? <DesktopTaskAccess {...props} /> : <PhoneTaskAccess {...props} />;
}

function hint(mode: TaskAccess, role: MemberRole): string {
  if (mode === 'all') return tr('users.tasks.allHint');
  return role === 'viewer' ? tr('users.tasks.viewerHint') : tr('users.tasks.scopedHint');
}

function DesktopTaskAccess({ mode, onModeChange, projects, selection, onSelectionChange, role }: TaskAccessSectionProps) {
  const viewer = role === 'viewer';
  const list = grantableProjects(projects ?? [], selection);
  return (
    <View style={styles.field} testID="task-access">
      <Text style={styles.fieldLabel}>{tr('users.tasks')}</Text>
      <View style={styles.segmented} accessibilityRole="radiogroup" testID="task-access-mode">
        {MODES.map(m => (
          <Pressable key={m} accessibilityRole="radio" accessibilityState={{ selected: mode === m, checked: mode === m }} aria-checked={mode === m} onPress={() => onModeChange(m)} style={[styles.segment, mode === m && styles.segmentOn]} testID={`task-access-mode-${m}`}>
            <Text style={[styles.segmentText, mode === m && styles.segmentTextOn]} numberOfLines={1}>{m === 'all' ? tr('users.tasks.all') : tr('users.tasks.scoped')}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.hint} testID="task-access-hint">{hint(mode, role)}</Text>
      {mode === 'scoped' ? (
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent} testID="task-access-projects">
          {projects === null ? <Text style={styles.empty}>…</Text> : null}
          {projects && !list.length ? <Text style={styles.empty}>{tr('users.tasks.noProjects')}</Text> : null}
          {list.map(p => {
            const on = selection.has(p.id);
            return (
              <View key={p.id} style={[styles.row, on && styles.rowOn]} testID={`task-project-row-${p.name}`}>
                <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: on }} aria-checked={on} accessibilityLabel={p.name} onPress={() => onSelectionChange(toggleProject(selection, p.id))} style={styles.pick} testID={`task-project-${p.name}`}>
                  <Ionicons name={on ? 'checkbox' : 'square-outline'} size={20} color={on ? colors.accent : colors.textMuted} />
                  <View style={[styles.dot, { backgroundColor: p.color || colors.textMuted }]} />
                  <Text style={styles.name} numberOfLines={1}>{p.name}</Text>
                </Pressable>
                {on && !viewer ? (
                  <View style={styles.editable}>
                    <Text style={styles.editableText}>{tr('users.tasks.editable')}</Text>
                    <Switch
                      accessibilityLabel={`${tr('users.tasks.editable')} ${p.name}`}
                      value={selection.get(p.id) === true}
                      onValueChange={v => onSelectionChange(setProjectEditable(selection, p.id, v))}
                      trackColor={{ true: colors.accent, false: colors.border }}
                      thumbColor={colors.card}
                      testID={`task-project-editable-${p.name}`}
                    />
                  </View>
                ) : on ? <Text style={styles.viewOnly} testID={`task-project-view-only-${p.name}`}>{tr('users.tasks.viewOnly')}</Text> : null}
              </View>
            );
          })}
        </ScrollView>
      ) : null}
    </View>
  );
}

function PhoneTaskAccess({ mode, onModeChange, projects, selection, onSelectionChange, role }: TaskAccessSectionProps) {
  const [open, setOpen] = useState(false);
  const viewer = role === 'viewer';
  const list = grantableProjects(projects ?? [], selection);
  const picked = list.filter(p => selection.has(p.id));
  return (
    <>
      <SettingsGroup title={tr('users.tasks')} footer={hint(mode, role)} testID="task-access">
        {MODES.map(m => (
          <SettingsChoiceRow key={m} label={m === 'all' ? tr('users.tasks.all') : tr('users.tasks.scoped')} selected={mode === m} onPress={() => onModeChange(m)} testID={`task-access-mode-${m}`} />
        ))}
        {mode === 'scoped' ? (
          <SettingsRow
            label={tr('users.tasks.projects')}
            value={tr('users.tasks.projectsCount', { count: selection.size })}
            onPress={() => setOpen(o => !o)}
            accessibilityLabel={`${tr('users.tasks.projects')} ${selection.size}`}
            testID="task-access-projects-row"
          />
        ) : null}
      </SettingsGroup>
      {mode === 'scoped' && open ? (
        <SettingsGroup title={tr('users.tasks.projects')} testID="task-access-projects">
          {projects === null ? <SettingsRow label="…" busy testID="task-access-projects-loading" /> : null}
          {projects && !list.length ? <SettingsRow label={tr('users.tasks.noProjects')} tone="muted" testID="task-access-projects-empty" /> : null}
          {list.map(p => (
            <SettingsChoiceRow key={p.id} label={p.name} selected={selection.has(p.id)} onPress={() => onSelectionChange(toggleProject(selection, p.id))} testID={`task-project-${p.name}`} />
          ))}
        </SettingsGroup>
      ) : null}
      {mode === 'scoped' && !viewer && picked.length ? (
        <SettingsGroup title={tr('users.tasks.editableGroup')} footer={tr('users.tasks.editableFooter')} testID="task-access-editable">
          {picked.map(p => (
            <SettingsSwitchRow key={p.id} label={p.name} value={selection.get(p.id) === true} onValueChange={v => onSelectionChange(setProjectEditable(selection, p.id, v))} testID={`task-project-editable-${p.name}`} />
          ))}
        </SettingsGroup>
      ) : null}
    </>
  );
}

const makeStyles = () => StyleSheet.create({
  field: { gap: 6, flexShrink: 1, minHeight: 0 },
  fieldLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  hint: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  segmented: { flexDirection: 'row', borderRadius: radius.control, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  segment: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 9 },
  segmentOn: { backgroundColor: colors.accent },
  segmentText: { color: colors.textSecondary, fontSize: 13 },
  segmentTextOn: { color: colors.onAccent, fontWeight: '600' },
  list: { maxHeight: 176, flexGrow: 0, flexShrink: 1 },
  listContent: { gap: 2 },
  empty: { color: colors.textMuted, fontSize: 13, textAlign: 'center', paddingVertical: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44, borderRadius: radius.item, paddingRight: spacing.xs },
  rowOn: {},
  pick: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6 },
  dot: { width: 8, height: 8, borderRadius: radius.pill },
  name: { flex: 1, minWidth: 0, color: colors.text, fontSize: 14 },
  editable: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  editableText: { color: colors.textSecondary, fontSize: 12 },
  viewOnly: { color: colors.textMuted, fontSize: 12 },
});

let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
