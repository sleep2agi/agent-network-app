// 设置 → 用户管理(多用户账号与 Agent 权限,hub agent-network#2084)。
// 列出当前网络的成员;owner / admin 行恒为「全部 Agent」;点成员可改「可访问范围」(全部 / 仅指定)、
// 逐个分配 Agent 与「可对话」、改角色、移出网络(RFC-038 第 1 步)。「新建用户」走 POST /api/admin/users。
// 成员列表宽屏右栏与手机子页共用;点进成员后两端分开画:
//   宽屏 —— 居中弹窗(分段控件 + 可搜的勾选清单 + 左下角「移出网络」);
//   手机 —— 设置三级页「成员」(微信式分组:角色单选、范围单选、Agent ✓ 多选、可对话开关组、整宽按钮、底部确认单)。
// 纯判断在 user-admin.ts。
import { useCallback, useEffect, useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';
import AliasAvatar from './AliasAvatar';
import { fetchHubNodes, type HubConfig } from './api';
import { colors, onThemeChange, radius, spacing } from './theme';
import { useTranslation } from './i18n-react';
import { t as tr } from './i18n';
import './i18n-users';
import { SettingsButton, SettingsChoiceRow, SettingsGroup, SettingsRow, SettingsSwitchRow, SettingsTextField, SettingsTriStateRow } from './settings-kit';
import { useModalSafePadding } from './safe-area-runtime';
import DialogFrame, { useDialogReveal } from './DialogFrame';
import {
  ASSIGNABLE_ROLES, aliasOnlyGrants, canAddAdminsIn, canManageUsers, manageableNetworks, currentNetworkRow, filterNetworkChoices, filterPickable, grantsEditable, grantsPayload,
  groupAgents, initialAccessMode, memberAccessSummary, selectAgents, selectionState, toggleAgents, memberActions, memberSavePlan, prefillOnRestrict, selectionFromGrants, setCanMessage, showsCanMessage, toggleAgent, validateNewUser,
  type AgentAccess, type AgentGrant, type AgentGroup, type AuthMe, type GroupBy, type MemberRole, type NetworkChoice, type NetworkMember, type PickableAgent,
} from './user-admin';
import { createHubUser, fetchAgentGrants, fetchNetworkMembers, fetchNetworks, removeNetworkMember, saveAgentGrants, updateMemberRole } from './user-admin-api';

const ROLE_KEY: Record<string, string> = { owner: 'users.role.owner', admin: 'users.role.admin', member: 'users.role.member', viewer: 'users.role.viewer' };
const roleLabel = (role: MemberRole) => (ROLE_KEY[role] ? tr(ROLE_KEY[role]) : String(role));

/** 手机:点成员 = 推三级页「成员」(SettingsScreen 的 detail 机制,顶栏返回 / 安卓返回键都走它)。 */
export type PhoneMemberNav = { memberOpen: boolean; openMember: () => void; closeMember: () => void };

export default function UserManagementPanel({ cfg, me, networkId, phone }: { cfg: HubConfig; me: AuthMe | null; networkId: string | undefined; phone?: PhoneMemberNav }) {
  useTranslation();
  const [members, setMembers] = useState<NetworkMember[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<NetworkMember | null>(null);
  const allowed = canManageUsers(me, networkId);
  const myId = me?.user?.user_id;
  // 新建用户能选的网络:Hub 管理员 = 全部网络;否则 = 我管的(owner / admin)。当前网络排第一、默认选中。
  const [allNetworks, setAllNetworks] = useState<Array<{ network_id: string; network_name?: string | null; name?: string | null }> | null>(null);
  useEffect(() => {
    if (!allowed || me?.user?.role !== 'admin') return;
    void fetchNetworks(cfg).then(setAllNetworks).catch(() => setAllNetworks(null));
  }, [cfg, allowed, me?.user?.role]);
  const networkChoices = useMemo(() => manageableNetworks(me, networkId, allNetworks), [me, networkId, allNetworks]);

  const load = useCallback(() => {
    if (!networkId || !allowed) return;
    setLoadError('');
    void fetchNetworkMembers(cfg, networkId).then(setMembers).catch(e => { setMembers(null); setLoadError(String((e as Error)?.message ?? e)); });
  }, [cfg, networkId, allowed]);
  useEffect(load, [load]);
  // 三级页被返回键关掉了 → 丢掉编辑中的成员;三级页开着却没有成员(状态丢了)→ 退回列表。
  const memberOpen = !!phone?.memberOpen;
  useEffect(() => { if (phone && !memberOpen && editing) setEditing(null); }, [phone, memberOpen, editing]);
  useEffect(() => { if (phone && memberOpen && !editing) phone.closeMember(); }, [phone, memberOpen, editing]);
  const openMember = (m: NetworkMember) => { setNotice(''); setEditing(m); phone?.openMember(); };
  const doneMember = (message: string) => { setEditing(null); if (phone?.memberOpen) phone.closeMember(); setNotice(message); load(); };

  if (!allowed || !networkId) return null;
  if (phone && memberOpen && editing) {
    return <MemberPage cfg={cfg} me={me} networkId={networkId} member={editing} onDone={doneMember} />;
  }
  return (
    <View testID="user-management">
      <SettingsGroup
        title={tr('users.members')}
        footer={loadError ? `${tr('users.loadFailed')}: ${loadError}` : notice || tr('users.footer')}
        footerTone={loadError ? 'danger' : notice ? 'accent' : 'muted'}
        testID="user-management-members"
      >
        {members === null && !loadError ? (
          <SettingsRow label={tr('users.loading')} busy testID="user-management-loading" />
        ) : null}
        {loadError ? <SettingsRow label={tr('users.retry')} tone="accent" onPress={load} testID="user-management-retry" /> : null}
        {(members ?? []).map(m => {
          const summary = memberAccessSummary(m);
          const value = summary.kind === 'all' ? tr('users.access.all') : summary.count ? tr('users.access.count', { count: summary.count }) : tr('users.access.none');
          const acts = memberActions(me, networkId, m);
          const editable = acts.editAccess || acts.editRole || acts.remove;
          return (
            <SettingsRow
              key={m.user_id}
              testID={`user-row-${m.username}`}
              label={`${m.display_name || m.username}${m.user_id === myId ? tr('users.you') : ''}`}
              subtitle={`${m.username} · ${roleLabel(m.role)}`}
              value={value}
              valueTone={summary.kind === 'count' && !summary.count ? 'danger' : 'muted'}
              onPress={editable ? () => openMember(m) : undefined}
            />
          );
        })}
      </SettingsGroup>
      <SettingsButton label={tr('users.newUser')} onPress={() => { setNotice(''); setCreating(true); }} testID="user-management-new" />
      {creating ? (
        <NewUserDialog
          cfg={cfg}
          me={me}
          networkId={networkId}
          networks={networkChoices.length ? networkChoices : [{ network_id: networkId, name: currentNetworkRow(me, networkId)?.network_name ?? networkId }]}
          onClose={() => setCreating(false)}
          onCreated={(name, net) => { setCreating(false); setNotice(net === networkId ? tr('users.created', { name }) : tr('users.createdElsewhere', { name, network: networkChoices.find(n => n.network_id === net)?.name ?? net })); load(); }}
        />
      ) : null}
      {editing && !phone ? (
        <MemberDialog
          cfg={cfg}
          me={me}
          networkId={networkId}
          member={editing}
          onClose={() => setEditing(null)}
          onDone={doneMember}
        />
      ) : null}
    </View>
  );
}

function Field({ label, hint, testID, ...input }: ComponentProps<typeof TextInput> & { label: string; hint?: string; testID: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}{hint ? <Text style={styles.fieldHint}>{`  ${hint}`}</Text> : null}</Text>
      <TextInput
        testID={testID}
        accessibilityLabel={label}
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
        {...input}
      />
    </View>
  );
}

function Actions({ onCancel, onConfirm, confirmLabel, disabled, busy, danger, left, testID }: { onCancel: () => void; onConfirm: () => void; confirmLabel: string; disabled?: boolean; busy?: boolean; danger?: boolean; left?: ReactNode; testID: string }) {
  return (
    <View style={styles.actions}>
      {left ? <View style={styles.actionsLeft}>{left}</View> : null}
      <Pressable accessibilityRole="button" onPress={onCancel} style={({ pressed }) => [styles.btn, styles.btnPlain, pressed && styles.pressed]} testID={`${testID}-cancel`}>
        <Text style={styles.btnPlainText}>{tr('users.cancel')}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!(disabled || busy) }} disabled={disabled || busy} onPress={onConfirm} style={({ pressed }) => [styles.btn, danger ? styles.btnDanger : styles.btnPrimary, (disabled || busy) && styles.disabled, pressed && styles.pressed]} testID={`${testID}-confirm`}>
        {busy ? <ActivityIndicator size="small" color={colors.onAccent} /> : null}
        <Text style={styles.btnPrimaryText}>{confirmLabel}</Text>
      </Pressable>
    </View>
  );
}

