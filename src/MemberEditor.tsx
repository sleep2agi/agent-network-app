// 设置 → 用户管理 → 成员(#417 重设计,Vincent 2026-09-30「成员编辑那个界面太丑了」)。
// 状态与保存在 useMemberEditor(两端共用,纯判断在 member-editor.ts / user-admin.ts / task-access.ts);
// 两端各画各的,不互相移植:
//   宽屏 —— 双栏弹窗。左栏:角色(分段 + 一行说明)、任务权限(分段 + 项目清单,勾选 · 可编辑)。
//           右栏:可访问的 Agent(全部 / 仅指定)、已选 chip(×移除)、搜索、页签(全部 / 按机器 / 按类型 / 分组)
//           + 全选、可勾选的清单(分组头三态 + 计数,行尾「可对话」)。底栏:左下「移出网络」(点了换成确认条)· 取消 · 保存。
//   手机 —— 设置三级页「成员」(微信 / iOS 设置式分组,✓ 单选行)。「已选 Agent ›」推入「选择 Agent」页(顶上已选头像、
//           搜索、页签、行尾「可对话」),「授权的项目 ›」推入项目页;保存在顶栏右上角;移出网络走底部确认单。
// 用的 Hub 接口与重设计前完全相同:PUT members/:uid {role}、GET/PUT agent-grants(含 group_grants)、GET/PUT task-grants。
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';
import AliasAvatar from './AliasAvatar';
import { fetchHubNodes, type HubConfig } from './api';
import { colors, onThemeChange, radius, spacing } from './theme';
import { useTranslation } from './i18n-react';
import { t as tr } from './i18n';
import './i18n-users';
import { SettingsButton, SettingsCardContent, SettingsChoiceRow, SettingsGroup, SettingsRow } from './settings-kit';
import type { SettingsHeaderOverride } from './settings-model';
import DialogFrame from './DialogFrame';
import RemoveSheet from './RemoveSheet';
import TaskAccessSection, { TaskProjectsPage, useTaskAccessState } from './TaskAccessSection';
import { CheckBox, LabeledSwitch, SectionLabel, Segmented } from './MemberEditorKit';
import { useAgentPicker, type AgentPickerState } from './agent-picker-state';
import {
  ASSIGNABLE_ROLES, grantsEditable, groupSelectionFromGrants, initialAccessMode, memberActions, prefillOnRestrict, selectionFromGrants, setCanMessage, showsCanMessage, toggleAgent,
  type AgentAccess, type AgentGrant, type AuthMe, type HubAgentGroup, type MemberRole, type NetworkMember, type PickableAgent,
} from './user-admin';
import {
  agentMeta, filterAgentGroups, memberSaveRequests, pickerSections, pickerTabs, roleHintKey, sectionCount, selectGroups, selectedChips,
  type MemberDraft, type PickerTab, type SelectedChip,
} from './member-editor';
import { removeNetworkMember, saveAgentGrants, saveTaskGrants, fetchAgentGrants, updateMemberRole } from './user-admin-api';

const ROLE_KEY: Record<string, string> = { owner: 'users.role.owner', admin: 'users.role.admin', member: 'users.role.member', viewer: 'users.role.viewer' };
export const roleLabel = (role: MemberRole) => (ROLE_KEY[role] ? tr(ROLE_KEY[role]) : String(role));
const tabLabel = (tab: PickerTab) => tr(tab === 'none' ? 'users.groupBy.all' : tab === 'groups' ? 'users.groupBy.groups' : `users.groupBy.${tab}`);
/** 分段标题:机器名 / 类型名;空值是「未知机器 / 未知类型」。 */
const sectionLabel = (label: string | null, tab: PickerTab) => label ?? (tab === 'host' ? tr('users.unknownHost') : tr('users.unknownRuntime'));

