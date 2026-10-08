// Agent 组织(看板 #766):设置 → 用户管理 →「Agent 组织」,在人的「组织架构」下面,两棵树互不相关。
// 桌面:左边团队树(最后一行「未分组」),右边选中团队的 Agent(负责的 Agent 标「负责」)、负责人、子团队;按钮在详情里,选择都是居中弹窗。
// 手机:全屏逐层点进(团队 → 子团队 / Agent),点 Agent 或「更多」弹底部面板,选择推整页 —— 和桌面是两套交互。
// 只画看的人能做的事(teamPerms);Hub 拒了照 agent-teams.ts 的一句人话说。旧 Hub 不走到这里(UserManagementPanel 只放一行提示)。
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from './i18n-react';
import { Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';
import AliasAvatar from './AliasAvatar';
import DialogFrame from './DialogFrame';
import ModalKeyboardAvoider from './ModalKeyboardAvoider';
import { colors, radius, spacing, type as typeScale, weight } from './theme';
import { useModalSafePadding } from './safe-area-runtime';
import { fetchHubNodes, type HubConfig } from './api';
import type { AuthMe, NetworkMember } from './user-admin';
import { SettingsGroup, SettingsRow } from './settings-kit';
import {
  HUB_MIN, childTeams, createTeam, deleteTeam, fetchAgentTeams, flattenTeams, patchTeam, setNodeTeam, teamNodeName, teamOfNode, teamPerms, unassigned,
  type AgentTeam, type TeamNode, type TeamPerms,
} from './agent-teams';

export const NONE = '__none';
type Props = { cfg: HubConfig; networkId: string; me: AuthMe | null | undefined; people: readonly NetworkMember[]; teams: AgentTeam[]; nodes: TeamNode[]; reload: () => void };

/** 团队 + 本网络 Agent。teams: undefined = 读取中,null = 旧 Hub。 */
export function useAgentTeams(cfg: HubConfig, networkId: string) {
  const [teams, setTeams] = useState<AgentTeam[] | null | undefined>(undefined);
  const [nodes, setNodes] = useState<TeamNode[]>([]);
  const [loadError, setLoadError] = useState(false);
  const request = useRef(0);
  const reload = useCallback(() => {
    const generation = ++request.current;
    // Same-scope refresh must keep the phone's current team page mounted.
    // Scope changes remount AgentTeamsScoped, which starts with no old data.
    setLoadError(false);
    void (async () => {
      try {
        const next = await fetchAgentTeams(cfg, networkId);
        const rows = next === null ? [] : (await fetchHubNodes({ ...cfg, networkId })).nodes ?? [];
        if (generation !== request.current) return;
        setNodes(rows.map(n => ({ node_id: n.node_id, alias: n.alias, display_name: n.node_name ?? null })));
        setTeams(next);
      } catch {
        if (generation !== request.current) return;
        setLoadError(true);
      }
    })();
  }, [cfg, networkId]);
  useEffect(() => { reload(); return () => { request.current++; }; }, [reload]);
  return { teams, nodes, reload, loadError };
}

// 弹窗(桌面)/ 推入页(手机)共用的几步
type Step =
  | { kind: 'name'; parent: string | null; team?: AgentTeam }
  | { kind: 'move'; team: AgentTeam }
  | { kind: 'assign'; node: TeamNode }
  | { kind: 'add'; team: AgentTeam }
  | { kind: 'lead'; team: AgentTeam }
  | { kind: 'owner'; team: AgentTeam }
  | { kind: 'delete'; team: AgentTeam };
const stepTitle = (s: Step) => ({ name: s.kind === 'name' && s.team ? '重命名团队' : '新建团队', move: '移动到…', assign: '分配到团队', add: '添加 Agent', lead: '负责的 Agent', owner: '团队负责人', delete: '删除团队' })[s.kind];

const nodeRef = (nodes: readonly TeamNode[], m: TeamNode) => nodes.find(n => n.node_id === m.node_id) ?? m;
function AgentLine({ n, lead, sub }: { n: TeamNode; lead?: boolean; sub?: string }) {
  return (
    <>
      <AliasAvatar alias={n.alias || teamNodeName(n)} size={36} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ color: colors.text, fontSize: typeScale.body, flexShrink: 1 }} numberOfLines={1}>{teamNodeName(n)}</Text>
          {lead ? <View style={{ paddingHorizontal: 6, height: 18, borderRadius: radius.pill, justifyContent: 'center', backgroundColor: colors.accent + '1f' }} testID="team-lead-badge"><Text style={{ color: colors.accent, fontSize: 11 }}>负责</Text></View> : null}
        </View>
        <Text style={{ color: colors.textMuted, fontSize: typeScale.small }} numberOfLines={1}>{sub ?? n.alias ?? n.node_id}</Text>
      </View>
    </>
  );
}
function Choice({ label, depth = 0, on, onPress, testID, children }: { label?: string; depth?: number; on?: boolean; onPress: () => void; testID: string; children?: ReactNode }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} testID={testID}
      style={state => [{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingLeft: spacing.lg + depth * 18, paddingRight: spacing.lg }, ((state as { hovered?: boolean }).hovered || state.pressed) ? { backgroundColor: colors.rowHover } : null]}>
      {children ?? <Text style={{ flex: 1, color: colors.text, fontSize: typeScale.body }} numberOfLines={1}>{label}</Text>}
      {on ? <Ionicons name="checkmark" size={18} color={colors.accent} /> : null}
    </Pressable>
  );
}

