// 组织架构(board #419 v1):成员与部门。
//
// 手机:照 Vincent 2026-10-02 发的企业微信截图做 —— 全屏页,顶栏「‹ 成员与部门 ×」、搜索框、当前层级的名字、
// 子部门一行一个(›点进去)、本部门成员(头像 + 名字)、底部一条「添加成员 | 添加子部门 | 更多」;
// 「添加子部门」是一页表单:部门名称* / 上级部门(默认当前部门)/ 部门 ID(可不填,自动生成)/ 部门负责人。
// 部门群(RFC-042,Hub ≥ .93):手机部门页底下一行「部门群 ›」推入整页,桌面在部门详情里一张卡片(DeptGroupPanel.tsx);
// 旧 Hub 没有群接口 → 两处都不出现。点成员 → 底部面板:调动到其他部门… / 设为负责人 / 移出部门。
// 桌面:左边部门树、右边部门详情(负责人 · 子部门 · 直属成员),按钮在详情里,改名 / 新建 / 选人都是居中弹窗。
// 数据和规则都在 Hub(departments.ts);这里只调接口,失败照 Hub 的原因说(org-api.ts orgErrorText)。
// 负责人模式(RFC-040,传 head):同一套页面,但只在本部门子树里能动 —— 按钮按 orgPerms(Hub 的 viewer_can)出现,
// Hub 会拒的操作不画;部门选择器里本部门以外的灰掉;手机先进本部门,桌面多「任务 / Agent」两个页签。
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';
import AliasAvatar from './AliasAvatar';
import DialogFrame from './DialogFrame';
import ModalKeyboardAvoider from './ModalKeyboardAvoider';
import { colors, radius, spacing, type as typeScale, weight } from './theme';
import { useModalSafePadding } from './safe-area-runtime';
import type { HubConfig } from './api';
import { DeptGroupSection, useGroupSupport } from './DeptGroupPanel';
import { canManageDeptGroup } from './group-chat';
import { createDepartment, deleteDepartment, setMemberDepartment, updateDepartment, type DepartmentInput } from './org-api';
import {
  childrenOf, deleteBlocker, departmentOf, flattenTree, managedRoots, membersIn, orgPerms, pathTo, personName, searchOrg, subtreeIds, totalMembers,
  type DeptKey, type Department, type OrgData, type OrgPerson,
} from './org-model';

/** 负责人模式:我负责的部门(含下级,来自 /api/auth/me),以及「本部门任务 / 本部门 Agent」两页画什么。 */
export type OrgHeadMode = { managed: ReadonlySet<string>; renderTasks: (deptId: string) => ReactNode; renderAgents: (deptId: string) => ReactNode };
type Common = { cfg: HubConfig; networkId: string; networkName: string; org: OrgData; people: readonly OrgPerson[]; onChanged: () => void; head?: OrgHeadMode };
const union = (a: ReadonlySet<string> | undefined, b: ReadonlySet<string> | undefined): Set<string> | undefined => (a || b ? new Set([...(a ?? []), ...(b ?? [])]) : undefined);

const deptName = (org: OrgData, id: DeptKey, networkName: string) => (id ? org.departments.find(d => d.id === id)?.name ?? '' : networkName);
const leaderName = (org: OrgData, dept: Department | undefined, people: readonly OrgPerson[]) => {
  const p = dept?.leader_user_id ? people.find(x => x.user_id === dept.leader_user_id) : undefined;
  return p ? personName(p) : '';
};

// ── 共用小件 ─────────────────────────────────────────────────────────────

function Row({ children, onPress, testID, accessibilityLabel }: { children: ReactNode; onPress?: () => void; testID: string; accessibilityLabel?: string }) {
  return (
    <Pressable accessibilityRole={onPress ? 'button' : undefined} accessibilityLabel={accessibilityLabel} onPress={onPress} testID={testID}
      style={state => [{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, backgroundColor: colors.card }, ((state as { hovered?: boolean }).hovered || state.pressed) && onPress ? { backgroundColor: colors.rowHover } : null]}>
      {children}
    </Pressable>
  );
}
const Sep = ({ inset = spacing.lg }: { inset?: number }) => <View style={{ height: 1, marginLeft: inset, backgroundColor: colors.border }} />;

function LeaderBadge() {
  return <View style={{ paddingHorizontal: 6, height: 18, borderRadius: radius.pill, justifyContent: 'center', backgroundColor: colors.accent + '1f' }}><Text style={{ color: colors.accent, fontSize: 11 }}>负责人</Text></View>;
}

function PersonLine({ person, leader, subtitle }: { person: OrgPerson; leader?: boolean; subtitle?: string }) {
  return (
    <>
      <AliasAvatar alias={personName(person)} size={36} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ color: colors.text, fontSize: typeScale.body, flexShrink: 1 }} numberOfLines={1}>{personName(person)}</Text>
          {leader ? <LeaderBadge /> : null}
        </View>
        {subtitle ? <Text style={{ color: colors.textMuted, fontSize: typeScale.small }} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
    </>
  );
}

/** 部门选择:根(网络)+ 整棵树缩进;disabled 里的不能选(移动时:自己和下级)。 */
function DeptPickList({ org, networkName, value, disabled, rootDisabled, onPick, testID }: { org: OrgData; networkName: string; value: DeptKey; disabled?: ReadonlySet<string>; rootDisabled?: boolean; onPick: (id: DeptKey) => void; testID: string }) {
  const rows = flattenTree(org);
  const item = (id: DeptKey, name: string, depth: number) => {
    const off = id ? !!disabled?.has(id) : !!rootDisabled;
    const on = value === id;
    return (
      <Pressable key={id ?? '__root'} accessibilityRole="radio" accessibilityState={{ checked: on, disabled: off }} disabled={off} onPress={() => onPick(id)}
        testID={`${testID}-opt-${id ?? 'root'}`}
        style={state => [{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingLeft: spacing.lg + depth * 18, paddingRight: spacing.lg, opacity: off ? 0.4 : 1 }, ((state as { hovered?: boolean }).hovered || state.pressed) ? { backgroundColor: colors.rowHover } : null]}>
        <Ionicons name={id ? 'git-network-outline' : 'business-outline'} size={16} color={colors.textMuted} />
        <Text style={{ flex: 1, color: colors.text, fontSize: typeScale.body }} numberOfLines={1}>{name}</Text>
        {on ? <Ionicons name="checkmark" size={18} color={colors.accent} /> : null}
      </Pressable>
    );
  };
  return <View testID={testID}>{item(null, networkName, 0)}{rows.map(r => item(r.dept.id, r.dept.name, r.depth + 1))}</View>;
}