/** 成员编辑的状态与保存 / 移出(宽屏弹窗与手机三级页共用;两端只换画法)。 */
export function useMemberEditor(cfg: HubConfig, me: AuthMe | null, networkId: string, member: NetworkMember, agentGroups: HubAgentGroup[] | null, onDone: (message: string) => void) {
  const acts = memberActions(me, networkId, member);
  const name = member.display_name || member.username;
  const [agents, setAgents] = useState<PickableAgent[] | null>(null);
  const [original, setOriginal] = useState<AgentGrant[]>([]);
  const [mode0, setMode0] = useState<AgentAccess>('granted');
  const [mode, setModeState] = useState<AgentAccess>('granted');
  const [role, setRole] = useState<MemberRole>(member.role);
  const picker = useAgentPicker(agents, role);
  const { selection, setSelection } = picker;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  // 组授权(group_id → 可对话)。Hub 没有分组时 agentGroups = null,既不显示也不随保存发送。
  const groupsSupported = Array.isArray(agentGroups);
  const [groupsBefore, setGroupsBefore] = useState<Map<string, boolean>>(new Map());
  const [groupSel, setGroupSel] = useState<Map<string, boolean>>(new Map());
  const needGrants = grantsEditable(member);
  useEffect(() => {
    if (!needGrants) { setAgents([]); return; }
    let live = true;
    void Promise.all([fetchHubNodes({ ...cfg, networkId }), fetchAgentGrants(cfg, networkId, member.user_id)])
      .then(([nodes, grants]) => {
        if (!live) return;
        setAgents((nodes.nodes ?? []).map(n => ({ node_id: n.node_id, alias: n.alias, display_name: (n as any).display_name ?? null, role: n.role ?? null, hostname: n.hostname ?? null, runtime: n.runtime ?? null })));
        setOriginal(grants.grants ?? []);
        setSelection(selectionFromGrants(grants.grants ?? []));
        const gs = groupSelectionFromGrants(grants.group_grants);
        setGroupsBefore(gs); setGroupSel(new Map(gs));
        const m = initialAccessMode(grants.agent_access);
        setMode0(m); setModeState(m);
      })
      .catch(e => { if (live) { setAgents([]); setError(String((e as Error)?.message ?? e)); } });
    return () => { live = false; };
  }, [cfg, networkId, member.user_id, needGrants]);
  // 切到「仅指定」:还一个都没勾时预填此刻看得见的全部(一点保存不会把人清成零节点)。
  const setMode = (next: AgentAccess) => {
    if (next === 'granted' && mode === 'all') setSelection(s => prefillOnRestrict(s, agents ?? [], role));
    setModeState(next);
  };
  // 任务权限(RFC-038 §9):Hub 没有 task-grants 时 tasks.supported=false,区块不画、不发。
  const tasks = useTaskAccessState(cfg, networkId, member.user_id, role, needGrants);
  const draft: MemberDraft = {
    role: member.role, nextRole: role, mode: mode0, nextMode: mode, original, selection, canEditAccess: acts.editAccess,
    ...(groupsSupported ? { groups: { before: groupsBefore, after: groupSel } } : {}),
    ...(tasks.supported ? { tasks: { before: tasks.before, mode: tasks.mode, selection: tasks.selection } } : {}),
  };
  const requests = memberSaveRequests(draft);
  const accessEditable = acts.editAccess && grantsEditable({ role });
  const save = () => {
    setBusy(true); setError('');
    void (async () => {
      // 顺序:角色 → 任务权限 → Agent 授权(按新角色写)。每一步失败就停,错误显示在编辑器里。
      for (const r of requests) {
        if (r.kind === 'role') await updateMemberRole(cfg, networkId, member.user_id, r.body.role);
        else if (r.kind === 'tasks') await saveTaskGrants(cfg, networkId, member.user_id, r.body);
        else await saveAgentGrants(cfg, networkId, member.user_id, r.body);
      }
    })()
      .then(() => onDone(tr('users.saved')))
      .catch(e => setError(String((e as Error)?.message ?? e)))
      .finally(() => setBusy(false));
  };
  const remove = () => {
    setBusy(true); setError('');
    void removeNetworkMember(cfg, networkId, member.user_id)
      .then(() => onDone(tr('users.removed', { name })))
      .catch(e => { setConfirmRemove(false); setError(String((e as Error)?.message ?? e)); })
      .finally(() => setBusy(false));
  };
  const groups = groupsSupported ? agentGroups! : [];
  const chips = useMemo(() => selectedChips(agents, selection, groups, groupSel), [agents, selection, groups, groupSel]);
  const removeChip = (c: SelectedChip) => (c.kind === 'group' ? setGroupSel(s => toggleAgent(s, c.id)) : setSelection(s => toggleAgent(s, c.id)));
  const clearPicked = () => { picker.clearAll(); setGroupSel(new Map()); };
  return {
    acts, name, agents, picker, selection, setSelection, mode, setMode, role, setRole,
    agentGroups: groups, groupSel, setGroupSel, tabs: pickerTabs(groups.length > 0), chips, removeChip, clearPicked,
    tasks,
    busy, error, confirmRemove, setConfirmRemove, accessEditable, changed: requests.length > 0, save, remove,
  };
}
type MemberEditorState = ReturnType<typeof useMemberEditor>;

// ─────────────────────────────── 宽屏:双栏弹窗 ───────────────────────────────

const DIALOG_WIDE = 880;
const DIALOG_NARROW = 560;
const DIALOG_HEIGHT = 760;

export function MemberDialog({ cfg, me, networkId, member, agentGroups, onClose, onDone }: { cfg: HubConfig; me: AuthMe | null; networkId: string; member: NetworkMember; agentGroups: HubAgentGroup[] | null; onClose: () => void; onDone: (message: string) => void }) {
  useTranslation();
  const ed = useMemberEditor(cfg, me, networkId, member, agentGroups, onDone);
  const tasksShown = ed.accessEditable && ed.tasks.supported;
  // 有任务权限(左栏)且右栏是授权清单 ⇒ 双栏;否则单栏,角色叠在授权上面(旧 Hub 没有任务权限时左栏只剩角色,空一大块)。
  const twoCol = ed.accessEditable && tasksShown;
  const left = (
    <>
      {ed.acts.editRole ? <RoleSection ed={ed} /> : null}
      {tasksShown ? (
        <TaskAccessSection variant="desktop" mode={ed.tasks.mode} onModeChange={ed.tasks.setMode} projects={ed.tasks.projects} selection={ed.tasks.selection} onSelectionChange={ed.tasks.setSelection} role={ed.role} />
      ) : null}
    </>
  );
  return (
    <DialogFrame
      title={`${tr('users.member')} · ${ed.name}`}
      subtitle={member.username !== ed.name ? member.username : undefined}
      closeLabel={tr('users.close')}
      onClose={onClose}
      scroll={false}
      sectioned
      maxWidth={twoCol ? DIALOG_WIDE : DIALOG_NARROW}
      height={ed.accessEditable ? DIALOG_HEIGHT : undefined}
      testID="grants-dialog"
      footer={<DialogFooter ed={ed} onClose={onClose} />}
    >
      {twoCol ? (
        <View style={styles.cols} testID="member-cols">
          <ScrollView style={styles.colL} contentContainerStyle={styles.colContent} testID="member-col-left">{left}</ScrollView>
          <View style={[styles.colR, styles.colContent]} testID="member-col-right"><AccessColumn ed={ed} /></View>
        </View>
      ) : (
        <View style={[styles.single, styles.colContent]} testID="member-col-single">
          {left}
          {ed.accessEditable ? <AccessColumn ed={ed} /> : <AdminNote role={ed.role} />}
        </View>
      )}
    </DialogFrame>
  );
}