/**
 * 新建用户的「网络」:默认当前网络,收起时是一行(和输入框同高),点开是可搜索的单选清单(内部滚动,最多约 5 行高)。
 * Hub 管理员能往任何网络建人(26 个网络 = 一墙 chip 把「创建」挤出屏幕,Vincent 2026-09-30)—— 所以不再平铺。
 */
function NetworkPicker({ networks, value, onChange, fallbackName }: { networks: NetworkChoice[]; value: string; onChange: (id: string) => void; fallbackName: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const reveal = useDialogReveal();
  const current = networks.find(n => n.network_id === value);
  const shown = useMemo(() => filterNetworkChoices(networks, query), [networks, query]);
  if (networks.length <= 1) {
    return (
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>{tr('users.network')}</Text>
        <Text style={styles.readonly} numberOfLines={1} testID="new-user-network">{networks[0]?.name ?? fallbackName}</Text>
      </View>
    );
  }
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{tr('users.network')}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`${tr('users.network')} ${current?.name ?? value}`} accessibilityState={{ expanded: open }} onPress={() => { if (!open) reveal(); setOpen(o => !o); }} style={styles.picker} testID="new-user-network">
        <Text style={styles.pickerValue} numberOfLines={1} testID="new-user-network-value">{current?.name ?? value}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
      </Pressable>
      {open ? (
        <View style={styles.pickerPanel} testID="new-user-network-panel">
          <View style={styles.pickerSearch}>
            <Ionicons name="search-outline" size={15} color={colors.textMuted} />
            <TextInput value={query} onChangeText={setQuery} placeholder={tr('users.searchNetwork')} placeholderTextColor={colors.textMuted} accessibilityLabel={tr('users.searchNetwork')} autoCapitalize="none" autoCorrect={false} style={styles.searchInput} testID="new-user-network-search" />
          </View>
          <ScrollView style={styles.pickerList} nestedScrollEnabled keyboardShouldPersistTaps="handled" testID="new-user-network-list">
            {shown.length ? shown.map(n => {
              const on = n.network_id === value;
              return (
                <Pressable key={n.network_id} accessibilityRole="radio" accessibilityState={{ selected: on, checked: on }} aria-checked={on} onPress={() => { onChange(n.network_id); setOpen(false); setQuery(''); }} style={({ pressed }) => [styles.pickerRow, on && styles.pickerRowOn, pressed && styles.pressed]} testID={`new-user-network-${n.network_id}`}>
                  <Text style={styles.pickerRowText} numberOfLines={1}>{n.name}</Text>
                  {on ? <Ionicons name="checkmark" size={16} color={colors.accent} /> : null}
                </Pressable>
              );
            }) : <Text style={styles.empty}>{tr('users.noNetworkMatch')}</Text>}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

function NewUserDialog({ cfg, me, networkId, networks, onClose, onCreated }: {
  cfg: HubConfig; me: AuthMe | null; networkId: string; networks: NetworkChoice[]; onClose: () => void; onCreated: (name: string, networkId: string) => void;
}) {
  const [targetNet, setTargetNet] = useState(networkId);
  const canAddAdmins = canAddAdminsIn(me, targetNet);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<MemberRole>('member');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const problem = validateNewUser({ username, password });
  const touched = username.length > 0 || password.length > 0;
  const roles: MemberRole[] = canAddAdmins ? ['member', 'viewer', 'admin'] : ['member', 'viewer'];
  useEffect(() => { if (!canAddAdmins && role === 'admin') setRole('member'); }, [canAddAdmins, role]);
  const submit = () => {
    if (problem) return;
    setBusy(true); setError('');
    void createHubUser(cfg, { username: username.trim(), password, ...(displayName.trim() ? { display_name: displayName.trim() } : {}), network_id: targetNet, role })
      .then(() => onCreated(username.trim(), targetNet))
      .catch(e => setError(String((e as Error)?.message ?? e)))
      .finally(() => setBusy(false));
  };
  return (
    <DialogFrame
      title={tr('users.newUser')}
      closeLabel={tr('users.close')}
      onClose={onClose}
      testID="new-user-dialog"
      footer={<Actions onCancel={onClose} onConfirm={submit} confirmLabel={tr('users.create')} disabled={!!problem} busy={busy} testID="new-user" />}
    >
      <Field label={tr('users.username')} value={username} onChangeText={setUsername} testID="new-user-username" />
      <Field label={tr('users.password')} hint={tr('users.passwordHint')} value={password} onChangeText={setPassword} secureTextEntry testID="new-user-password" />
      <Field label={tr('users.displayName')} hint={tr('users.optional')} value={displayName} onChangeText={setDisplayName} testID="new-user-display-name" />
      <NetworkPicker networks={networks} value={targetNet} onChange={setTargetNet} fallbackName={networkId} />
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>{tr('users.role')}</Text>
        <View style={styles.segmented} accessibilityRole="radiogroup">
          {roles.map(r => (
            <Pressable key={r} accessibilityRole="radio" accessibilityState={{ selected: role === r, checked: role === r }} onPress={() => setRole(r)} style={[styles.segment, role === r && styles.segmentOn]} testID={`new-user-role-${r}`}>
              <Text style={[styles.segmentText, role === r && styles.segmentTextOn]} numberOfLines={1}>{roleLabel(r)}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      {error ? <Text style={styles.error} testID="new-user-error">{error}</Text> : touched && problem ? <Text style={styles.hint} testID="new-user-problem">{tr(`users.err.${problem}`)}</Text> : null}
    </DialogFrame>
  );
}

const GROUP_BYS: readonly GroupBy[] = ['none', 'host', 'runtime'];

/** 分组标题:机器名 / 类型名;空值是「未知机器 / 未知类型」。 */
function groupLabel(g: AgentGroup, by: GroupBy): string {
  if (g.label) return g.label;
  return by === 'host' ? tr('users.unknownHost') : tr('users.unknownRuntime');
}

function triChecked(sel: ReadonlyMap<string, boolean>, agents: readonly PickableAgent[]): boolean | 'mixed' {
  const st = selectionState(sel, agents);
  return st === 'all' ? true : st === 'some' ? 'mixed' : false;
}

/** 宽屏分组标题前的三态复选框:■✓ 全选 / ■— 部分 / □ 没选(和 Agent 行的复选框同尺寸同色)。 */
function TriCheck({ state }: { state: 'all' | 'some' | 'none' }) {
  if (state === 'none') return <Ionicons name="square-outline" size={20} color={colors.textMuted} />;
  return (
    <View style={styles.triOn}>
      <Ionicons name={state === 'all' ? 'checkmark' : 'remove'} size={14} color={colors.onAccent} />
    </View>
  );
}

/** 成员编辑的状态与保存/移出(宽屏弹窗与手机三级页共用;两端只换画法)。 */
function useMemberEditor(cfg: HubConfig, me: AuthMe | null, networkId: string, member: NetworkMember, onDone: (message: string) => void) {
  const acts = memberActions(me, networkId, member);
  const name = member.display_name || member.username;
  const [agents, setAgents] = useState<PickableAgent[] | null>(null);
  const [original, setOriginal] = useState<AgentGrant[]>([]);
  const [mode0, setMode0] = useState<AgentAccess>('granted');
  const [mode, setModeState] = useState<AgentAccess>('granted');
  const [selection, setSelection] = useState<Map<string, boolean>>(new Map());
  const [role, setRole] = useState<MemberRole>(member.role);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
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
        const m = initialAccessMode(grants.agent_access);
        setMode0(m); setModeState(m);
      })
      .catch(e => { if (live) { setAgents([]); setError(String((e as Error)?.message ?? e)); } });
    return () => { live = false; };
  }, [cfg, networkId, member.user_id, needGrants]);
  const before = useMemo(() => selectionFromGrants(original), [original]);
  const visible = useMemo(() => filterPickable(agents ?? [], query), [agents, query]);
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  const groups = useMemo<AgentGroup[] | null>(() => (groupBy === 'none' ? null : groupAgents(visible, groupBy)), [visible, groupBy]);
  const toggleGroup = (list: readonly PickableAgent[]) => setSelection(s => toggleAgents(s, list, role));
  const selectVisible = () => setSelection(s => selectAgents(s, visible, role));
  const clearAll = () => setSelection(new Map());
  const setMode = (next: AgentAccess) => {
    if (next === 'granted' && mode === 'all') setSelection(s => prefillOnRestrict(s, agents ?? [], role));
    setModeState(next);
  };
  const plan = memberSavePlan({ role: member.role, nextRole: role, mode: mode0, nextMode: mode, before, after: selection });
  const accessEditable = acts.editAccess && grantsEditable({ role });
  const save = () => {
    setBusy(true); setError('');
    void (async () => {
      if (plan.role) await updateMemberRole(cfg, networkId, member.user_id, role);
      if (plan.grants) await saveAgentGrants(cfg, networkId, member.user_id, grantsPayload(selection, aliasOnlyGrants(original), { mode, role }));
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
  return {
    acts, name, agents, visible, selection, setSelection, mode, setMode, role, setRole, query, setQuery,
    groupBy, setGroupBy, groups, toggleGroup, selectVisible, clearAll,
    busy, error, confirmRemove, setConfirmRemove, accessEditable, changed: plan.role || plan.grants, save, remove,
  };
}

/** 宽屏:居中弹窗。角色 / 范围用分段控件,清单可搜,「全部 Agent」时清单置灰不可点;「移出网络」在左下角,点了换成确认条。 */
function MemberDialog({ cfg, me, networkId, member, onClose, onDone }: { cfg: HubConfig; me: AuthMe | null; networkId: string; member: NetworkMember; onClose: () => void; onDone: (message: string) => void }) {
  const ed = useMemberEditor(cfg, me, networkId, member, onDone);
  const restricted = ed.mode === 'granted';
  const chat = showsCanMessage(ed.role);
  return (
    <DialogFrame
      title={`${tr('users.member')} · ${ed.name}`}
      closeLabel={tr('users.close')}
      onClose={onClose}
      scroll={false}
      testID="grants-dialog"
      footer={ed.confirmRemove ? (
        <View style={styles.confirmBox} testID="member-remove-box">
          <Text style={styles.confirmText}>{tr('users.removeConfirm', { name: ed.name })}</Text>
          <Actions onCancel={() => ed.setConfirmRemove(false)} onConfirm={ed.remove} confirmLabel={tr('users.removeYes')} danger busy={ed.busy} testID="member-remove" />
        </View>
      ) : (
        <Actions
          onCancel={onClose}
          onConfirm={ed.save}
          confirmLabel={tr('users.save')}
          disabled={!ed.changed}
          busy={ed.busy}
          testID="grants"
          left={ed.acts.remove ? (
            <Pressable accessibilityRole="button" onPress={() => ed.setConfirmRemove(true)} hitSlop={6} style={({ pressed }) => [styles.linkBtn, pressed && styles.pressed]} testID="member-remove-open">
              <Text style={styles.linkDanger}>{tr('users.remove')}</Text>
            </Pressable>
          ) : undefined}
        />
      )}
    >
      {ed.acts.editRole ? (
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>{tr('users.role')}</Text>
          <View style={styles.segmented} accessibilityRole="radiogroup" testID="member-role">
            {ASSIGNABLE_ROLES.map(r => (
              <Pressable key={r} accessibilityRole="radio" accessibilityState={{ selected: ed.role === r, checked: ed.role === r }} aria-checked={ed.role === r} onPress={() => ed.setRole(r)} style={[styles.segment, ed.role === r && styles.segmentOn]} testID={`member-role-${r}`}>
                <Text style={[styles.segmentText, ed.role === r && styles.segmentTextOn]} numberOfLines={1}>{roleLabel(r)}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
      {ed.accessEditable ? (
        <>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>{tr('users.access')}</Text>
            <View style={styles.segmented} accessibilityRole="radiogroup" testID="grants-mode">
              {(['all', 'granted'] as const).map(m => (
                <Pressable key={m} accessibilityRole="radio" accessibilityState={{ selected: ed.mode === m, checked: ed.mode === m }} aria-checked={ed.mode === m} onPress={() => ed.setMode(m)} style={[styles.segment, ed.mode === m && styles.segmentOn]} testID={`grants-mode-${m}`}>
                  <Text style={[styles.segmentText, ed.mode === m && styles.segmentTextOn]} numberOfLines={1}>{m === 'all' ? tr('users.access.all') : tr('users.access.granted')}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.hint} testID="grants-mode-hint">{restricted ? (chat ? tr('users.access.grantedHint') : tr('users.viewerHint')) : tr('users.access.allHint')}</Text>
          </View>
          <View style={[styles.field, styles.pickerArea, !restricted && styles.inactive]} pointerEvents={restricted ? 'auto' : 'none'} testID="grants-picker">
            <View style={styles.search}>
              <Ionicons name="search-outline" size={15} color={colors.textMuted} />
              <TextInput value={ed.query} onChangeText={ed.setQuery} editable={restricted} placeholder={tr('users.search')} placeholderTextColor={colors.textMuted} accessibilityLabel={tr('users.search')} autoCapitalize="none" autoCorrect={false} style={styles.searchInput} testID="grants-search" />
            </View>
            <View style={styles.toolbar} testID="grants-toolbar">
              <View style={[styles.segmented, styles.segmentedSmall]} accessibilityRole="radiogroup" testID="grants-group-by">
                {GROUP_BYS.map(g => (
                  <Pressable key={g} accessibilityRole="radio" accessibilityState={{ selected: ed.groupBy === g, checked: ed.groupBy === g }} aria-checked={ed.groupBy === g} onPress={() => ed.setGroupBy(g)} style={[styles.segment, styles.segmentSmall, ed.groupBy === g && styles.segmentOn]} testID={`grants-group-by-${g}`}>
                    <Text style={[styles.segmentTextSmall, ed.groupBy === g && styles.segmentTextOn]} numberOfLines={1} testID={`grants-group-by-${g}-text`}>{tr(`users.groupBy.${g}`)}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.toolbarLinks}>
                <Pressable accessibilityRole="button" onPress={ed.selectVisible} hitSlop={6} style={({ pressed }) => [styles.linkBtnSmall, pressed && styles.pressed]} testID="grants-select-visible">
                  <Text style={styles.link} numberOfLines={1}>{ed.query.trim() ? tr('users.selectResults') : tr('users.selectAll')}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={ed.clearAll} hitSlop={6} style={({ pressed }) => [styles.linkBtnSmall, pressed && styles.pressed]} testID="grants-clear">
                  <Text style={styles.link} numberOfLines={1}>{tr('users.clearAll')}</Text>
                </Pressable>
              </View>
            </View>
            <ScrollView style={styles.list} contentContainerStyle={styles.listContent} testID="grants-list">
              {ed.agents === null ? <ActivityIndicator style={{ marginVertical: spacing.lg }} color={colors.textMuted} /> : null}
              {ed.agents && !ed.visible.length ? <Text style={styles.empty}>{ed.agents.length ? tr('users.noMatch') : tr('users.noAgents')}</Text> : null}
              {(ed.groups ?? [{ key: '', label: null, agents: ed.visible }]).map(g => (
                <View key={`g-${g.key}`}>
                  {ed.groups ? (
                    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: triChecked(ed.selection, g.agents) }} aria-checked={triChecked(ed.selection, g.agents)} accessibilityLabel={groupLabel(g, ed.groupBy)} disabled={!restricted} onPress={() => ed.toggleGroup(g.agents)} style={({ pressed }) => [styles.groupHeader, pressed && styles.pressed]} testID={`grant-group-${g.key || 'unknown'}`}>
                      <TriCheck state={selectionState(ed.selection, g.agents)} />
                      <Text style={styles.groupName} numberOfLines={1}>{groupLabel(g, ed.groupBy)}</Text>
                      <Text style={styles.groupCount} testID={`grant-group-${g.key || 'unknown'}-count`}>{tr('users.groupCount', { on: g.agents.filter(a => ed.selection.has(a.node_id)).length, total: g.agents.length })}</Text>
                    </Pressable>
                  ) : null}
              {g.agents.map(a => {
                const on = ed.selection.has(a.node_id);
                return (
                  <View key={a.node_id} style={[styles.agentRow, ed.groups && styles.agentRowGrouped]} testID={`grant-row-${a.alias}`}>
                    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: on, disabled: !restricted }} aria-checked={on} disabled={!restricted} accessibilityLabel={a.alias} onPress={() => ed.setSelection(s => toggleAgent(s, a.node_id))} style={styles.agentPick} testID={`grant-toggle-${a.alias}`}>
                      <Ionicons name={on ? 'checkbox' : 'square-outline'} size={20} color={on ? colors.accent : colors.textMuted} />
                      <AliasAvatar alias={a.alias} size={28} />
                      <Text style={styles.agentName} numberOfLines={1}>{a.display_name || a.alias}</Text>
                    </Pressable>
                    {on && chat ? (
                      <View style={styles.canMessage}>
                        <Text style={styles.canMessageText}>{tr('users.canMessage')}</Text>
                        <Switch
                          accessibilityLabel={`${tr('users.canMessage')} ${a.alias}`}
                          value={ed.selection.get(a.node_id) === true}
                          disabled={!restricted}
                          onValueChange={v => ed.setSelection(s => setCanMessage(s, a.node_id, v))}
                          trackColor={{ true: colors.accent, false: colors.border }}
                          thumbColor={colors.card}
                          testID={`grant-can-message-${a.alias}`}
                        />
                      </View>
                    ) : on ? (
                      <Text style={styles.readOnlyTag} testID={`grant-read-only-${a.alias}`}>{tr('users.readOnly')}</Text>
                    ) : null}
                  </View>
                );
              })}
                </View>
              ))}
            </ScrollView>
            <Text style={styles.hint} testID="grants-count">{tr('users.selected', { count: ed.selection.size })}</Text>
            <Text style={styles.hint} testID="grants-one-time">{tr('users.oneTimeNote')}</Text>
          </View>
        </>
      ) : null}
      {ed.error ? <Text style={styles.error} testID="grants-error">{ed.error}</Text> : null}
    </DialogFrame>
  );
}

/** 手机:设置三级页「成员」,只用 settings-kit 的积木(微信式分组)。移出走底部确认单。 */
function MemberPage({ cfg, me, networkId, member, onDone }: { cfg: HubConfig; me: AuthMe | null; networkId: string; member: NetworkMember; onDone: (message: string) => void }) {
  const ed = useMemberEditor(cfg, me, networkId, member, onDone);
  const restricted = ed.mode === 'granted';
  const chat = showsCanMessage(ed.role);
  const picked = (ed.agents ?? []).filter(a => ed.selection.has(a.node_id)).sort((a, b) => a.alias.localeCompare(b.alias));
  return (
    <View testID="member-page">
      <SettingsGroup testID="member-page-head">
        <SettingsRow label={ed.name} subtitle={`${member.username} · ${roleLabel(member.role)}`} chevron={false} testID="member-page-identity" />
      </SettingsGroup>
      {ed.acts.editRole ? (
        <SettingsGroup title={tr('users.role')} testID="member-page-role">
          {ASSIGNABLE_ROLES.map(r => (
            <SettingsChoiceRow key={r} label={roleLabel(r)} selected={ed.role === r} onPress={() => ed.setRole(r)} testID={`member-role-${r}`} />
          ))}
        </SettingsGroup>
      ) : null}
      {ed.accessEditable ? (
        <SettingsGroup title={tr('users.access')} footer={restricted ? (chat ? tr('users.access.grantedHint') : tr('users.viewerHint')) : tr('users.access.allHint')} testID="member-page-mode">
          <SettingsChoiceRow label={tr('users.access.all')} selected={!restricted} onPress={() => ed.setMode('all')} testID="grants-mode-all" />
          <SettingsChoiceRow label={tr('users.access.granted')} selected={restricted} onPress={() => ed.setMode('granted')} testID="grants-mode-granted" />
        </SettingsGroup>
      ) : null}
      {ed.accessEditable && restricted ? (
        <>
          <SettingsGroup title={tr('users.groupBy')} testID="member-page-group-by">
            {GROUP_BYS.map(g => (
              <SettingsChoiceRow key={g} label={tr(`users.groupBy.${g}`)} selected={ed.groupBy === g} onPress={() => ed.setGroupBy(g)} testID={`grants-group-by-${g}`} />
            ))}
          </SettingsGroup>
          <SettingsGroup title={tr('users.agents')} footer={tr('users.oneTimeNote')} testID="member-page-agents">
            <SettingsTextField value={ed.query} onChangeText={ed.setQuery} placeholder={tr('users.search')} accessibilityLabel={tr('users.search')} testID="grants-search" />
            <SettingsRow label={ed.query.trim() ? tr('users.selectResults') : tr('users.selectAll')} tone="accent" chevron={false} onPress={ed.selectVisible} testID="grants-select-visible" />
            <SettingsRow label={tr('users.clearAll')} value={tr('users.selected', { count: ed.selection.size })} tone="accent" chevron={false} onPress={ed.clearAll} testID="grants-clear" />
            {ed.agents === null ? <SettingsRow label={tr('users.loading')} busy testID="member-page-loading" /> : null}
            {ed.agents && !ed.visible.length ? <SettingsRow label={ed.agents.length ? tr('users.noMatch') : tr('users.noAgents')} tone="muted" testID="member-page-empty" /> : null}
            {!ed.groups ? ed.visible.map(a => (
              <SettingsChoiceRow
                key={a.node_id}
                label={a.display_name || a.alias}
                subtitle={a.display_name ? a.alias : undefined}
                selected={ed.selection.has(a.node_id)}
                onPress={() => ed.setSelection(s => toggleAgent(s, a.node_id))}
                testID={`grant-toggle-${a.alias}`}
              />
            )) : null}
          </SettingsGroup>
          {(ed.groups ?? []).map(g => (
            <SettingsGroup key={`g-${g.key}`} title={groupLabel(g, ed.groupBy)} testID={`member-page-group-${g.key || 'unknown'}`}>
              <SettingsTriStateRow
                label={ed.groupBy === 'host' ? tr('users.selectHost') : tr('users.selectRuntime')}
                subtitle={tr('users.groupSelected', { on: g.agents.filter(a => ed.selection.has(a.node_id)).length, total: g.agents.length })}
                state={selectionState(ed.selection, g.agents)}
                onPress={() => ed.toggleGroup(g.agents)}
                testID={`grant-group-${g.key || 'unknown'}`}
              />
              {g.agents.map(a => (
                <SettingsChoiceRow
                  key={a.node_id}
                  label={a.display_name || a.alias}
                  subtitle={a.display_name ? a.alias : undefined}
                  selected={ed.selection.has(a.node_id)}
                  onPress={() => ed.setSelection(s => toggleAgent(s, a.node_id))}
                  testID={`grant-toggle-${a.alias}`}
                />
              ))}
            </SettingsGroup>
          ))}
        </>
      ) : null}
      {ed.accessEditable && restricted && chat && picked.length ? (
        <SettingsGroup title={tr('users.canMessageGroup')} footer={tr('users.canMessageFooter')} testID="member-page-chat">
          {picked.map(a => (
            <SettingsSwitchRow
              key={a.node_id}
              label={a.display_name || a.alias}
              value={ed.selection.get(a.node_id) === true}
              onValueChange={v => ed.setSelection(s => setCanMessage(s, a.node_id, v))}
              testID={`grant-can-message-${a.alias}`}
            />
          ))}
        </SettingsGroup>
      ) : null}
      {ed.error ? <SettingsGroup footer={ed.error} footerTone="danger" testID="grants-error" /> : null}
      <SettingsButton label={tr('users.save')} onPress={ed.save} disabled={!ed.changed} busy={ed.busy && !ed.confirmRemove} testID="grants-confirm" />
      {ed.acts.remove ? <SettingsButton label={tr('users.remove')} variant="destructive" onPress={() => ed.setConfirmRemove(true)} testID="member-remove-open" /> : null}
      {ed.confirmRemove ? <RemoveSheet name={ed.name} busy={ed.busy} onCancel={() => ed.setConfirmRemove(false)} onConfirm={ed.remove} /> : null}
    </View>
  );
}

/** 手机的底部确认单(微信「删除联系人」那种):说明 + 红字确认 + 取消。 */
function RemoveSheet({ name, busy, onCancel, onConfirm }: { name: string; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const safe = useModalSafePadding('fullScreen');
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable style={styles.sheetBackdrop} onPress={onCancel} testID="member-remove-backdrop">
        <Pressable style={[styles.sheet, { paddingBottom: Math.max(safe.paddingBottom ?? 0, spacing.sm) }]} onPress={() => {}} testID="member-remove-sheet">
          <Text style={styles.sheetText}>{tr('users.removeConfirm', { name })}</Text>
          <Pressable accessibilityRole="button" disabled={busy} onPress={onConfirm} style={({ pressed }) => [styles.sheetBtn, styles.sheetDivider, pressed && styles.pressed]} testID="member-remove-confirm">
            {busy ? <ActivityIndicator size="small" color={colors.failed} /> : <Text style={styles.sheetDanger}>{tr('users.removeYes')}</Text>}
          </Pressable>
          <View style={styles.sheetGap} />
          <Pressable accessibilityRole="button" onPress={onCancel} style={({ pressed }) => [styles.sheetBtn, pressed && styles.pressed]} testID="member-remove-cancel">
            <Text style={styles.sheetCancel}>{tr('users.cancel')}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = () => StyleSheet.create({
  field: { gap: 6 },
  fieldLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  fieldHint: { color: colors.textMuted, fontSize: 12, fontWeight: '400' },
  input: { minHeight: 42, paddingHorizontal: spacing.md, borderRadius: radius.control, backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.border, color: colors.text, fontSize: 14, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}) },
  picker: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.control, backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.border },
  pickerValue: { flex: 1, minWidth: 0, color: colors.text, fontSize: 14 },
  pickerPanel: { borderRadius: radius.control, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  pickerSearch: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 38, paddingHorizontal: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  pickerList: { maxHeight: 216, flexGrow: 0 },
  pickerRow: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md },
  pickerRowOn: { backgroundColor: colors.subtleFill },
  pickerRowText: { flex: 1, minWidth: 0, color: colors.text, fontSize: 14 },
  pickerArea: { flexShrink: 1, minHeight: 0 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  toolbarLinks: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginLeft: 'auto' },
  segmentedSmall: { flexShrink: 0 },
  segmentSmall: { flexGrow: 0, flexShrink: 0, flexBasis: 'auto', paddingHorizontal: spacing.md, paddingVertical: 6 },
  segmentTextSmall: { color: colors.textSecondary, fontSize: 12 },
  linkBtnSmall: { minHeight: 30, justifyContent: 'center' },
  link: { color: colors.accent, fontSize: 13 },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 36, paddingTop: spacing.sm },
  groupName: { flex: 1, minWidth: 0, color: colors.text, fontSize: 13, fontWeight: '600' },
  groupCount: { color: colors.textMuted, fontSize: 12 },
  agentRowGrouped: { paddingLeft: 28 },
  triOn: { width: 17, height: 17, marginHorizontal: 1.5, borderRadius: radius.mark, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  readonly: { color: colors.text, fontSize: 14, paddingVertical: 4 },
  segmented: { flexDirection: 'row', borderRadius: radius.control, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  segment: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 9 },
  segmentOn: { backgroundColor: colors.accent },
  segmentText: { color: colors.textSecondary, fontSize: 13 },
  segmentTextOn: { color: colors.onAccent, fontWeight: '600' },
  error: { color: colors.failed, fontSize: 12, lineHeight: 18 },
  hint: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: spacing.sm },
  actionsLeft: { marginRight: 'auto' },
  linkBtn: { minHeight: 38, justifyContent: 'center' },
  linkDanger: { color: colors.failed, fontSize: 14 },
  btnDanger: { backgroundColor: colors.failed },
  inactive: { opacity: 0.45 },
  readOnlyTag: { color: colors.textMuted, fontSize: 12 },
  confirmBox: { gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  confirmText: { color: colors.text, fontSize: 13, lineHeight: 19 },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: radius.surface, borderTopRightRadius: radius.surface, overflow: 'hidden' },
  sheetText: { color: colors.textMuted, fontSize: 13, lineHeight: 19, textAlign: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  sheetBtn: { minHeight: 56, alignItems: 'center', justifyContent: 'center' },
  sheetDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  sheetGap: { height: 8, backgroundColor: colors.bg },
  sheetCancel: { color: colors.text, fontSize: 16 },
  sheetDanger: { color: colors.failed, fontSize: 16, fontWeight: '600' },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 38, paddingHorizontal: spacing.lg, borderRadius: radius.control, justifyContent: 'center' },
  btnPlain: { borderWidth: 1, borderColor: colors.border },
  btnPlainText: { color: colors.text, fontSize: 14 },
  btnPrimary: { backgroundColor: colors.accent },
  btnPrimaryText: { color: colors.onAccent, fontSize: 14, fontWeight: '600' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.75 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 38, paddingHorizontal: spacing.md, borderRadius: radius.control, backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.border },
  searchInput: { flex: 1, minWidth: 0, color: colors.text, fontSize: 14, paddingVertical: 8, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}) },
  list: { maxHeight: 360, flexGrow: 0, flexShrink: 1 },
  listContent: { gap: 2 },
  empty: { color: colors.textMuted, fontSize: 13, textAlign: 'center', paddingVertical: spacing.lg },
  agentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48 },
  agentPick: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6 },
  agentName: { flex: 1, minWidth: 0, color: colors.text, fontSize: 14 },
  canMessage: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  canMessageText: { color: colors.textSecondary, fontSize: 12 },
});

let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