/** 选人:搜索 + 一行一个;multi = 多选(添加成员),否则单选(负责人)。副标题写他现在在哪个部门。 */
function PersonPickList({ org, people, networkName, multi, selected, onToggle, testID }: { org: OrgData; people: readonly OrgPerson[]; networkName: string; multi: boolean; selected: ReadonlySet<string>; onToggle: (userId: string) => void; testID: string }) {
  const [q, setQ] = useState('');
  const shown = useMemo(() => (q.trim() ? searchOrg(org, people, q).people : [...people].sort((a, b) => personName(a).localeCompare(personName(b), 'zh'))), [org, people, q]);
  return (
    <View testID={testID}>
      <View style={{ padding: spacing.md }}>
        <TextInput value={q} onChangeText={setQ} placeholder="搜索" placeholderTextColor={colors.textMuted} accessibilityLabel="搜索成员" testID={`${testID}-search`}
          style={{ height: 36, paddingHorizontal: spacing.md, borderRadius: radius.control, backgroundColor: colors.inputBg, color: colors.text, fontSize: typeScale.body }} />
      </View>
      {shown.map(p => {
        const on = selected.has(p.user_id);
        const where = departmentOf(org, p.user_id);
        return (
          <Pressable key={p.user_id} accessibilityRole={multi ? 'checkbox' : 'radio'} accessibilityState={{ checked: on }} onPress={() => onToggle(p.user_id)} testID={`${testID}-person-${p.username}`}
            style={state => [{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg }, ((state as { hovered?: boolean }).hovered || state.pressed) ? { backgroundColor: colors.rowHover } : null]}>
            <PersonLine person={p} subtitle={where ? pathTo(org, where).map(d => d.name).join(' / ') : `${networkName} · 未分配部门`} />
            <Ionicons name={on ? (multi ? 'checkbox' : 'radio-button-on') : (multi ? 'square-outline' : 'radio-button-off')} size={20} color={on ? colors.accent : colors.textMuted} />
          </Pressable>
        );
      })}
      {!shown.length ? <Text style={{ color: colors.textMuted, padding: spacing.lg }}>没有匹配的成员</Text> : null}
    </View>
  );
}

/** 部门表单的字段(新建 / 编辑共用)。上级 / 负责人是两行「标签 … 值 ›」,点了由外面推选择页 / 弹选择框。 */
function DeptFields({ mode, name, setName, idText, setIdText, parentLabel, onPickParent, leaderLabel, onPickLeader }: {
  mode: 'create' | 'edit'; name: string; setName: (s: string) => void; idText: string; setIdText: (s: string) => void;
  parentLabel: string; onPickParent: () => void; leaderLabel: string; onPickLeader: () => void;
}) {
  const line = (label: ReactNode, right: ReactNode, onPress: (() => void) | undefined, testID: string) => (
    <Pressable accessibilityRole={onPress ? 'button' : undefined} onPress={onPress} testID={testID}
      style={state => [{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, backgroundColor: colors.card }, onPress && state.pressed ? { backgroundColor: colors.rowHover } : null]}>
      <Text style={{ color: colors.text, fontSize: typeScale.body, width: 96 }}>{label}</Text>
      <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>{right}</View>
    </Pressable>
  );
  const input = (value: string, set: (s: string) => void, placeholder: string, testID: string) => (
    <TextInput value={value} onChangeText={set} placeholder={placeholder} placeholderTextColor={colors.textMuted} testID={testID} autoCapitalize="none" autoCorrect={false}
      style={{ flex: 1, textAlign: 'right', color: colors.text, fontSize: typeScale.body, paddingVertical: 8, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : null) } as object} />
  );
  const value = (text: string, placeholder: string) => (
    <>
      <Text style={{ color: text ? colors.text : colors.textMuted, fontSize: typeScale.body, flexShrink: 1 }} numberOfLines={1}>{text || placeholder}</Text>
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </>
  );
  return (
    <View testID="org-dept-form">
      {line(<Text>部门名称<Text style={{ color: colors.failed }}>*</Text></Text>, input(name, setName, '请输入部门名称', 'org-dept-name'), undefined, 'org-dept-name-row')}
      <Sep />
      {line('上级部门', value(parentLabel, ''), onPickParent, 'org-dept-parent')}
      <Sep />
      {mode === 'create' ? <>{line('部门 ID', input(idText, setIdText, '请输入否则自动生成', 'org-dept-id'), undefined, 'org-dept-id-row')}<Sep /></> : null}
      {line('部门负责人', value(leaderLabel, '请选择部门负责人'), onPickLeader, 'org-dept-leader')}
    </View>
  );
}

// ── 手机:全屏「成员与部门」 ───────────────────────────────────────────────

type PhoneView =
  | { kind: 'dept'; id: DeptKey }
  | { kind: 'form'; mode: 'create' | 'edit'; dept?: Department; parent: DeptKey }
  | { kind: 'pickParent' }
  | { kind: 'pickLeader' }
  | { kind: 'addMembers'; dept: DeptKey }
  | { kind: 'move'; userId: string }
  | { kind: 'tasks'; dept: string }
  | { kind: 'agents'; dept: string }
  | { kind: 'group'; dept: string };

type Sheet = { title: string; items: Array<{ label: string; onPress: () => void; danger?: boolean; disabled?: string; testID: string }> };