function RoleSection({ ed }: { ed: MemberEditorState }) {
  return (
    <View style={styles.section} testID="member-role-section">
      <SectionLabel>{tr('users.role')}</SectionLabel>
      <Segmented options={ASSIGNABLE_ROLES.map(r => ({ value: r, label: roleLabel(r) }))} value={ed.role} onChange={ed.setRole} label={tr('users.role')} testID="member-role" />
      <Text style={styles.hint} numberOfLines={2} testID="member-role-hint">{tr(roleHintKey(ed.role))}</Text>
    </View>
  );
}

/** owner / admin(或正改成管理员):没有可授权的东西,说一句为什么。 */
function AdminNote({ role }: { role: MemberRole }) {
  if (grantsEditable({ role })) return null;
  return (
    <View style={styles.section}>
      <SectionLabel>{tr('users.agents')}</SectionLabel>
      <View style={styles.noteCard} testID="member-admin-note"><Text style={styles.noteText}>{tr('users.adminAccess')}</Text></View>
    </View>
  );
}

function DialogFooter({ ed, onClose }: { ed: MemberEditorState; onClose: () => void }) {
  if (ed.confirmRemove) {
    return (
      <View style={styles.footerCol} testID="member-remove-box">
        <Text style={styles.confirmText}>{tr('users.removeConfirm', { name: ed.name })}</Text>
        <View style={styles.footerRow}>
          <FooterButton label={tr('users.cancel')} onPress={() => ed.setConfirmRemove(false)} testID="member-remove-cancel" />
          <FooterButton label={tr('users.removeYes')} kind="danger" busy={ed.busy} onPress={ed.remove} testID="member-remove-confirm" />
        </View>
      </View>
    );
  }
  return (
    <View style={styles.footerCol}>
      {ed.error ? <Text style={styles.error} numberOfLines={3} testID="grants-error">{ed.error}</Text> : null}
      <View style={styles.footerRow}>
        {ed.acts.remove ? (
          <Pressable accessibilityRole="button" onPress={() => ed.setConfirmRemove(true)} hitSlop={6} style={({ pressed }) => [styles.removeLink, pressed && styles.pressed]} testID="member-remove-open">
            <Text style={styles.removeText}>{tr('users.remove')}</Text>
          </Pressable>
        ) : null}
        <FooterButton label={tr('users.cancel')} onPress={onClose} testID="grants-cancel" />
        <FooterButton label={tr('users.save')} kind="primary" disabled={!ed.changed} busy={ed.busy} onPress={ed.save} testID="grants-confirm" />
      </View>
    </View>
  );
}

function FooterButton({ label, onPress, kind = 'plain', disabled, busy, testID }: { label: string; onPress: () => void; kind?: 'plain' | 'primary' | 'danger'; disabled?: boolean; busy?: boolean; testID: string }) {
  const off = !!(disabled || busy);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy: !!busy }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [styles.btn, kind === 'plain' ? styles.btnPlain : kind === 'danger' ? styles.btnDanger : styles.btnPrimary, off && styles.disabled, pressed && styles.pressed]}
      testID={testID}
    >
      {busy ? <ActivityIndicator size="small" color={kind === 'plain' ? colors.text : colors.onAccent} /> : null}
      <Text style={kind === 'plain' ? styles.btnPlainText : styles.btnStrongText}>{label}</Text>
    </Pressable>
  );
}

/** 右栏:可访问的 Agent。 */
function AccessColumn({ ed }: { ed: MemberEditorState }) {
  const restricted = ed.mode === 'granted';
  const chat = showsCanMessage(ed.role);
  return (
    <>
      <View style={styles.section}>
        <SectionLabel>{tr('users.agents')}</SectionLabel>
        <Segmented
          options={(['all', 'granted'] as const).map(m => ({ value: m, label: m === 'all' ? tr('users.access.all') : tr('users.access.granted') }))}
          value={ed.mode}
          onChange={ed.setMode}
          label={tr('users.agents')}
          testID="grants-mode"
        />
        {restricted && !chat ? <Text style={styles.hint} numberOfLines={2} testID="grants-mode-hint">{tr('users.viewerHint')}</Text> : null}
      </View>
      {restricted ? (
        <>
          <PickedTray ed={ed} />
          <DesktopPickerList ed={ed} chat={chat} />
        </>
      ) : (
        <View style={styles.noteCard} testID="grants-mode-hint"><Text style={styles.noteText}>{tr('users.access.allCard')}</Text></View>
      )}
    </>
  );
}

/** 「已选 N 个 · 点 × 移除 … 清空」+ chip 托盘(太多时托盘自己滚,不把清单挤没)。 */
function PickedTray({ ed }: { ed: MemberEditorState }) {
  return (
    <View style={styles.section} testID="grants-picked">
      <View style={styles.labelRow}>
        <SectionLabel>{tr('users.picked')}</SectionLabel>
        <Text style={styles.labelCount} numberOfLines={1} testID="grants-count">{tr('users.pickedHint', { count: ed.chips.length })}</Text>
        {ed.chips.length ? (
          <Pressable accessibilityRole="button" onPress={ed.clearPicked} hitSlop={6} style={({ pressed }) => [styles.linkBtn, pressed && styles.pressed]} testID="grants-clear">
            <Text style={styles.link}>{tr('users.clearAll')}</Text>
          </Pressable>
        ) : null}
      </View>
      <ScrollView style={styles.tray} contentContainerStyle={styles.trayContent} testID="grants-tray">
        {ed.chips.length ? ed.chips.map(c => (
          <View key={`${c.kind}-${c.id}`} style={styles.chip} testID={`grant-chip-${c.alias}`}>
            {c.kind === 'group' ? <View style={styles.chipGroupIcon}><Ionicons name="albums-outline" size={13} color={colors.textSecondary} /></View> : <AliasAvatar alias={c.alias} size={22} />}
            <Text style={[styles.chipText, !c.canMessage && styles.chipTextMuted]} numberOfLines={1}>{c.label}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={tr('users.removeChip', { name: c.label })} onPress={() => ed.removeChip(c)} hitSlop={6} style={({ pressed, hovered }: any) => [styles.chipX, (pressed || hovered) && styles.chipXHover]} testID={`grant-chip-remove-${c.alias}`}>
              <Ionicons name="close" size={13} color={colors.textMuted} />
            </Pressable>
          </View>
        )) : <Text style={styles.trayEmpty}>{tr('users.pickedNone')}</Text>}
      </ScrollView>
    </View>
  );
}