/** 一步的内容 + 提交。done() 在 Hub 接受后调。 */
function StepBody({ step, p, perms, run }: { step: Step; p: Props; perms: TeamPerms; run: (fn: () => Promise<unknown>) => void }) {
  const { cfg, networkId: net, teams, nodes, people } = p;
  const [name, setName] = useState(step.kind === 'name' ? step.team?.name ?? '' : '');
  if (step.kind === 'name') {
    const submit = () => { const v = name.trim(); if (v) run(() => (step.team ? patchTeam(cfg, net, step.team.id, { name: v }) : createTeam(cfg, net, v, step.parent))); };
    return (
      <View style={{ padding: spacing.lg, gap: spacing.md }}>
        <TextInput value={name} onChangeText={setName} onSubmitEditing={submit} autoFocus placeholder="团队名称" placeholderTextColor={colors.textMuted} accessibilityLabel="团队名称" testID="team-name-input"
          style={{ height: 40, paddingHorizontal: spacing.md, borderRadius: radius.control, backgroundColor: colors.inputBg, color: colors.text, fontSize: typeScale.body, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : null) } as object} />
        <Pressable accessibilityRole="button" disabled={!name.trim()} onPress={submit} testID="team-name-done"
          style={{ height: 40, borderRadius: radius.control, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', opacity: name.trim() ? 1 : 0.45 }}>
          <Text style={{ color: colors.onAccent, fontSize: typeScale.body, fontWeight: weight.medium }}>完成</Text>
        </Pressable>
      </View>
    );
  }
  if (step.kind === 'delete') {
    return (
      <View style={{ padding: spacing.lg, gap: spacing.md }}>
        <Text style={{ color: colors.text }}>删除「{step.team.name}」?里面的 {step.team.members.length} 个 Agent 会回到未分组。</Text>
        <Pressable accessibilityRole="button" onPress={() => run(() => deleteTeam(cfg, net, step.team.id))} testID="team-delete-confirm"
          style={{ height: 40, borderRadius: radius.control, backgroundColor: colors.failed, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#fff', fontSize: typeScale.body, fontWeight: weight.medium }}>删除</Text>
        </Pressable>
      </View>
    );
  }
  if (step.kind === 'move' || step.kind === 'assign') {
    const current = step.kind === 'move' ? step.team.parent_id : teamOfNode(teams, step.node.node_id);
    const tgt = step.kind === 'move' ? perms.moveTargets(step.team.id) : null;
    const ok = (id: string | null) => (tgt ? (id === null ? tgt.root : tgt.allowed.has(id)) && id !== current : perms.canAssign(id, current));
    const pick = (id: string | null) => run(() => (step.kind === 'move' ? patchTeam(cfg, net, step.team.id, { parent_id: id }) : setNodeTeam(cfg, net, step.node.node_id, id)));
    return (
      <View testID="team-pick">
        {ok(null) ? <Choice label={step.kind === 'move' ? '顶层' : '未分组'} onPress={() => pick(null)} testID="team-pick-root" /> : null}
        {flattenTeams(teams).map(({ team, depth }) => ok(team.id) ? <Choice key={team.id} label={team.name} depth={depth} onPress={() => pick(team.id)} testID={`team-pick-${team.id}`} /> : null)}
      </View>
    );
  }
  if (step.kind === 'add') {
    const t = step.team;
    const shown = nodes.filter(n => perms.canAssign(t.id, teamOfNode(teams, n.node_id)));
    return (
      <View testID="team-pick-agent">
        {shown.map(n => { const where = teams.find(x => x.id === teamOfNode(teams, n.node_id)); return <Choice key={n.node_id} onPress={() => run(() => setNodeTeam(cfg, net, n.node_id, t.id))} testID={`team-add-${n.node_id}`}><AgentLine n={n} sub={where ? `在「${where.name}」` : '未分组'} /></Choice>; })}
        {!shown.length ? <Text style={{ color: colors.textMuted, padding: spacing.lg }}>没有可添加的 Agent</Text> : null}
      </View>
    );
  }
  const t = step.team;
  if (step.kind === 'lead') {
    return (
      <View testID="team-pick-lead">
        {t.lead ? <Choice label="不设负责的 Agent" onPress={() => run(() => patchTeam(cfg, net, t.id, { lead_node_id: null }))} testID="team-lead-clear" /> : null}
        {t.members.map(m => <Choice key={m.node_id} on={t.lead?.node_id === m.node_id} onPress={() => run(() => patchTeam(cfg, net, t.id, { lead_node_id: m.node_id }))} testID={`team-lead-${m.node_id}`}><AgentLine n={nodeRef(nodes, m)} /></Choice>)}
        {!t.members.length ? <Text style={{ color: colors.textMuted, padding: spacing.lg }}>先给团队添加 Agent</Text> : null}
      </View>
    );
  }
  return (
    <View testID="team-pick-owner">
      {t.owner ? <Choice label="不设负责人" onPress={() => run(() => patchTeam(cfg, net, t.id, { owner_user_id: null }))} testID="team-owner-clear" /> : null}
      {people.map(u => <Choice key={u.user_id} label={u.display_name || u.username} on={t.owner?.user_id === u.user_id} onPress={() => run(() => patchTeam(cfg, net, t.id, { owner_user_id: u.user_id }))} testID={`team-owner-${u.username}`} />)}
    </View>
  );
}

const ownerName = (p: Props, t: AgentTeam) => (t.owner ? t.owner.display_name || p.people.find(u => u.user_id === t.owner!.user_id)?.username || '' : '');
function useRunner(reload: () => void, close: () => void) {
  const [error, setError] = useState('');
  const run = (fn: () => Promise<unknown>, after = true) => { setError(''); fn().then(() => { reload(); if (after) close(); }, e => setError(e instanceof Error ? e.message : String(e))); };
  return { error, setError, run };
}

// ── 桌面 ──
export function AgentTeamsDesktop(p: Props) {
  const perms = useMemo(() => teamPerms(p.teams, p.me, p.networkId), [p.teams, p.me, p.networkId]);
  const [sel, setSel] = useState<string>(() => childTeams(p.teams, null)[0]?.id ?? NONE);
  const [step, setStep] = useState<Step | null>(null);
  const { error, setError, run } = useRunner(p.reload, () => setStep(null));
  const open = (s: Step) => { setError(''); setStep(s); };
  const team = p.teams.find(t => t.id === sel);
  useEffect(() => { if (sel !== NONE && !team) setSel(NONE); }, [sel, team]);
  const kids = team ? childTeams(p.teams, team.id) : [];
  const list = team ? team.members.map(m => nodeRef(p.nodes, m)) : unassigned(p.teams, p.nodes);
  const btn = (label: string, onPress: () => void, testID: string, tone: 'plain' | 'accent' | 'danger' = 'plain', disabled?: boolean) => (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress} testID={testID}
      style={state => [{ height: 30, paddingHorizontal: spacing.md, borderRadius: radius.control, borderWidth: tone === 'accent' ? 0 : 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.45 : 1 }, ((state as { hovered?: boolean }).hovered || state.pressed) ? { backgroundColor: colors.rowHover } : null]}>
      <Text style={{ color: tone === 'danger' ? colors.failed : tone === 'accent' ? colors.accent : colors.text, fontSize: typeScale.small }}>{label}</Text>
    </Pressable>
  );
  const treeRow = (id: string, name: string, depth: number, count: number) => (
    <Pressable key={id} accessibilityRole="button" accessibilityState={{ selected: sel === id }} onPress={() => setSel(id)} testID={`team-tree-${id}`}
      style={state => [{ height: 34, flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: spacing.sm + depth * 16, paddingRight: spacing.sm, borderRadius: radius.control }, sel === id ? { backgroundColor: colors.accent + '1f' } : ((state as { hovered?: boolean }).hovered ? { backgroundColor: colors.rowHover } : null)]}>
      <Ionicons name={id === NONE ? 'albums-outline' : 'git-network-outline'} size={14} color={sel === id ? colors.accent : colors.textMuted} />
      <Text style={{ flex: 1, color: sel === id ? colors.accent : colors.text, fontSize: typeScale.small }} numberOfLines={1}>{name}</Text>
      <Text style={{ color: colors.textMuted, fontSize: 11 }}>{count}</Text>
    </Pressable>
  );
  const label = (text: string) => <Text style={{ flex: 1, color: colors.textSecondary, fontSize: typeScale.small, fontWeight: weight.medium }}>{text}</Text>;
  return (
    <View style={{ flexDirection: 'row', minHeight: 440 }} testID="team-desktop">
      <View style={{ width: 240, borderRightWidth: 1, borderRightColor: colors.border }} testID="team-tree">
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: spacing.xs }}>
          {flattenTeams(p.teams).map(r => treeRow(r.team.id, r.team.name, r.depth, r.team.members.length))}
          {treeRow(NONE, '未分组', 0, unassigned(p.teams, p.nodes).length)}
        </ScrollView>
        {perms.canCreateRoot ? <View style={{ flexDirection: 'row', padding: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }}>{btn('+ 新建团队', () => open({ kind: 'name', parent: null }), 'team-new-root', 'accent')}</View> : null}
      </View>
      <ScrollView style={{ flex: 1, minWidth: 0 }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }} testID="team-detail">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Text style={{ flex: 1, color: colors.text, fontSize: typeScale.title, fontWeight: weight.strong }} numberOfLines={1} testID="team-detail-name">{team ? team.name : '未分组的 Agent'}</Text>
          {team && perms.canEdit(team.id) ? btn('重命名', () => open({ kind: 'name', parent: team.parent_id, team }), 'team-rename') : null}
          {team && perms.canRelocate(team.id) ? <>{btn('移动到…', () => open({ kind: 'move', team }), 'team-move')}{btn('删除', () => open({ kind: 'delete', team }), 'team-delete', 'danger', kids.length > 0)}</> : null}
        </View>
        {error && !step ? <Text style={{ color: colors.failed }} accessibilityRole="alert" testID="team-error">{error}</Text> : null}
        {team && kids.length && perms.canRelocate(team.id) ? <Text style={{ color: colors.textMuted, fontSize: 11 }} testID="team-delete-reason">有 {kids.length} 个子团队,先删掉或移走才能删除</Text> : null}
        {team ? (
          <View style={{ flexDirection: 'row', gap: spacing.lg }} testID="team-heads">
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>{label(`负责人 · ${ownerName(p, team) || '未设置'}`)}{perms.canRelocate(team.id) ? btn('设置', () => open({ kind: 'owner', team }), 'team-owner-set') : null}</View>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>{label(`负责的 Agent · ${team.lead ? teamNodeName(team.lead) : '未设置'}`)}{perms.canEdit(team.id) ? btn('设置', () => open({ kind: 'lead', team }), 'team-lead-set') : null}</View>
          </View>
        ) : null}
        {team ? (
          <View style={{ gap: spacing.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>{label(`子团队 ${kids.length}`)}{perms.canEdit(team.id) ? btn('+ 新建子团队', () => open({ kind: 'name', parent: team.id }), 'team-new-child', 'accent') : null}</View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>{kids.map(k => <Pressable key={k.id} onPress={() => setSel(k.id)} testID={`team-child-${k.id}`} style={{ minWidth: 160, padding: spacing.md, borderRadius: radius.control, borderWidth: 1, borderColor: colors.border }}><Text style={{ color: colors.text }} numberOfLines={1}>{k.name}</Text><Text style={{ color: colors.textMuted, fontSize: 11 }}>{k.members.length} 个 Agent</Text></Pressable>)}</View>
          </View>
        ) : null}
        <View style={{ gap: spacing.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>{label(`Agent ${list.length}`)}{team && perms.canEdit(team.id) ? btn('+ 添加 Agent', () => open({ kind: 'add', team }), 'team-add-agent', 'accent') : null}</View>
          <View style={{ borderTopWidth: 1, borderTopColor: colors.border }} testID="team-agents">
            {list.map(n => (
              <View key={n.node_id} style={{ minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }} testID={`team-agent-${n.node_id}`}>
                <AgentLine n={n} lead={team?.lead?.node_id === n.node_id} />
                {!team && p.teams.some(t => perms.canAssign(t.id, null)) ? btn('分配到…', () => open({ kind: 'assign', node: n }), `team-assign-${n.node_id}`) : null}
                {team && perms.canAssign(null, team.id) ? btn('移出', () => run(() => setNodeTeam(p.cfg, p.networkId, n.node_id, null)), `team-remove-${n.node_id}`, 'danger') : null}
              </View>
            ))}
            {!list.length ? <Text style={{ color: colors.textMuted, paddingVertical: spacing.md }}>没有 Agent</Text> : null}
          </View>
        </View>
      </ScrollView>
      {step ? (
        <DialogFrame title={stepTitle(step)} closeLabel="关闭" onClose={() => setStep(null)} testID="team-dialog">
          <StepBody key={`${step.kind}:${'team' in step && step.team ? step.team.id : ''}`} step={step} p={p} perms={perms} run={run} />
          {error ? <Text style={{ color: colors.failed, padding: spacing.md }} accessibilityRole="alert" testID="team-error">{error}</Text> : null}
        </DialogFrame>
      ) : null}
    </View>
  );
}

// ── 手机 ──
type Sheet = { title: string; items: Array<{ label: string; onPress: () => void; danger?: boolean; testID: string }> };
export function AgentTeamsPhone(p: Props & { onClose: () => void }) {
  const safe = useModalSafePadding('fullScreen');
  const perms = useMemo(() => teamPerms(p.teams, p.me, p.networkId), [p.teams, p.me, p.networkId]);
  const [stack, setStack] = useState<Array<{ at: string | null } | Step>>([{ at: null }]);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const top = stack[stack.length - 1];
  const push = (v: { at: string | null } | Step) => { setSheet(null); setError(''); setStack(s => [...s, v]); };
  const pop = () => { setError(''); if (stack.length <= 1) p.onClose(); else setStack(s => s.slice(0, -1)); };
  const { error, setError, run } = useRunner(p.reload, () => setStack(s => s.slice(0, -1)));
  const at = 'at' in top ? top.at : null;
  const team = p.teams.find(t => t.id === at);
  useEffect(() => { if (at && at !== NONE && !team) setStack([{ at: null }]); }, [at, team]);
  const item = (label: string, onPress: () => void, testID: string, danger?: boolean) => ({ label, onPress, testID, danger });
  const agentSheet = (n: TeamNode) => {
    const cur = teamOfNode(p.teams, n.node_id);
    const items = [
      ...(team && perms.canEdit(team.id) && team.lead?.node_id !== n.node_id ? [item('设为负责的 Agent', () => { setSheet(null); run(() => patchTeam(p.cfg, p.networkId, team.id, { lead_node_id: n.node_id }), false); }, 'team-sheet-lead')] : []),
      ...(p.teams.some(t => perms.canAssign(t.id, cur)) ? [item(cur ? '调到其他团队…' : '分配到团队…', () => push({ kind: 'assign', node: n }), 'team-sheet-assign')] : []),
      ...(cur && perms.canAssign(null, cur) ? [item('移出团队', () => { setSheet(null); run(() => setNodeTeam(p.cfg, p.networkId, n.node_id, null), false); }, 'team-sheet-remove', true)] : []),
    ];
    if (items.length) setSheet({ title: teamNodeName(n), items });
  };
  const moreSheet = (t: AgentTeam) => setSheet({ title: t.name, items: [
    ...(perms.canEdit(t.id) ? [item('新建子团队', () => push({ kind: 'name', parent: t.id }), 'team-sheet-child'), item('重命名', () => push({ kind: 'name', parent: t.parent_id, team: t }), 'team-sheet-rename'), item('添加 Agent', () => push({ kind: 'add', team: t }), 'team-sheet-add')] : []),
    ...(perms.canRelocate(t.id) ? [item('团队负责人…', () => push({ kind: 'owner', team: t }), 'team-sheet-owner'), item('移动到…', () => push({ kind: 'move', team: t }), 'team-sheet-move')] : []),
    ...(perms.canRelocate(t.id) && !childTeams(p.teams, t.id).length ? [item('删除团队', () => push({ kind: 'delete', team: t }), 'team-sheet-delete', true)] : []),
  ] });
  const row = (key: string, children: ReactNode, onPress: (() => void) | undefined, testID: string) => (
    <Pressable key={key} accessibilityRole={onPress ? 'button' : undefined} onPress={onPress} testID={testID}
      style={state => [{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border }, state.pressed && onPress ? { backgroundColor: colors.rowHover } : null]}>
      {children}
    </Pressable>
  );
  const chevron = <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />;
  const title = 'kind' in top ? stepTitle(top) : team ? team.name : at === NONE ? '未分组' : 'Agent 组织';
  const kids = childTeams(p.teams, at === NONE ? '\u0000' : at);
  const agents = team ? team.members.map(m => nodeRef(p.nodes, m)) : at === NONE ? unassigned(p.teams, p.nodes) : [];
  const actions = team ? (perms.canEdit(team.id) || perms.canRelocate(team.id)) : at === null && perms.canCreateRoot;
  return (
    <Modal visible animationType="slide" onRequestClose={pop} presentationStyle="fullScreen">
      <ModalKeyboardAvoider scrim={colors.groupedBg ?? colors.bg}>
        <View style={{ flex: 1, paddingTop: safe.paddingTop, paddingLeft: safe.paddingLeft, paddingRight: safe.paddingRight, backgroundColor: colors.groupedBg ?? colors.bg }} testID="team-phone">
          <View style={{ height: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, backgroundColor: colors.card }}>
            <Pressable accessibilityRole="button" accessibilityLabel="返回" onPress={pop} hitSlop={8} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }} testID="team-back"><Ionicons name="chevron-back" size={24} color={colors.text} /></Pressable>
            <Text style={{ flex: 1, textAlign: 'center', color: colors.text, fontSize: 17, fontWeight: weight.strong }} numberOfLines={1} testID="team-phone-title">{title}</Text>
            <View style={{ width: 44 }} />
          </View>
          {error ? <Text style={{ color: colors.failed, padding: spacing.lg, backgroundColor: colors.card }} accessibilityRole="alert" testID="team-error">{error}</Text> : null}
          <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
            {'kind' in top ? <View style={{ backgroundColor: colors.card }}><StepBody key={stack.length} step={top} p={p} perms={perms} run={run} /></View> : (
              <>
                {team ? <Text style={{ color: colors.textMuted, fontSize: typeScale.small, padding: spacing.lg }} testID="team-phone-heads">负责人 {ownerName(p, team) || '未设置'} · 负责的 Agent {team.lead ? teamNodeName(team.lead) : '未设置'}</Text> : <View style={{ height: spacing.lg }} />}
                {kids.map(k => row(k.id, <><Ionicons name="git-network-outline" size={20} color={colors.textMuted} /><Text style={{ flex: 1, color: colors.text, fontSize: typeScale.body }} numberOfLines={1}>{k.name}</Text><Text style={{ color: colors.textMuted }}>{k.members.length}</Text>{chevron}</>, () => push({ at: k.id }), `team-row-${k.id}`))}
                {at === null ? row(NONE, <><Ionicons name="albums-outline" size={20} color={colors.textMuted} /><Text style={{ flex: 1, color: colors.text, fontSize: typeScale.body }}>未分组</Text><Text style={{ color: colors.textMuted }}>{unassigned(p.teams, p.nodes).length}</Text>{chevron}</>, () => push({ at: NONE }), 'team-row-none') : null}
                {agents.map(n => row(n.node_id, <AgentLine n={n} lead={team?.lead?.node_id === n.node_id} />, () => agentSheet(n), `team-agent-${n.node_id}`))}
                {!kids.length && !agents.length && at !== null ? <Text style={{ color: colors.textMuted, padding: spacing.lg }}>这里还没有 Agent</Text> : null}
              </>
            )}
          </ScrollView>
          {!('kind' in top) && actions ? (
            <Pressable accessibilityRole="button" onPress={() => (team ? moreSheet(team) : push({ kind: 'name', parent: null }))} testID="team-phone-action"
              style={{ height: 52 + safe.paddingBottom, paddingBottom: safe.paddingBottom, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border }}>
              <Text style={{ color: colors.accent, fontSize: typeScale.body }}>{team ? '管理团队' : '新建团队'}</Text>
            </Pressable>
          ) : null}
        </View>
      </ModalKeyboardAvoider>
      {sheet ? (
        <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, justifyContent: 'flex-end' }} testID="team-sheet">
          <Pressable style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)' }} onPress={() => setSheet(null)} accessibilityLabel="关闭" testID="team-sheet-scrim" />
          <View style={{ backgroundColor: colors.card, borderTopLeftRadius: radius.surface, borderTopRightRadius: radius.surface, paddingBottom: safe.paddingBottom }}>
            <Text style={{ color: colors.textMuted, fontSize: typeScale.small, textAlign: 'center', paddingVertical: spacing.md }} numberOfLines={1}>{sheet.title}</Text>
            {sheet.items.map(it => (
              <Pressable key={it.testID} accessibilityRole="button" onPress={it.onPress} testID={it.testID} style={state => [{ minHeight: 52, alignItems: 'center', justifyContent: 'center', borderTopWidth: 1, borderTopColor: colors.border }, state.pressed ? { backgroundColor: colors.rowHover } : null]}>
                <Text style={{ color: it.danger ? colors.failed : colors.text, fontSize: typeScale.body }}>{it.label}</Text>
              </Pressable>
            ))}
            <View style={{ height: 8, backgroundColor: colors.bg }} />
            <Pressable accessibilityRole="button" onPress={() => setSheet(null)} style={{ minHeight: 52, alignItems: 'center', justifyContent: 'center' }} testID="team-sheet-cancel"><Text style={{ color: colors.text, fontSize: typeScale.body }}>取消</Text></Pressable>
          </View>
        </View>
      ) : null}
    </Modal>
  );
}