export function OrgPhoneModal({ cfg, networkId, networkName, org, people, onChanged, onClose, head }: Common & { onClose: () => void }) {
  const safe = useModalSafePadding('fullScreen');
  const perms = useMemo(() => orgPerms(org, head?.managed ?? null), [org, head?.managed]);
  const groupsOn = useGroupSupport(cfg, networkId);
  // 负责人:只负责一个部门 → 直接进那个部门(企业微信同样);负责几个 → 先列出来。
  const roots = useMemo(() => (head ? managedRoots(org, head.managed) : []), [org, head]);
  const [stack, setStack] = useState<PhoneView[]>(() => [{ kind: 'dept', id: head && roots.length === 1 ? roots[0].id : null }]);
  const [q, setQ] = useState('');
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // 表单的草稿(推选择页时不丢)
  const [form, setForm] = useState<{ name: string; id: string; parent: DeptKey; leader: string | null }>({ name: '', id: '', parent: null, leader: null });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const top = stack[stack.length - 1];
  const push = (v: PhoneView) => { setError(''); setStack(s => [...s, v]); };
  const pop = () => { setError(''); setSheet(null); setStack(s => (s.length > 1 ? s.slice(0, -1) : s)); if (stack.length <= 1) onClose(); };
  const currentDept = [...stack].reverse().find(v => v.kind === 'dept') as { kind: 'dept'; id: DeptKey } | undefined;
  const here = currentDept?.id ?? null;
  // 部门被删 / 刷新后不在了 → 回到根
  useEffect(() => { if (here && !org.departments.some(d => d.id === here)) setStack([{ kind: 'dept', id: null }]); }, [org, here]);

  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(true); setError('');
    try { await fn(); onChanged(); after?.(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const openForm = (mode: 'create' | 'edit', dept?: Department) => {
    setForm(mode === 'create' ? { name: '', id: '', parent: here, leader: null } : { name: dept!.name, id: dept!.id, parent: dept!.parent_id, leader: dept!.leader_user_id });
    push({ kind: 'form', mode, dept, parent: here });
  };
  const memberSheet = (p: OrgPerson) => {
    const where = departmentOf(org, p.user_id);
    const dept = where ? org.departments.find(d => d.id === where) : undefined;
    const items: Sheet['items'] = [
        ...(perms.canMoveMember(p.user_id) ? [{ label: '调动到其他部门…', onPress: () => { setSheet(null); push({ kind: 'move', userId: p.user_id }); }, testID: 'org-member-move' }] : []),
        ...(dept && perms.canManage(dept.id) ? [{ label: dept.leader_user_id === p.user_id ? `已是${dept.name}负责人` : `设为${dept.name}负责人`, disabled: dept.leader_user_id === p.user_id ? '已是负责人' : undefined, onPress: () => { setSheet(null); void run(() => updateDepartment(cfg, networkId, dept.id, { leader_user_id: p.user_id })); }, testID: 'org-member-leader' }] : []),
        ...(where && perms.canUnassign ? [{ label: '移出部门(设为未分配)', danger: true, onPress: () => { setSheet(null); void run(() => setMemberDepartment(cfg, networkId, p.user_id, null)); }, testID: 'org-member-remove' }] : []),
    ];
    // 负责人对这个人什么都不能做(比如本部门以外的人出现在搜索结果里)→ 不弹空面板。
    if (items.length) setSheet({ title: `${personName(p)} · ${dept?.name ?? '未分配部门'}`, items });
  };
  const moreSheet = () => {
    const dept = here ? org.departments.find(d => d.id === here) : undefined;
    const blocker = dept ? deleteBlocker(org, dept.id) : null;
    setSheet({
      title: dept ? dept.name : networkName,
      items: dept ? [
        { label: '部门设置(名称 / 上级 / 负责人)', onPress: () => { setSheet(null); openForm('edit', dept); }, testID: 'org-more-edit' },
        { label: '删除部门', danger: true, disabled: blocker ? `部门里还有${blocker.children ? ` ${blocker.children} 个子部门` : ''}${blocker.children && blocker.members ? '、' : ''}${blocker.members ? ` ${blocker.members} 个成员` : ''},先移走才能删` : undefined,
          onPress: () => { setSheet(null); void run(() => deleteDepartment(cfg, networkId, dept.id), () => setStack(s => s.slice(0, -1))); }, testID: 'org-more-delete' },
      ] : [
        { label: '刷新', onPress: () => { setSheet(null); onChanged(); }, testID: 'org-more-refresh' },
      ],
    });
  };

  const header = () => {
    const title = top.kind === 'dept' ? (top.id ? deptName(org, top.id, networkName) : head ? '管理本部门' : '成员与部门')
      : top.kind === 'tasks' ? '本部门任务' : top.kind === 'agents' ? '本部门 Agent' : top.kind === 'group' ? '部门群'
      : top.kind === 'form' ? (top.mode === 'create' ? '添加子部门' : '部门设置')
        : top.kind === 'pickParent' ? '上级部门' : top.kind === 'pickLeader' ? '部门负责人' : top.kind === 'addMembers' ? '添加成员' : '调动到';
    return (
      <View style={{ height: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, backgroundColor: colors.card }}>
        <Pressable accessibilityRole="button" accessibilityLabel="返回" onPress={pop} hitSlop={8} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }} testID="org-back">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={{ flex: 1, textAlign: 'center', color: colors.text, fontSize: 17, fontWeight: weight.strong }} numberOfLines={1} testID="org-title">{title}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="关闭" onPress={onClose} hitSlop={8} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }} testID="org-close">
          <Ionicons name="close" size={24} color={colors.text} />
        </Pressable>
      </View>
    );
  };

  const deptPage = (id: DeptKey) => {
    // 负责人在「根」= 我负责的那几个部门(没有网络根和未分配的人)。
    const kids = head && id === null ? roots : childrenOf(org, id);
    const mine = head && id === null ? [] : membersIn(org, id, people);
    const dept = id ? org.departments.find(d => d.id === id) : undefined;
    const hits = q.trim() ? searchOrg(org, people, q) : null;
    // 底栏只放这一层能做的事(负责人:Hub 会拒的不出现);一样都没有 → 不画底栏。
    const bar = [
      ...(perms.inScope(id) ? [['添加成员', () => { setPicked(new Set()); push({ kind: 'addMembers', dept: id }); }, 'org-add-member'] as const] : []),
      ...(perms.canCreateUnder(id) ? [['添加子部门', () => openForm('create'), 'org-add-dept'] as const] : []),
      ...(!head || (id && perms.canManage(id)) ? [['更多', moreSheet, 'org-more'] as const] : []),
    ];
    return (
      <>
        <View style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.card }}>
          <View style={{ height: 36, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, borderRadius: radius.control, backgroundColor: colors.inputBg }}>
            <Ionicons name="search" size={16} color={colors.textMuted} />
            <TextInput value={q} onChangeText={setQ} placeholder="搜索" placeholderTextColor={colors.textMuted} accessibilityLabel="搜索部门或成员" testID="org-search"
              style={{ flex: 1, color: colors.text, fontSize: typeScale.body, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : null) } as object} />
          </View>
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: spacing.lg }} keyboardShouldPersistTaps="handled" testID="org-scroll">
          {hits ? (
            <View testID="org-search-results">
              {hits.departments.map(d => <View key={d.id}><Row onPress={() => { setQ(''); push({ kind: 'dept', id: d.id }); }} testID={`org-hit-dept-${d.id}`}><Ionicons name="git-network-outline" size={18} color={colors.textMuted} /><Text style={{ flex: 1, color: colors.text, fontSize: typeScale.body }} numberOfLines={1}>{pathTo(org, d.id).map(x => x.name).join(' / ')}</Text><Ionicons name="chevron-forward" size={16} color={colors.textMuted} /></Row><Sep /></View>)}
              {hits.people.map(p => <View key={p.user_id}><Row onPress={() => memberSheet(p)} testID={`org-hit-person-${p.username}`}><PersonLine person={p} subtitle={departmentOf(org, p.user_id) ? pathTo(org, departmentOf(org, p.user_id)).map(x => x.name).join(' / ') : '未分配部门'} /></Row><Sep inset={spacing.lg + 48} /></View>)}
              {!hits.departments.length && !hits.people.length ? <Text style={{ color: colors.textMuted, padding: spacing.lg }}>没有找到「{q.trim()}」</Text> : null}
            </View>
          ) : (
            <>
              <Text style={{ color: colors.textSecondary, fontSize: typeScale.body, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm }} numberOfLines={1} testID="org-crumb">
                {head && id === null ? '你负责的部门' : [networkName, ...pathTo(org, id).map(d => d.name)].join(' › ')}
              </Text>
              {dept?.leader_user_id && leaderName(org, dept, people) ? <Text style={{ color: colors.textMuted, fontSize: typeScale.small, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }} testID="org-leader-line">负责人:{leaderName(org, dept, people)}</Text> : null}
              <View style={{ backgroundColor: colors.card }}>
                {kids.map((d, i) => (
                  <View key={d.id}>
                    {i ? <Sep /> : null}
                    <Row onPress={() => push({ kind: 'dept', id: d.id })} testID={`org-dept-${d.id}`} accessibilityLabel={`${d.name},${totalMembers(org, d.id)} 人`}>
                      <Text style={{ flex: 1, color: colors.text, fontSize: typeScale.body }} numberOfLines={1}>{d.name}</Text>
                      <Text style={{ color: colors.textMuted, fontSize: typeScale.small }}>{totalMembers(org, d.id)}</Text>
                      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                    </Row>
                  </View>
                ))}
                {kids.length && mine.length ? <Sep inset={0} /> : null}
                {mine.map((p, i) => (
                  <View key={p.user_id}>
                    {i ? <Sep inset={spacing.lg + 48} /> : null}
                    <Row onPress={() => memberSheet(p)} testID={`org-member-${p.username}`}><PersonLine person={p} leader={dept?.leader_user_id === p.user_id} /></Row>
                  </View>
                ))}
              </View>
              {!kids.length && !mine.length ? <Text style={{ color: colors.textMuted, padding: spacing.lg }} testID="org-empty">{id ? '这个部门还没有成员和子部门' : '还没有部门,用下面「添加子部门」建一个'}</Text> : null}
              {groupsOn && id && canManageDeptGroup(head?.managed ?? null, id) ? (
                // 部门群:只给能建 / 能管的人(owner / admin、本部门负责人);群成员在会话列表里就能看到群。
                <View style={{ marginTop: spacing.lg, backgroundColor: colors.card }} testID="org-group-link">
                  <Row onPress={() => push({ kind: 'group', dept: id })} testID="org-group-entry"><Ionicons name="people-outline" size={18} color={colors.textMuted} /><Text style={{ flex: 1, color: colors.text, fontSize: typeScale.body }}>部门群</Text><Ionicons name="chevron-forward" size={16} color={colors.textMuted} /></Row>
                </View>
              ) : null}
              {head && id && perms.inScope(id) ? (
                <View style={{ marginTop: spacing.lg, backgroundColor: colors.card }} testID="org-head-links">
                  <Row onPress={() => push({ kind: 'tasks', dept: id })} testID="org-head-tasks"><Ionicons name="list-outline" size={18} color={colors.textMuted} /><Text style={{ flex: 1, color: colors.text, fontSize: typeScale.body }}>本部门任务</Text><Ionicons name="chevron-forward" size={16} color={colors.textMuted} /></Row>
                  <Sep />
                  <Row onPress={() => push({ kind: 'agents', dept: id })} testID="org-head-agents"><Ionicons name="hardware-chip-outline" size={18} color={colors.textMuted} /><Text style={{ flex: 1, color: colors.text, fontSize: typeScale.body }}>本部门 Agent</Text><Ionicons name="chevron-forward" size={16} color={colors.textMuted} /></Row>
                </View>
              ) : null}
            </>
          )}
        </ScrollView>
        {bar.length ? (
        <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.card, paddingBottom: safe.paddingBottom }} testID="org-bottom-bar">
          {bar.map(([label, onPress, tid], i) => (
            <Pressable key={tid} accessibilityRole="button" onPress={onPress} testID={tid}
              style={state => [{ flex: 1, height: 52, alignItems: 'center', justifyContent: 'center', borderLeftWidth: 1, borderLeftColor: i ? colors.border : 'transparent' }, state.pressed ? { backgroundColor: colors.rowHover } : null]}>
              <Text style={{ color: colors.accent, fontSize: typeScale.body }}>{label}</Text>
            </Pressable>
          ))}
        </View>
        ) : <View style={{ height: safe.paddingBottom }} />}
      </>
    );
  };

  const formPage = (v: Extract<PhoneView, { kind: 'form' }>) => {
    const save = () => void run(async () => {
      if (v.mode === 'create') {
        const input: DepartmentInput = { name: form.name.trim(), parent_id: form.parent, ...(form.id.trim() ? { id: form.id.trim() } : {}), ...(form.leader ? { leader_user_id: form.leader } : {}) };
        await createDepartment(cfg, networkId, input);
      } else {
        await updateDepartment(cfg, networkId, v.dept!.id, { name: form.name.trim(), parent_id: form.parent, leader_user_id: form.leader });
      }
    }, () => setStack(s => s.slice(0, -1)));
    const leader = form.leader ? people.find(p => p.user_id === form.leader) : undefined;
    return (
      <>
        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
          <DeptFields mode={v.mode} name={form.name} setName={name => setForm(f => ({ ...f, name }))} idText={form.id} setIdText={id => setForm(f => ({ ...f, id }))}
            parentLabel={deptName(org, form.parent, networkName)} onPickParent={() => push({ kind: 'pickParent' })}
            leaderLabel={leader ? personName(leader) : ''} onPickLeader={() => push({ kind: 'pickLeader' })} />
        </ScrollView>
        <View style={{ padding: spacing.lg, paddingBottom: spacing.lg + safe.paddingBottom }}>
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || !form.name.trim() }} disabled={busy || !form.name.trim()} onPress={save} testID="org-dept-save"
            style={{ height: 48, borderRadius: radius.control, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent, opacity: busy || !form.name.trim() ? 0.45 : 1 }}>
            <Text style={{ color: colors.onAccent, fontSize: typeScale.body, fontWeight: weight.strong }}>完成</Text>
          </Pressable>
        </View>
      </>
    );
  };

  const formView = [...stack].reverse().find(v => v.kind === 'form') as Extract<PhoneView, { kind: 'form' }> | undefined;
  const body = top.kind === 'dept' ? deptPage(top.id)
    : top.kind === 'form' ? formPage(top)
      : top.kind === 'pickParent' ? (
        <ScrollView style={{ flex: 1, backgroundColor: colors.card }}>
          <DeptPickList org={org} networkName={networkName} value={form.parent} disabled={union(formView?.dept ? subtreeIds(org, formView.dept.id) : undefined, perms.pickDisabled)} rootDisabled={!perms.rootPickable}
            onPick={id => { setForm(f => ({ ...f, parent: id })); pop(); }} testID="org-pick-parent" />
        </ScrollView>
      ) : top.kind === 'pickLeader' ? (
        <ScrollView style={{ flex: 1, backgroundColor: colors.card }} keyboardShouldPersistTaps="handled">
          <PersonPickList org={org} people={perms.candidates(people)} networkName={networkName} multi={false} selected={new Set(form.leader ? [form.leader] : [])}
            onToggle={uid => { setForm(f => ({ ...f, leader: f.leader === uid ? null : uid })); pop(); }} testID="org-pick-leader" />
        </ScrollView>
      ) : top.kind === 'addMembers' ? (
        <>
          <ScrollView style={{ flex: 1, backgroundColor: colors.card }} keyboardShouldPersistTaps="handled">
            <PersonPickList org={org} people={perms.candidates(people)} networkName={networkName} multi selected={picked}
              onToggle={uid => setPicked(s => { const n = new Set(s); if (n.has(uid)) n.delete(uid); else n.add(uid); return n; })} testID="org-pick-members" />
          </ScrollView>
          <View style={{ padding: spacing.lg, paddingBottom: spacing.lg + safe.paddingBottom }}>
            <Pressable accessibilityRole="button" disabled={busy || !picked.size} onPress={() => void run(async () => { for (const uid of picked) await setMemberDepartment(cfg, networkId, uid, top.dept); }, () => setStack(s => s.slice(0, -1)))} testID="org-add-member-save"
              style={{ height: 48, borderRadius: radius.control, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent, opacity: busy || !picked.size ? 0.45 : 1 }}>
              <Text style={{ color: colors.onAccent, fontSize: typeScale.body, fontWeight: weight.strong }}>{picked.size ? `加入「${deptName(org, top.dept, networkName)}」(${picked.size})` : '选择成员'}</Text>
            </Pressable>
          </View>
        </>
      ) : top.kind === 'tasks' ? <View style={{ flex: 1 }} testID="org-head-tasks-page">{head?.renderTasks(top.dept)}</View>
      : top.kind === 'agents' ? <View style={{ flex: 1 }} testID="org-head-agents-page">{head?.renderAgents(top.dept)}</View>
      : top.kind === 'group' ? <View style={{ flex: 1 }} testID="org-group-page"><DeptGroupSection cfg={cfg} networkId={networkId} deptId={top.dept} deptName={deptName(org, top.dept, networkName)} managed={head?.managed ?? null} people={people} desktop={false} /></View>
      : (
        <ScrollView style={{ flex: 1, backgroundColor: colors.card }}>
          <DeptPickList org={org} networkName={networkName} value={departmentOf(org, top.userId)} disabled={perms.pickDisabled} rootDisabled={!perms.rootPickable}
            onPick={id => void run(() => setMemberDepartment(cfg, networkId, top.userId, id), () => setStack(s => s.slice(0, -1)))} testID="org-pick-move" />
        </ScrollView>
      );

  return (
    <Modal visible animationType="slide" onRequestClose={pop} presentationStyle="fullScreen">
      <ModalKeyboardAvoider scrim={colors.groupedBg ?? colors.bg}>
      <View style={{ flex: 1, paddingTop: safe.paddingTop, paddingLeft: safe.paddingLeft, paddingRight: safe.paddingRight }} testID="org-phone">
        {header()}
        {error ? <Text style={{ color: colors.failed, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, backgroundColor: colors.card }} accessibilityRole="alert" testID="org-error">{error}</Text> : null}
        <View style={{ flex: 1 }}>{body}</View>
      </View>
      </ModalKeyboardAvoider>
      {/* 底部面板画在避让层外面,遮罩铺满整个窗口(modal-scrim-rule)。 */}
      {sheet ? (
        <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, justifyContent: 'flex-end' }} testID="org-sheet">
          <Pressable style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)' }} onPress={() => setSheet(null)} accessibilityLabel="关闭" testID="org-sheet-scrim" />
          <View style={{ backgroundColor: colors.card, borderTopLeftRadius: radius.surface, borderTopRightRadius: radius.surface, paddingBottom: safe.paddingBottom }}>
            <Text style={{ color: colors.textMuted, fontSize: typeScale.small, textAlign: 'center', paddingVertical: spacing.md }} numberOfLines={1}>{sheet.title}</Text>
            {sheet.items.map(it => (
              <View key={it.testID}>
                <Sep inset={0} />
                <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!it.disabled }} disabled={!!it.disabled} onPress={it.onPress} testID={it.testID}
                  style={state => [{ minHeight: 52, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg }, state.pressed ? { backgroundColor: colors.rowHover } : null]}>
                  <Text style={{ color: it.disabled ? colors.textMuted : it.danger ? colors.failed : colors.text, fontSize: typeScale.body }}>{it.label}</Text>
                  {it.disabled ? <Text style={{ color: colors.textMuted, fontSize: typeScale.small }} testID={`${it.testID}-reason`}>{it.disabled}</Text> : null}
                </Pressable>
              </View>
            ))}
            <View style={{ height: 8, backgroundColor: colors.bg }} />
            <Pressable accessibilityRole="button" onPress={() => setSheet(null)} style={{ minHeight: 52, alignItems: 'center', justifyContent: 'center' }} testID="org-sheet-cancel">
              <Text style={{ color: colors.text, fontSize: typeScale.body }}>取消</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </Modal>
  );
}