function SearchBox({ p, placeholder, testID = 'grants-search' }: { p: AgentPickerState; placeholder: string; testID?: string }) {
  return (
    <View style={styles.search}>
      <Ionicons name="search-outline" size={15} color={colors.textMuted} />
      <TextInput value={p.query} onChangeText={p.setQuery} placeholder={placeholder} placeholderTextColor={colors.textMuted} accessibilityLabel={placeholder} autoCapitalize="none" autoCorrect={false} style={styles.searchInput} testID={testID} />
      {p.query ? (
        <Pressable accessibilityRole="button" accessibilityLabel={tr('users.clearSearch')} onPress={() => p.setQuery('')} hitSlop={8} testID={`${testID}-clear`}>
          <Ionicons name="close-circle" size={16} color={colors.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** 「全选」的文案与动作(随页签 / 搜索变)。 */
function selectAllAction(ed: MemberEditorState) {
  const p = ed.picker;
  if (p.groupBy === 'groups') {
    const shown = filterAgentGroups(ed.agentGroups, p.query);
    return { label: tr('users.selectGroups'), run: () => ed.setGroupSel(s => selectGroups(s, shown, ed.role)), any: shown.length > 0 };
  }
  return { label: p.query.trim() ? tr('users.selectResultsCount', { count: p.visible.length }) : tr('users.selectAll'), run: p.selectVisible, any: p.visible.length > 0 };
}

function DesktopPickerList({ ed, chat }: { ed: MemberEditorState; chat: boolean }) {
  const p = ed.picker;
  const all = selectAllAction(ed);
  return (
    <View style={[styles.section, styles.grow]} testID="grants-picker">
      <SearchBox p={p} placeholder={tr('users.search')} />
      <View style={styles.toolbar} testID="grants-toolbar">
        <Segmented options={ed.tabs.map(t => ({ value: t, label: tabLabel(t) }))} value={p.groupBy} onChange={p.setGroupBy} label={tr('users.groupBy')} fit small testID="grants-group-by" />
        <Pressable accessibilityRole="button" disabled={!all.any} onPress={all.run} hitSlop={6} style={({ pressed }) => [styles.linkBtn, styles.toolbarLink, !all.any && styles.disabled, pressed && styles.pressed]} testID="grants-select-visible">
          <Text style={styles.link} numberOfLines={1}>{all.label}</Text>
        </Pressable>
      </View>
      <ScrollView style={styles.list} testID="grants-list">
        {p.groupBy === 'groups' ? <DesktopGroupRows ed={ed} chat={chat} /> : <DesktopAgentRows ed={ed} chat={chat} />}
      </ScrollView>
      <Text style={styles.hint} numberOfLines={2} testID={p.groupBy === 'groups' ? 'grant-agroups-hint' : 'grants-one-time'}>{p.groupBy === 'groups' ? tr('users.grantGroupsHint') : tr('users.oneTimeNote')}</Text>
    </View>
  );
}

function DesktopAgentRows({ ed, chat }: { ed: MemberEditorState; chat: boolean }) {
  const p = ed.picker;
  if (p.agents === null) return <ActivityIndicator style={styles.loading} color={colors.textMuted} />;
  if (!p.visible.length) return <Text style={styles.empty}>{p.agents.length ? tr('users.noMatch') : tr('users.noAgents')}</Text>;
  const tab = p.groupBy;
  return (
    <>
      {pickerSections(p.visible, tab).map(sec => {
        const cnt = sectionCount(p.selection, sec.agents);
        const key = sec.key || 'unknown';
        return (
          <View key={`g-${sec.key}`}>
            {tab === 'host' || tab === 'runtime' ? (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: cnt.state === 'all' ? true : cnt.state === 'some' ? 'mixed' : false }}
                aria-checked={cnt.state === 'all' ? true : cnt.state === 'some' ? 'mixed' : false}
                accessibilityLabel={sectionLabel(sec.label, tab)}
                onPress={() => p.toggleGroup(sec.agents)}
                style={({ hovered }: any) => [styles.groupHead, hovered && styles.rowHover]}
                testID={`grant-group-${key}`}
              >
                <CheckBox state={cnt.state} />
                <Text style={styles.groupName} numberOfLines={1}>{sectionLabel(sec.label, tab)}</Text>
                <Text style={styles.groupCount} testID={`grant-group-${key}-count`}>{`${cnt.on} / ${cnt.total}`}</Text>
              </Pressable>
            ) : null}
            {sec.agents.map(a => {
              const on = p.selection.has(a.node_id);
              const meta = agentMeta(a);
              return (
                <View key={a.node_id} style={[styles.row, on && styles.rowOn]} testID={`grant-row-${a.alias}`}>
                  <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: on }} aria-checked={on} accessibilityLabel={a.alias} onPress={() => p.setSelection(s => toggleAgent(s, a.node_id))} style={styles.rowPick} testID={`grant-toggle-${a.alias}`}>
                    <CheckBox state={on} />
                    <AliasAvatar alias={a.alias} size={28} />
                    <Text style={styles.rowName} numberOfLines={1}>
                      {a.display_name || a.alias}
                      {meta ? <Text style={styles.rowMeta}>{`  ${meta}`}</Text> : null}
                    </Text>
                  </Pressable>
                  {on && chat ? (
                    <LabeledSwitch label={tr('users.canMessage')} accessibilityLabel={`${tr('users.canMessage')} ${a.alias}`} value={p.selection.get(a.node_id) === true} onValueChange={v => p.setSelection(s => setCanMessage(s, a.node_id, v))} testID={`grant-can-message-${a.alias}`} />
                  ) : on ? <Text style={styles.readOnlyTag} testID={`grant-read-only-${a.alias}`}>{tr('users.readOnly')}</Text> : null}
                </View>
              );
            })}
          </View>
        );
      })}
    </>
  );
}

function DesktopGroupRows({ ed, chat }: { ed: MemberEditorState; chat: boolean }) {
  const shown = filterAgentGroups(ed.agentGroups, ed.picker.query);
  if (!shown.length) return <Text style={styles.empty}>{tr('users.noGroupMatch')}</Text>;
  return (
    <View testID="grant-agroups">
      {shown.map(g => {
        const on = ed.groupSel.has(g.group_id);
        return (
          <View key={g.group_id} style={[styles.row, on && styles.rowOn]} testID={`grant-agroup-row-${g.name}`}>
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: on }} aria-checked={on} accessibilityLabel={g.name} onPress={() => ed.setGroupSel(s => toggleAgent(s, g.group_id))} style={styles.rowPick} testID={`grant-agroup-${g.name}`}>
              <CheckBox state={on} />
              <View style={styles.groupIcon}><Ionicons name="albums-outline" size={15} color={colors.textSecondary} /></View>
              <Text style={styles.rowName} numberOfLines={1}>
                {g.name}
                <Text style={styles.rowMeta}>{`  ${tr('users.groupMembers', { count: g.member_count })}`}</Text>
              </Text>
            </Pressable>
            {on && chat ? (
              <LabeledSwitch label={tr('users.canMessage')} accessibilityLabel={`${tr('users.canMessage')} ${g.name}`} value={ed.groupSel.get(g.group_id) === true} onValueChange={v => ed.setGroupSel(s => setCanMessage(s, g.group_id, v))} testID={`grant-agroup-can-message-${g.name}`} />
            ) : on ? <Text style={styles.readOnlyTag}>{tr('users.readOnly')}</Text> : null}
          </View>
        );
      })}
    </View>
  );
}

