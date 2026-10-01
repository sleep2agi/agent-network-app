// 成员的「任务权限」(RFC-038 §9):全部任务 / 仅相关任务 + 授权的项目(可看 / 可编辑)。
//
// 自成一体的区块:状态由调用方持有(mode + selection + onChange),这里只画(成员编辑器 MemberEditor.tsx 用)。
//   desktop —— 双栏成员弹窗的左栏:小节标题 + 分段控件「全部任务 / 仅相关任务」+ 说明 + 带边框的项目清单
//              (复选框 · 色点 · 名称 · 可编辑开关)。
//   phone   —— 微信式分组:两个单选行 +「授权的项目 N 个 ›」(推入 TaskProjectsPage)+「可编辑的项目」开关组,
//              只用 settings-kit 的积木。
// viewer:没有「可编辑」开关(hub 上 viewer 本来就不能改),只显示「只看」。
import { Pressable, StyleSheet, View } from 'react-native';
import { useEffect, useState } from 'react';
import { Text } from './ui-text';
import { CheckBox, LabeledSwitch, Segmented, SectionLabel } from './MemberEditorKit';
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
  return { supported, projects, before, mode, setMode, selection, setSelection, changed, save };
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
  /** 手机:点「授权的项目 N 个 ›」推入项目页(TaskProjectsPage)。 */
  onOpenProjects?: () => void;
};

const MODES: readonly TaskAccess[] = ['all', 'scoped'];

export default function TaskAccessSection(props: TaskAccessSectionProps) {
  return props.variant === 'desktop' ? <DesktopTaskAccess {...props} /> : <PhoneTaskAccess {...props} />;
}

function hint(mode: TaskAccess, role: MemberRole): string {
  if (mode === 'all') return tr('users.tasks.allHint');
  return role === 'viewer' ? tr('users.tasks.viewerHint') : tr('users.tasks.scopedHint');
}

/**
 * 宽屏(成员弹窗左栏):小节标题 + 分段控件 + 一行说明 + 带边框的项目清单(勾选 · 色点 · 名称 · 可编辑)。
 * 清单不自己滚:左栏整栏是一个 ScrollView(别在里面再套一个同向的)。
 */
function DesktopTaskAccess({ mode, onModeChange, projects, selection, onSelectionChange, role }: TaskAccessSectionProps) {
  const viewer = role === 'viewer';
  const list = grantableProjects(projects ?? [], selection);
  return (
    <View style={styles.field} testID="task-access">
      <SectionLabel>{tr('users.tasks')}</SectionLabel>
      <Segmented
        options={MODES.map(m => ({ value: m, label: m === 'all' ? tr('users.tasks.all') : tr('users.tasks.scoped') }))}
        value={mode}
        onChange={onModeChange}
        label={tr('users.tasks')}
        testID="task-access-mode"
      />
      <Text style={styles.hint} numberOfLines={2} testID="task-access-hint">{hint(mode, role)}</Text>
      {mode === 'scoped' ? (
        <View style={styles.list} testID="task-access-projects">
          {projects === null ? <Text style={styles.empty}>…</Text> : null}
          {projects && !list.length ? <Text style={styles.empty}>{tr('users.tasks.noProjects')}</Text> : null}
          {list.map((p, i) => {
            const on = selection.has(p.id);
            return (
              <View key={p.id} style={[styles.row, i > 0 && styles.rowDivider, on && styles.rowOn]} testID={`task-project-row-${p.name}`}>
                <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: on }} aria-checked={on} accessibilityLabel={p.name} onPress={() => onSelectionChange(toggleProject(selection, p.id))} style={styles.pick} testID={`task-project-${p.name}`}>
                  <CheckBox state={on} />
                  <View style={[styles.dot, { backgroundColor: p.color || colors.textMuted }]} />
                  <Text style={styles.name} numberOfLines={1}>{p.name}</Text>
                </Pressable>
                {on && !viewer ? (
                  <LabeledSwitch
                    label={tr('users.tasks.editable')}
                    accessibilityLabel={`${tr('users.tasks.editable')} ${p.name}`}
                    value={selection.get(p.id) === true}
                    onValueChange={v => onSelectionChange(setProjectEditable(selection, p.id, v))}
                    testID={`task-project-editable-${p.name}`}
                  />
                ) : on ? <Text style={styles.viewOnly} testID={`task-project-view-only-${p.name}`}>{tr('users.tasks.viewOnly')}</Text> : null}
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

/**
 * 手机(成员页):微信式分组 —— 两个单选行 +「授权的项目 N 个 ›」(推入 TaskProjectsPage)+「可编辑的项目」开关组。
 * 没给 onOpenProjects 时(不该发生)退回原地展开的清单,别让项目选不了。
 */
function PhoneTaskAccess({ mode, onModeChange, projects, selection, onSelectionChange, role, onOpenProjects }: TaskAccessSectionProps) {
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
            onPress={onOpenProjects ?? (() => setOpen(o => !o))}
            accessibilityLabel={`${tr('users.tasks.projects')} ${selection.size}`}
            testID="task-access-projects-row"
          />
        ) : null}
      </SettingsGroup>
      {mode === 'scoped' && open && !onOpenProjects ? <TaskProjectsPage projects={projects} selection={selection} onSelectionChange={onSelectionChange} /> : null}
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

/** 手机推入的「授权的项目」页:一张卡片的 ✓ 清单。 */
export function TaskProjectsPage({ projects, selection, onSelectionChange }: Pick<TaskAccessSectionProps, 'projects' | 'selection' | 'onSelectionChange'>) {
  const list = grantableProjects(projects ?? [], selection);
  return (
    <SettingsGroup title={tr('users.tasks.projects')} footer={tr('users.tasks.scopedHint')} testID="task-access-projects">
      {projects === null ? <SettingsRow label="…" busy testID="task-access-projects-loading" /> : null}
      {projects && !list.length ? <SettingsRow label={tr('users.tasks.noProjects')} tone="muted" testID="task-access-projects-empty" /> : null}
      {list.map(p => (
        <SettingsChoiceRow key={p.id} label={p.name} selected={selection.has(p.id)} onPress={() => onSelectionChange(toggleProject(selection, p.id))} testID={`task-project-${p.name}`} />
      ))}
    </SettingsGroup>
  );
}

const makeStyles = () => StyleSheet.create({
  field: { gap: spacing.sm },
  hint: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  list: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, overflow: 'hidden' },
  empty: { color: colors.textMuted, fontSize: 13, textAlign: 'center', paddingVertical: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 42, paddingHorizontal: spacing.md + 2 },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  rowOn: { backgroundColor: colors.tonalBg },
  pick: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2, paddingVertical: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: radius.pill },
  name: { flex: 1, minWidth: 0, color: colors.text, fontSize: 14 },
  viewOnly: { color: colors.textMuted, fontSize: 12 },
});

let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