// ── 桌面:左树右详情 ─────────────────────────────────────────────────────

type DeskDialog =
  | { kind: 'form'; mode: 'create' | 'edit'; dept?: Department }
  | { kind: 'pickLeader'; dept: Department }
  | { kind: 'move'; dept: Department }
  | { kind: 'addMembers'; dept: DeptKey }
  | { kind: 'moveMember'; userId: string };

export function OrgDesktopPanel({ cfg, networkId, networkName, org, people, onChanged, head }: Common) {
  const perms = useMemo(() => orgPerms(org, head?.managed ?? null), [org, head?.managed]);
  const groupsOn = useGroupSupport(cfg, networkId);
  // 负责人:默认选中自己负责的第一个部门;树上本部门以外的(含网络根)灰掉、点不了。
  const [sel, setSel] = useState<DeptKey>(() => (head ? managedRoots(org, head.managed)[0]?.id ?? null : null));
  const [tab, setTab] = useState<'members' | 'tasks' | 'agents'>('members');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [dialog, setDialog] = useState<DeskDialog | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState<{ name: string; id: string; parent: DeptKey; leader: string | null; sub: 'none' | 'parent' | 'leader' }>({ name: '', id: '', parent: null, leader: null, sub: 'none' });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  useEffect(() => { if (sel && !org.departments.some(d => d.id === sel)) setSel(null); }, [org, sel]);
  const dept = sel ? org.departments.find(d => d.id === sel) : undefined;
  const rows = flattenTree(org, { collapsed });
  const hits = q.trim() ? searchOrg(org, people, q) : null;

  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(true); setError('');
    try { await fn(); onChanged(); after?.(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const openForm = (mode: 'create' | 'edit', d?: Department) => {
    setError('');
    setForm(mode === 'create' ? { name: '', id: '', parent: sel, leader: null, sub: 'none' } : { name: d!.name, id: d!.id, parent: d!.parent_id, leader: d!.leader_user_id, sub: 'none' });
    setDialog({ kind: 'form', mode, dept: d });
  };
  const btn = (label: string, onPress: () => void, testID: string, tone: 'plain' | 'accent' | 'danger' = 'plain', disabled?: boolean) => (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress} testID={testID}
      style={state => [{ height: 30, paddingHorizontal: spacing.md, borderRadius: radius.control, borderWidth: tone === 'accent' ? 0 : 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.45 : 1 }, ((state as { hovered?: boolean }).hovered || state.pressed) ? { backgroundColor: colors.rowHover } : null]}>
      <Text style={{ color: tone === 'danger' ? colors.failed : tone === 'accent' ? colors.accent : colors.text, fontSize: typeScale.small }}>{label}</Text>
    </Pressable>
  );
  const treeRow = (id: DeptKey, name: string, depth: number, hasChildren: boolean, count: number) => {
    const on = sel === id;
    const open = id ? !collapsed.has(id) : true;
    const off = perms.head && !perms.inScope(id);
    return (
      <Pressable key={id ?? '__root'} accessibilityRole="button" accessibilityState={{ selected: on, disabled: off }} disabled={off} onPress={() => { setSel(id); setQ(''); }} testID={`org-tree-${id ?? 'root'}`}
        style={state => [{ height: 34, flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: spacing.sm + depth * 16, paddingRight: spacing.md, borderRadius: radius.item, opacity: off ? 0.45 : 1 }, on ? { backgroundColor: colors.rowActive } : ((state as { hovered?: boolean }).hovered && !off ? { backgroundColor: colors.rowHover } : null)]}>
        {hasChildren && id ? (
          <Pressable accessibilityRole="button" accessibilityLabel={open ? '收起' : '展开'} hitSlop={6} onPress={() => setCollapsed(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; })} testID={`org-tree-toggle-${id}`}>
            <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={12} color={colors.textMuted} />
          </Pressable>
        ) : <View style={{ width: 12 }} />}
        <Ionicons name={id ? 'git-network-outline' : 'business-outline'} size={14} color={colors.textMuted} />
        <Text style={{ flex: 1, color: colors.text, fontSize: typeScale.small, fontWeight: on ? weight.strong : undefined }} numberOfLines={1}>{name}</Text>
        <Text style={{ color: colors.textMuted, fontSize: 11 }}>{count}</Text>
      </Pressable>
    );
  };
  const kids = childrenOf(org, sel);
  const mine = membersIn(org, sel, people);
  const blocker = dept ? deleteBlocker(org, dept.id) : null;
  const leader = dept?.leader_user_id ? people.find(p => p.user_id === dept.leader_user_id) : undefined;

  const memberRow = (p: OrgPerson) => (
    <View key={p.user_id} style={{ minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }} testID={`org-desk-member-${p.username}`}>
      <PersonLine person={p} leader={!!dept && dept.leader_user_id === p.user_id} subtitle={p.username} />
      {perms.canMoveMember(p.user_id) ? btn('调动…', () => { setError(''); setDialog({ kind: 'moveMember', userId: p.user_id }); }, `org-desk-move-${p.username}`) : null}
      {dept && dept.leader_user_id !== p.user_id && perms.canManage(dept.id) ? btn('设为负责人', () => void run(() => updateDepartment(cfg, networkId, dept.id, { leader_user_id: p.user_id })), `org-desk-lead-${p.username}`) : null}
      {sel && perms.canUnassign ? btn('移出', () => void run(() => setMemberDepartment(cfg, networkId, p.user_id, null)), `org-desk-remove-${p.username}`, 'danger') : null}
    </View>
  );

  const dialogNode = (() => {
    if (!dialog) return null;
    const close = () => setDialog(null);
    if (dialog.kind === 'form') {
      const save = () => void run(async () => {
        if (dialog.mode === 'create') await createDepartment(cfg, networkId, { name: form.name.trim(), parent_id: form.parent, ...(form.id.trim() ? { id: form.id.trim() } : {}), ...(form.leader ? { leader_user_id: form.leader } : {}) });
        else await updateDepartment(cfg, networkId, dialog.dept!.id, { name: form.name.trim(), parent_id: form.parent, leader_user_id: form.leader });
      }, close);
      const lead = form.leader ? people.find(p => p.user_id === form.leader) : undefined;
      return (
        <DialogFrame title={dialog.mode === 'create' ? '添加子部门' : '部门设置'} closeLabel="关闭" onClose={close} testID="org-dept-dialog"
          footer={<View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm }}>{btn('取消', close, 'org-dept-cancel')}{btn('完成', save, 'org-dept-save', 'accent', busy || !form.name.trim())}</View>}>
          {form.sub === 'parent' ? (
            <DeptPickList org={org} networkName={networkName} value={form.parent} disabled={union(dialog.dept ? subtreeIds(org, dialog.dept.id) : undefined, perms.pickDisabled)} rootDisabled={!perms.rootPickable} onPick={id => setForm(f => ({ ...f, parent: id, sub: 'none' }))} testID="org-pick-parent" />
          ) : form.sub === 'leader' ? (
            <PersonPickList org={org} people={perms.candidates(people)} networkName={networkName} multi={false} selected={new Set(form.leader ? [form.leader] : [])} onToggle={uid => setForm(f => ({ ...f, leader: f.leader === uid ? null : uid, sub: 'none' }))} testID="org-pick-leader" />
          ) : (
            <DeptFields mode={dialog.mode} name={form.name} setName={name => setForm(f => ({ ...f, name }))} idText={form.id} setIdText={id => setForm(f => ({ ...f, id }))}
              parentLabel={deptName(org, form.parent, networkName)} onPickParent={() => setForm(f => ({ ...f, sub: 'parent' }))}
              leaderLabel={lead ? personName(lead) : ''} onPickLeader={() => setForm(f => ({ ...f, sub: 'leader' }))} />
          )}
          {error ? <Text style={{ color: colors.failed, padding: spacing.md }} accessibilityRole="alert" testID="org-error">{error}</Text> : null}
        </DialogFrame>
      );
    }
    if (dialog.kind === 'addMembers') {
      return (
        <DialogFrame title={`添加成员到「${deptName(org, dialog.dept, networkName)}」`} closeLabel="关闭" onClose={close} testID="org-add-dialog"
          footer={<View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm }}>{btn('取消', close, 'org-add-cancel')}{btn(picked.size ? `加入(${picked.size})` : '加入', () => void run(async () => { for (const uid of picked) await setMemberDepartment(cfg, networkId, uid, dialog.dept); }, close), 'org-add-member-save', 'accent', busy || !picked.size)}</View>}>
          <PersonPickList org={org} people={perms.candidates(people)} networkName={networkName} multi selected={picked} onToggle={uid => setPicked(s => { const n = new Set(s); if (n.has(uid)) n.delete(uid); else n.add(uid); return n; })} testID="org-pick-members" />
          {error ? <Text style={{ color: colors.failed, padding: spacing.md }} accessibilityRole="alert" testID="org-error">{error}</Text> : null}
        </DialogFrame>
      );
    }
    if (dialog.kind === 'move' || dialog.kind === 'moveMember') {
      const title = dialog.kind === 'move' ? `把「${dialog.dept.name}」移到…` : `把「${personName(people.find(p => p.user_id === dialog.userId) ?? { user_id: '', username: '' })}」调动到…`;
      return (
        <DialogFrame title={title} closeLabel="关闭" onClose={close} testID="org-move-dialog">
          <DeptPickList org={org} networkName={networkName}
            value={dialog.kind === 'move' ? dialog.dept.parent_id : departmentOf(org, dialog.userId)}
            disabled={union(dialog.kind === 'move' ? subtreeIds(org, dialog.dept.id) : undefined, perms.pickDisabled)} rootDisabled={!perms.rootPickable}
            onPick={id => void run(() => (dialog.kind === 'move' ? updateDepartment(cfg, networkId, dialog.dept.id, { parent_id: id }) : setMemberDepartment(cfg, networkId, dialog.userId, id)), close)} testID="org-pick-move" />
          {error ? <Text style={{ color: colors.failed, padding: spacing.md }} accessibilityRole="alert" testID="org-error">{error}</Text> : null}
        </DialogFrame>
      );
    }
    return (
      <DialogFrame title="部门负责人" closeLabel="关闭" onClose={close} testID="org-leader-dialog">
        <PersonPickList org={org} people={perms.candidates(people)} networkName={networkName} multi={false} selected={new Set(dialog.dept.leader_user_id ? [dialog.dept.leader_user_id] : [])}
          onToggle={uid => void run(() => updateDepartment(cfg, networkId, dialog.dept.id, { leader_user_id: uid }), close)} testID="org-pick-leader" />
        {error ? <Text style={{ color: colors.failed, padding: spacing.md }} accessibilityRole="alert" testID="org-error">{error}</Text> : null}
      </DialogFrame>
    );
  })();

  return (
    // 外框是设置卡片(SettingsGroup)画的,这里只管左右两栏。
    // 负责人模式在「管理本部门」弹窗里,铺满弹窗的高度;管理员在设置卡片里,照旧最少 440。
    <View style={[{ flexDirection: 'row', minHeight: 440 }, head ? { flex: 1 } : null]} testID="org-desktop">
      <View style={{ width: 240, borderRightWidth: 1, borderRightColor: colors.border }} testID="org-tree">
        <View style={{ padding: spacing.sm }}>
          <TextInput value={q} onChangeText={setQ} placeholder="搜索部门或成员" placeholderTextColor={colors.textMuted} accessibilityLabel="搜索部门或成员" testID="org-search"
            style={{ height: 32, paddingHorizontal: spacing.md, borderRadius: radius.control, backgroundColor: colors.inputBg, color: colors.text, fontSize: typeScale.small, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : null) } as object} />
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: spacing.xs }}>
          {hits ? (
            <>
              {hits.departments.map(d => treeRow(d.id, d.name, 0, false, totalMembers(org, d.id)))}
              {hits.people.map(p => (
                <Pressable key={p.user_id} onPress={() => { const where = departmentOf(org, p.user_id); if (perms.head && !perms.inScope(where)) return; setSel(where); setQ(''); }} testID={`org-tree-hit-${p.username}`} style={{ height: 34, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.sm }}>
                  <AliasAvatar alias={personName(p)} size={18} />
                  <Text style={{ flex: 1, color: colors.text, fontSize: typeScale.small }} numberOfLines={1}>{personName(p)}</Text>
                </Pressable>
              ))}
            </>
          ) : (
            <>
              {treeRow(null, networkName, 0, false, totalMembers(org, null))}
              {rows.map(r => treeRow(r.dept.id, r.dept.name, r.depth + 1, r.hasChildren, totalMembers(org, r.dept.id)))}
            </>
          )}
        </ScrollView>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
          {perms.canCreateUnder(sel) ? btn('+ 新建部门', () => openForm('create'), 'org-new-dept', 'accent') : null}
          <Text style={{ color: colors.textMuted, fontSize: 11 }}>{org.departments.length} 个部门</Text>
        </View>
      </View>
      <View style={{ flex: 1, minWidth: 0 }} testID="org-detail">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: colors.textMuted, fontSize: 11 }} numberOfLines={1} testID="org-detail-crumb">{[networkName, ...pathTo(org, sel).slice(0, -1).map(d => d.name)].join(' › ')}</Text>
            <Text style={{ color: colors.text, fontSize: typeScale.title, fontWeight: weight.strong }} numberOfLines={1} testID="org-detail-name">{sel ? dept?.name : `${networkName}(未分配部门的成员)`}</Text>
          </View>
          {dept && perms.canManage(dept.id) ? (
            <>
              {btn('部门设置', () => openForm('edit', dept), 'org-detail-edit')}
              {btn('移动到…', () => { setError(''); setDialog({ kind: 'move', dept }); }, 'org-detail-move')}
              {btn('删除', () => void run(() => deleteDepartment(cfg, networkId, dept.id)), 'org-detail-delete', 'danger', !!blocker || busy)}
            </>
          ) : null}
        </View>
        {head && sel ? (
          // 负责人:成员 / 任务 / Agent 三个页签(任务按 department_id 筛;Agent 只读状态与健康)。
          <View style={{ flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border }} accessibilityRole="tablist" testID="org-head-tabs">
            {([['members', '成员'], ['tasks', '任务'], ['agents', 'Agent']] as const).map(([key, label]) => (
              <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: tab === key }} onPress={() => setTab(key)} testID={`org-head-tab-${key}`}
                style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 2, borderBottomColor: tab === key ? colors.accent : 'transparent' }}>
                <Text style={{ color: tab === key ? colors.accent : colors.textSecondary, fontSize: typeScale.small, fontWeight: tab === key ? weight.strong : undefined }}>{label}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {head && sel && tab !== 'members' ? (
          <View style={{ flex: 1 }} testID={`org-head-${tab}-page`}>{tab === 'tasks' ? head.renderTasks(sel) : head.renderAgents(sel)}</View>
        ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
          {error && !dialog ? <Text style={{ color: colors.failed }} accessibilityRole="alert" testID="org-error">{error}</Text> : null}
          {dept && blocker && perms.canManage(dept.id) ? <Text style={{ color: colors.textMuted, fontSize: 11 }} testID="org-detail-delete-reason">部门里还有{blocker.children ? ` ${blocker.children} 个子部门` : ''}{blocker.children && blocker.members ? '、' : ''}{blocker.members ? ` ${blocker.members} 个成员` : ''},先移走才能删除</Text> : null}
          {dept ? (
            <View style={{ gap: spacing.sm }}>
              <Text style={{ color: colors.textSecondary, fontSize: typeScale.small, fontWeight: weight.medium }}>负责人</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.control, borderWidth: 1, borderColor: colors.border }} testID="org-detail-leader">
                {leader ? <PersonLine person={leader} subtitle={leader.username} /> : <Text style={{ flex: 1, color: colors.textMuted }}>还没有负责人</Text>}
                {perms.canManage(dept.id) ? btn(leader ? '更换' : '设置', () => { setError(''); setDialog({ kind: 'pickLeader', dept }); }, 'org-detail-leader-set') : null}
                {leader && perms.canManage(dept.id) ? btn('清除', () => void run(() => updateDepartment(cfg, networkId, dept.id, { leader_user_id: null })), 'org-detail-leader-clear') : null}
              </View>
            </View>
          ) : null}
          {dept && groupsOn && canManageDeptGroup(head?.managed ?? null, dept.id) ? (
            <DeptGroupSection key={dept.id} cfg={cfg} networkId={networkId} deptId={dept.id} deptName={dept.name} managed={head?.managed ?? null} people={people} desktop />
          ) : null}
          <View style={{ gap: spacing.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={{ flex: 1, color: colors.textSecondary, fontSize: typeScale.small, fontWeight: weight.medium }}>子部门 {kids.length}</Text>
              {perms.canCreateUnder(sel) ? btn('+ 新建子部门', () => openForm('create'), 'org-detail-add-dept', 'accent') : null}
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }} testID="org-detail-children">
              {kids.map(k => (
                <Pressable key={k.id} onPress={() => setSel(k.id)} testID={`org-detail-child-${k.id}`}
                  style={state => [{ minWidth: 180, padding: spacing.md, borderRadius: radius.control, borderWidth: 1, borderColor: colors.border }, ((state as { hovered?: boolean }).hovered) ? { backgroundColor: colors.rowHover } : null]}>
                  <Text style={{ color: colors.text, fontSize: typeScale.body }} numberOfLines={1}>{k.name}</Text>
                  <Text style={{ color: colors.textMuted, fontSize: 11 }}>{totalMembers(org, k.id)} 人{leaderName(org, k, people) ? ` · 负责人 ${leaderName(org, k, people)}` : ''}</Text>
                </Pressable>
              ))}
            </View>
          </View>
          <View style={{ gap: spacing.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={{ flex: 1, color: colors.textSecondary, fontSize: typeScale.small, fontWeight: weight.medium }}>{sel ? '直属成员' : '未分配部门的成员'} {mine.length}</Text>
              {perms.inScope(sel) ? btn('+ 添加成员', () => { setError(''); setPicked(new Set()); setDialog({ kind: 'addMembers', dept: sel }); }, 'org-detail-add-member', 'accent') : null}
            </View>
            <View style={{ borderTopWidth: 1, borderTopColor: colors.border }} testID="org-detail-members">{mine.map(memberRow)}</View>
            {!mine.length ? <Text style={{ color: colors.textMuted }}>没有成员</Text> : null}
          </View>
        </ScrollView>
        )}
      </View>
      {dialogNode}
    </View>
  );
}