// ─────────────────────────────── 手机:成员页 + 推入的两页 ───────────────────────────────

/** 手机三级页接管顶栏用的两个回调(SettingsScreen 给)。 */
export type PhoneHeaderHost = { setHeader?: (h: SettingsHeaderOverride | null) => void; scrollTop?: () => void };
type PhoneSub = null | 'agents' | 'projects';

export function MemberPage({ cfg, me, networkId, member, agentGroups, onDone, host }: { cfg: HubConfig; me: AuthMe | null; networkId: string; member: NetworkMember; agentGroups: HubAgentGroup[] | null; onDone: (message: string) => void; host?: PhoneHeaderHost }) {
  useTranslation();
  const ed = useMemberEditor(cfg, me, networkId, member, agentGroups, onDone);
  const [sub, setSub] = useState<PhoneSub>(null);
  // 顶栏按钮拿最新的保存(不因每次重绘都重设顶栏)。
  const saveRef = useRef(ed.save);
  saveRef.current = ed.save;
  const setHeader = host?.setHeader;
  const count = ed.chips.length;
  useEffect(() => {
    if (!setHeader) return;
    const back = () => setSub(null);
    if (sub === 'agents') setHeader({ title: tr('users.pickAgents'), onBack: back, action: { label: tr('users.doneCount', { count }), onPress: back, testID: 'member-pick-done' } });
    else if (sub === 'projects') setHeader({ title: tr('users.tasks.projectsPage'), onBack: back, action: { label: tr('users.done'), onPress: back, testID: 'member-projects-done' } });
    else setHeader({ action: { label: tr('users.save'), onPress: () => saveRef.current(), disabled: !ed.changed, busy: ed.busy && !ed.confirmRemove, testID: 'grants-confirm' } });
  }, [setHeader, sub, count, ed.changed, ed.busy, ed.confirmRemove]);
  useEffect(() => () => setHeader?.(null), [setHeader]);
  useEffect(() => { host?.scrollTop?.(); }, [sub]);
  if (sub === 'agents') return <PhoneAgentPickerPage ed={ed} />;
  if (sub === 'projects') {
    return (
      <View testID="member-projects-page">
        <TaskProjectsPage projects={ed.tasks.projects} selection={ed.tasks.selection} onSelectionChange={ed.tasks.setSelection} />
      </View>
    );
  }
  const restricted = ed.mode === 'granted';
  const chat = showsCanMessage(ed.role);
  const stack = ed.chips.slice(0, 4);
  return (
    <View testID="member-page">
      <SettingsGroup testID="member-page-head">
        <SettingsCardContent testID="member-page-identity">
          <View style={styles.profile}>
            <AliasAvatar alias={ed.name} size={48} />
            <View style={styles.profileText}>
              <Text style={styles.profileName} numberOfLines={1}>{ed.name}</Text>
              <Text style={styles.profileSub} numberOfLines={1}>{`${member.username} · ${roleLabel(member.role)}`}</Text>
            </View>
          </View>
        </SettingsCardContent>
      </SettingsGroup>
      {ed.acts.editRole ? (
        <SettingsGroup title={tr('users.role')} footer={tr(roleHintKey(ed.role))} testID="member-page-role">
          {ASSIGNABLE_ROLES.map(r => (
            <SettingsChoiceRow key={r} label={roleLabel(r)} selected={ed.role === r} onPress={() => ed.setRole(r)} testID={`member-role-${r}`} />
          ))}
        </SettingsGroup>
      ) : null}
      {ed.accessEditable ? (
        <SettingsGroup title={tr('users.agents')} footer={restricted ? (chat ? tr('users.access.grantedFooter') : tr('users.viewerHint')) : tr('users.access.allHint')} testID="member-page-mode">
          <SettingsChoiceRow label={tr('users.access.all')} selected={!restricted} onPress={() => ed.setMode('all')} testID="grants-mode-all" />
          <SettingsChoiceRow label={tr('users.access.granted')} selected={restricted} onPress={() => ed.setMode('granted')} testID="grants-mode-granted" />
          {restricted ? (
            <SettingsRow
              label={tr('users.pickedAgents')}
              value={tr('users.pickedCount', { count })}
              valueExtra={stack.length ? <AvatarStack chips={stack} /> : undefined}
              onPress={() => setSub('agents')}
              accessibilityLabel={`${tr('users.pickedAgents')} ${count}`}
              testID="member-picked-agents"
            />
          ) : null}
        </SettingsGroup>
      ) : !grantsEditable({ role: ed.role }) ? (
        <SettingsGroup title={tr('users.agents')} footer={tr('users.adminAccess')} testID="member-admin-note">
          <SettingsRow label={tr('users.access.all')} testID="member-admin-note-row" />
        </SettingsGroup>
      ) : null}
      {ed.accessEditable && ed.tasks.supported ? (
        <TaskAccessSection variant="phone" mode={ed.tasks.mode} onModeChange={ed.tasks.setMode} projects={ed.tasks.projects} selection={ed.tasks.selection} onSelectionChange={ed.tasks.setSelection} role={ed.role} onOpenProjects={() => setSub('projects')} />
      ) : null}
      {ed.error ? <SettingsGroup footer={ed.error} footerTone="danger" testID="grants-error" /> : null}
      {ed.acts.remove ? <SettingsButton label={tr('users.remove')} variant="destructive" onPress={() => ed.setConfirmRemove(true)} testID="member-remove-open" /> : null}
      {/* 没有接管顶栏的宿主(不该发生)时,保存退回成页底的整宽按钮。 */}
      {setHeader ? null : <SettingsButton label={tr('users.save')} onPress={ed.save} disabled={!ed.changed} busy={ed.busy && !ed.confirmRemove} testID="grants-confirm" />}
      {ed.confirmRemove ? <RemoveSheet name={ed.name} busy={ed.busy} onCancel={() => ed.setConfirmRemove(false)} onConfirm={ed.remove} /> : null}
    </View>
  );
}