/** 设置 → 用户管理里的一组:旧 Hub 只有一行提示;桌面就地画左树右详情,手机一行点进全屏页。 */
export function AgentTeamsSection({ cfg, networkId, me, people, phone }: Omit<Props, 'teams' | 'nodes' | 'reload'> & { phone: boolean }) {
  // Remount editors too: an open dialog must not submit the old team's ID to a new scope.
  return <AgentTeamsScoped key={JSON.stringify([cfg.serverUrl, cfg.token, networkId])} cfg={cfg} networkId={networkId} me={me} people={people} phone={phone} />;
}
function AgentTeamsScoped({ cfg, networkId, me, people, phone }: Omit<Props, 'teams' | 'nodes' | 'reload'> & { phone: boolean }) {
  const { t } = useTranslation();
  const { teams, nodes, reload, loadError } = useAgentTeams(cfg, networkId);
  const [open, setOpen] = useState(false);
  if (loadError) return <SettingsGroup title={t('teams.title')} testID="team-load-error"><SettingsRow label={t('teams.loadFailed')} value={t('teams.retry')} onPress={reload} testID="team-load-retry" /></SettingsGroup>;
  if (teams === undefined) return null;
  return (
    <SettingsGroup title="Agent 组织" footer={teams ? 'Agent 自己的组织树,和人的部门互不影响;一个 Agent 最多归一个团队。' : undefined} separators={false} testID="team-group">
      {teams === null ? <SettingsRow label={`需要 Hub ≥ ${HUB_MIN}`} testID="team-old-hub" /> : phone ? (
        <SettingsRow label="Agent 团队" value={`${teams.length} 个团队`} onPress={() => setOpen(true)} testID="team-open" />
      ) : <AgentTeamsDesktop cfg={cfg} networkId={networkId} me={me} people={people} teams={teams} nodes={nodes} reload={reload} />}
      {open && teams ? <AgentTeamsPhone cfg={cfg} networkId={networkId} me={me} people={people} teams={teams} nodes={nodes} reload={reload} onClose={() => setOpen(false)} /> : null}
    </SettingsGroup>
  );
}