function AvatarStack({ chips }: { chips: SelectedChip[] }) {
  return (
    <View style={styles.stack} testID="member-picked-stack">
      {chips.map((c, i) => (
        <View key={`${c.kind}-${c.id}`} style={[styles.stackItem, i > 0 && styles.stackOverlap]}>
          {c.kind === 'group' ? <View style={styles.stackGroup}><Ionicons name="albums-outline" size={12} color={colors.textSecondary} /></View> : <AliasAvatar alias={c.alias} size={24} />}
        </View>
      ))}
    </View>
  );
}

/** 手机推入的「选择 Agent」页(微信「选择联系人」式):已选头像一排(点 × 移除)、搜索、页签、整行可点的清单。 */
function PhoneAgentPickerPage({ ed }: { ed: MemberEditorState }) {
  const p = ed.picker;
  const chat = showsCanMessage(ed.role);
  const all = selectAllAction(ed);
  return (
    <View testID="member-pick-page">
      {ed.chips.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pTray} contentContainerStyle={styles.pTrayContent} testID="grants-tray">
          {ed.chips.map(c => (
            <View key={`${c.kind}-${c.id}`} style={styles.pChip} testID={`grant-chip-${c.alias}`}>
              {c.kind === 'group' ? <View style={styles.pChipGroup}><Ionicons name="albums-outline" size={18} color={colors.textSecondary} /></View> : <AliasAvatar alias={c.alias} size={40} />}
              <Text style={styles.pChipText} numberOfLines={1}>{c.label}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={tr('users.removeChip', { name: c.label })} onPress={() => ed.removeChip(c)} hitSlop={8} style={styles.pChipX} testID={`grant-chip-remove-${c.alias}`}>
                <Ionicons name="close" size={11} color={colors.groupedRow} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      ) : null}
      <View style={styles.pBar}>
        <SearchBox p={p} placeholder={tr('users.searchShort')} />
        <Segmented options={ed.tabs.map(t => ({ value: t, label: tabLabel(t) }))} value={p.groupBy} onChange={p.setGroupBy} label={tr('users.groupBy')} small testID="grants-group-by" />
        <View style={styles.pTools}>
          <Text style={styles.pCount} numberOfLines={1} testID="grants-count">{tr('users.selected', { count: ed.chips.length })}</Text>
          <Pressable accessibilityRole="button" disabled={!all.any} onPress={all.run} hitSlop={8} style={({ pressed }) => [styles.pToolBtn, !all.any && styles.disabled, pressed && styles.pressed]} testID="grants-select-visible">
            <Text style={styles.link} numberOfLines={1}>{all.label}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={!ed.chips.length} onPress={ed.clearPicked} hitSlop={8} style={({ pressed }) => [styles.pToolBtn, !ed.chips.length && styles.disabled, pressed && styles.pressed]} testID="grants-clear">
            <Text style={styles.link} numberOfLines={1}>{tr('users.clearAll')}</Text>
          </Pressable>
        </View>
      </View>
      <View style={styles.pList} testID="grants-list">
        {p.groupBy === 'groups' ? <PhoneGroupRows ed={ed} chat={chat} /> : <PhoneAgentRows ed={ed} chat={chat} />}
      </View>
      <Text style={styles.pNote} testID={p.groupBy === 'groups' ? 'grant-agroups-hint' : 'grants-one-time'}>{p.groupBy === 'groups' ? tr('users.grantGroupsHint') : tr('users.oneTimeNote')}</Text>
    </View>
  );
}

function Circle({ state }: { state: 'all' | 'some' | 'none' | boolean }) {
  const s = state === true ? 'all' : state === false ? 'none' : state;
  return <Ionicons name={s === 'all' ? 'checkmark-circle' : s === 'some' ? 'remove-circle' : 'ellipse-outline'} size={24} color={s === 'none' ? colors.textMuted : colors.accent} />;
}

function PhoneAgentRows({ ed, chat }: { ed: MemberEditorState; chat: boolean }) {
  const p = ed.picker;
  if (p.agents === null) return <ActivityIndicator style={styles.loading} color={colors.textMuted} />;
  if (!p.visible.length) return <Text style={styles.empty}>{p.agents.length ? tr('users.noMatch') : tr('users.noAgents')}</Text>;
  const tab = p.groupBy;
  return (
    <>
      {pickerSections(p.visible, tab).map(sec => {
        const cnt = sectionCount(p.selection, sec.agents);
        const key = sec.key || 'unknown';
        return (
          <View key={`g-${sec.key}`}>
            {tab === 'host' || tab === 'runtime' ? (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: cnt.state === 'all' ? true : cnt.state === 'some' ? 'mixed' : false }}
                aria-checked={cnt.state === 'all' ? true : cnt.state === 'some' ? 'mixed' : false}
                accessibilityLabel={sectionLabel(sec.label, tab)}
                onPress={() => p.toggleGroup(sec.agents)}
                style={({ pressed }) => [styles.pHead, pressed && styles.pressed]}
                testID={`grant-group-${key}`}
              >
                <Circle state={cnt.state} />
                <Text style={styles.pHeadName} numberOfLines={1}>{sectionLabel(sec.label, tab)}</Text>
                <Text style={styles.groupCount} testID={`grant-group-${key}-count`}>{`${cnt.on} / ${cnt.total}`}</Text>
              </Pressable>
            ) : null}
            {sec.agents.map(a => {
              const on = p.selection.has(a.node_id);
              const meta = agentMeta(a);
              return (
                <View key={a.node_id} style={styles.pRow} testID={`grant-row-${a.alias}`}>
                  <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: on }} aria-checked={on} accessibilityLabel={a.alias} onPress={() => p.setSelection(s => toggleAgent(s, a.node_id))} style={({ pressed }) => [styles.pRowPick, pressed && styles.pressed]} testID={`grant-toggle-${a.alias}`}>
                    <Circle state={on} />
                    <AliasAvatar alias={a.alias} size={36} />
                    <View style={styles.pRowText}>
                      <Text style={styles.pRowName} numberOfLines={1}>{a.display_name || a.alias}</Text>
                      {meta || a.display_name ? <Text style={styles.pRowMeta} numberOfLines={1}>{meta || a.alias}</Text> : null}
                    </View>
                  </Pressable>
                  {on && chat ? (
                    <LabeledSwitch label={tr('users.canMessage')} accessibilityLabel={`${tr('users.canMessage')} ${a.alias}`} value={p.selection.get(a.node_id) === true} onValueChange={v => p.setSelection(s => setCanMessage(s, a.node_id, v))} testID={`grant-can-message-${a.alias}`} />
                  ) : on ? <Text style={styles.readOnlyTag} testID={`grant-read-only-${a.alias}`}>{tr('users.readOnly')}</Text> : null}
                </View>
              );
            })}
          </View>
        );
      })}
    </>
  );
}

function PhoneGroupRows({ ed, chat }: { ed: MemberEditorState; chat: boolean }) {
  const shown = filterAgentGroups(ed.agentGroups, ed.picker.query);
  if (!shown.length) return <Text style={styles.empty}>{tr('users.noGroupMatch')}</Text>;
  return (
    <View testID="grant-agroups">
      {shown.map(g => {
        const on = ed.groupSel.has(g.group_id);
        return (
          <View key={g.group_id} style={styles.pRow} testID={`grant-agroup-row-${g.name}`}>
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: on }} aria-checked={on} accessibilityLabel={g.name} onPress={() => ed.setGroupSel(s => toggleAgent(s, g.group_id))} style={({ pressed }) => [styles.pRowPick, pressed && styles.pressed]} testID={`grant-agroup-${g.name}`}>
              <Circle state={on} />
              <View style={styles.pChipGroup}><Ionicons name="albums-outline" size={18} color={colors.textSecondary} /></View>
              <View style={styles.pRowText}>
                <Text style={styles.pRowName} numberOfLines={1}>{g.name}</Text>
                <Text style={styles.pRowMeta} numberOfLines={1}>{tr('users.groupMembers', { count: g.member_count })}</Text>
              </View>
            </Pressable>
            {on && chat ? (
              <LabeledSwitch label={tr('users.canMessage')} accessibilityLabel={`${tr('users.canMessage')} ${g.name}`} value={ed.groupSel.get(g.group_id) === true} onValueChange={v => ed.setGroupSel(s => setCanMessage(s, g.group_id, v))} testID={`grant-agroup-can-message-${g.name}`} />
            ) : on ? <Text style={styles.readOnlyTag}>{tr('users.readOnly')}</Text> : null}
          </View>
        );
      })}
    </View>
  );
}

const PAD_X = spacing.lg + spacing.xs;
const makeStyles = () => StyleSheet.create({
  // —— 宽屏 ——
  cols: { flex: 1, minHeight: 0, flexDirection: 'row' },
  // RN-web 的 ScrollView 自带 flexGrow: 1:行里要显式关掉,否则左栏会吃掉一半宽。
  colL: { width: 340, flexGrow: 0, flexShrink: 0, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border },
  colR: { flex: 1, minWidth: 0, minHeight: 0 },
  single: { flex: 1, minHeight: 0 },
  colContent: { gap: spacing.lg + spacing.xs, paddingHorizontal: PAD_X, paddingVertical: spacing.lg + 2 },
  section: { gap: spacing.sm },
  grow: { flex: 1, minHeight: 0 },
  hint: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  noteCard: { padding: spacing.md + 2, borderRadius: radius.control, backgroundColor: colors.subtleFill },
  noteText: { color: colors.textSecondary, fontSize: 13, lineHeight: 20 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 20 },
  labelCount: { flex: 1, minWidth: 0, color: colors.textMuted, fontSize: 12 },
  linkBtn: { minHeight: 24, justifyContent: 'center' },
  link: { color: colors.accent, fontSize: 13 },
  tray: { maxHeight: 104, flexGrow: 0, borderRadius: radius.control, backgroundColor: colors.subtleFill },
  trayContent: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, padding: spacing.sm + 2, minHeight: 48 },
  trayEmpty: { color: colors.textMuted, fontSize: 12, paddingHorizontal: spacing.xs },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 30, paddingLeft: 3, paddingRight: 4, borderRadius: radius.pill, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, maxWidth: 200 },
  chipGroupIcon: { width: 22, height: 22, borderRadius: radius.pill, backgroundColor: colors.subtleFill, alignItems: 'center', justifyContent: 'center' },
  chipText: { flexShrink: 1, minWidth: 0, color: colors.text, fontSize: 13 },
  chipTextMuted: { color: colors.textSecondary },
  chipX: { width: 18, height: 18, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  chipXHover: { backgroundColor: colors.rowHover },
  search: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 38, paddingHorizontal: spacing.md, borderRadius: radius.control, backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.border },
  searchInput: { flex: 1, minWidth: 0, color: colors.text, fontSize: 14, paddingVertical: spacing.sm, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}) },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  toolbarLink: { marginLeft: 'auto', minHeight: 30 },
  list: { flex: 1, minHeight: 0, borderWidth: 1, borderColor: colors.border, borderRadius: radius.control },
  loading: { marginVertical: spacing.lg },
  empty: { color: colors.textMuted, fontSize: 13, textAlign: 'center', paddingVertical: spacing.lg },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2, minHeight: 36, paddingHorizontal: spacing.md + 2, backgroundColor: colors.subtleFill, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  groupName: { flex: 1, minWidth: 0, color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  groupCount: { color: colors.textMuted, fontSize: 12 },
  groupIcon: { width: 28, height: 28, borderRadius: radius.pill, backgroundColor: colors.subtleFill, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44, paddingHorizontal: spacing.md + 2, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowOn: { backgroundColor: colors.tonalBg },
  rowHover: { backgroundColor: colors.rowHover },
  rowPick: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2, paddingVertical: 6 },
  rowName: { flex: 1, minWidth: 0, color: colors.text, fontSize: 14 },
  rowMeta: { color: colors.textMuted, fontSize: 12 },
  readOnlyTag: { color: colors.textMuted, fontSize: 12 },
  footerCol: { gap: spacing.sm },
  footerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.sm },
  removeLink: { marginRight: 'auto', minHeight: 38, justifyContent: 'center' },
  removeText: { color: colors.failed, fontSize: 14 },
  confirmText: { color: colors.text, fontSize: 13, lineHeight: 19 },
  error: { color: colors.failed, fontSize: 12, lineHeight: 18 },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 38, paddingHorizontal: spacing.lg + 2, borderRadius: radius.control },
  btnPlain: { borderWidth: 1, borderColor: colors.border },
  btnPrimary: { backgroundColor: colors.accent },
  btnDanger: { backgroundColor: colors.failed },
  btnPlainText: { color: colors.text, fontSize: 14 },
  btnStrongText: { color: colors.onAccent, fontSize: 14, fontWeight: '600' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.75 },
  // —— 手机 ——
  profile: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  profileText: { flex: 1, minWidth: 0, gap: 2 },
  profileName: { color: colors.text, fontSize: 17, fontWeight: '600' },
  profileSub: { color: colors.textMuted, fontSize: 13 },
  stack: { flexDirection: 'row', alignItems: 'center' },
  stackItem: { borderRadius: radius.pill, borderWidth: 2, borderColor: colors.groupedRow },
  stackOverlap: { marginLeft: -8 },
  stackGroup: { width: 24, height: 24, borderRadius: radius.pill, backgroundColor: colors.subtleFill, alignItems: 'center', justifyContent: 'center' },
  pTray: { flexGrow: 0, backgroundColor: colors.groupedRow, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  pTrayContent: { gap: spacing.sm + 2, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm + 2 },
  pChip: { width: 52, alignItems: 'center', gap: spacing.xs },
  pChipText: { maxWidth: 52, color: colors.textSecondary, fontSize: 11 },
  pChipX: { position: 'absolute', top: -4, right: 2, width: 16, height: 16, borderRadius: radius.pill, backgroundColor: colors.textMuted, alignItems: 'center', justifyContent: 'center' },
  pChipGroup: { width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.subtleFill, alignItems: 'center', justifyContent: 'center' },
  pBar: { gap: spacing.sm + 2, paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.sm, backgroundColor: colors.groupedRow, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  pTools: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, minHeight: 32, paddingHorizontal: spacing.xs },
  pCount: { flex: 1, minWidth: 0, color: colors.textMuted, fontSize: 13 },
  pToolBtn: { minHeight: 32, justifyContent: 'center' },
  pList: { backgroundColor: colors.groupedRow },
  pHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 44, paddingHorizontal: spacing.lg, backgroundColor: colors.groupedBg },
  pHeadName: { flex: 1, minWidth: 0, color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  pRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 56, paddingHorizontal: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  pRowPick: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  pRowText: { flex: 1, minWidth: 0, gap: 1 },
  pRowName: { color: colors.text, fontSize: 16 },
  pRowMeta: { color: colors.textMuted, fontSize: 12 },
  pNote: { color: colors.textMuted, fontSize: 12, lineHeight: 17, paddingHorizontal: spacing.lg + spacing.lg, paddingTop: spacing.sm },
});

let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
