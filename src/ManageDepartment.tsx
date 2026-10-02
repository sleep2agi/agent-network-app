// 「管理本部门」(RFC-040,看板 #485;Hub ≥ .91):部门负责人的入口。
//
// 入口只在 /api/auth/me 的 managed_department_ids 非空时出现(旧 Hub 没有这个字段 ⇒ 不出现)。打开的是同一套
// 「成员与部门」页面(OrgChart.tsx)的负责人模式:只在本部门子树里能动,按钮跟 Hub 的 viewer_can 走。
// 电脑:居中大弹窗,左树右详情 + 「成员 / 任务 / Agent」页签。手机:全屏,先进本部门(负责几个就先列出来),
// 部门页底部「本部门任务」「本部门 Agent」两个入口。任务 = GET /api/requirements?department_id=;
// Agent = GET …/departments/:dept/nodes(只读状态和健康,派活 / 对话仍按 Agent 授权)。
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text } from './ui-text';
import { Ionicons } from './icons';
import DialogFrame from './DialogFrame';
import { t as tr } from './i18n';
import { useTranslation } from './i18n-react';
import './i18n-users';
import { colors, radius, spacing, statusColor, type as typeScale, weight } from './theme';
import type { HubConfig } from './api';
import { fetchOrg, fetchDepartmentNodes, fetchDepartmentRequirements, type DepartmentNode } from './org-api';
import { fetchHumans } from './human-dm-api';
import { personName, type OrgData, type OrgPerson } from './org-model';
import { OrgDesktopPanel, OrgPhoneModal, type OrgHeadMode } from './OrgChart';
import type { Requirement } from './requirements-model';

type Loaded<T> = { state: 'loading' } | { state: 'error' } | { state: 'ok'; value: T };

function useLoad<T>(load: () => Promise<T>, deps: readonly unknown[]): [Loaded<T>, () => void] {
  const [data, setData] = useState<Loaded<T>>({ state: 'loading' });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setData(d => (d.state === 'ok' ? d : { state: 'loading' }));
    load().then(value => { if (live) setData({ state: 'ok', value }); }, () => { if (live) setData({ state: 'error' }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return [data, useCallback(() => setTick(n => n + 1), [])];
}

function Status({ data, retry, children }: { data: Loaded<unknown>; retry: () => void; children: () => ReactNode }) {
  if (data.state === 'loading') return <Text style={{ color: colors.textMuted, padding: spacing.lg }} testID="dept-loading">{tr('dept.loading')}</Text>;
  if (data.state === 'error') {
    return (
      <View style={{ padding: spacing.lg, gap: spacing.sm, alignItems: 'flex-start' }} testID="dept-error">
        <Text style={{ color: colors.failed }}>{tr('dept.loadFailed')}</Text>
        <Pressable accessibilityRole="button" onPress={retry} testID="dept-retry"><Text style={{ color: colors.accent }}>{tr('dept.retry')}</Text></Pressable>
      </View>
    );
  }
  return <>{children()}</>;
}

const nameOf = (people: readonly OrgPerson[], userId: string | null | undefined) => {
  const p = userId ? people.find(x => x.user_id === userId) : undefined;
  return p ? personName(p) : '';
};

/** 本部门(含下级)的任务:负责人是本部门的人、或负责 Agent 归他们所有;仍在我看得见的范围里。 */
export function DepartmentTasks({ cfg, networkId, deptId, people }: { cfg: HubConfig; networkId: string; deptId: string; people: readonly OrgPerson[] }) {
  useTranslation();
  const [data, retry] = useLoad<Requirement[]>(() => fetchDepartmentRequirements(cfg, networkId, deptId), [cfg.serverUrl, cfg.token, networkId, deptId]);
  return (
    <Status data={data} retry={retry}>
      {() => {
        const rows = (data as { value: Requirement[] }).value;
        if (!rows.length) return <Text style={{ color: colors.textMuted, padding: spacing.lg }} testID="dept-tasks-empty">{tr('dept.tasks.empty')}</Text>;
        return (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: spacing.lg }} testID="dept-tasks">
            <Text style={{ color: colors.textMuted, fontSize: typeScale.small, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm }}>{tr('dept.tasks.count', { n: rows.length })}</Text>
            {rows.map(r => {
              const owner = nameOf(people, r.owner?.kind === 'user' ? r.owner.id : null);
              return (
                <View key={r.id} style={{ minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.card }} testID={`dept-task-${r.id}`}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ color: colors.text, fontSize: typeScale.body }} numberOfLines={1}>{r.seq ? `#${r.seq} ` : ''}{r.name}</Text>
                    <Text style={{ color: colors.textMuted, fontSize: typeScale.small }} numberOfLines={1}>{owner || tr('dept.unassigned')}</Text>
                  </View>
                  <Text style={{ color: r.column === 'done' ? colors.textMuted : r.column === 'doing' ? colors.accent : colors.textSecondary, fontSize: typeScale.small }} testID={`dept-task-col-${r.id}`}>{tr(`dept.col.${r.column}`)}</Text>
                </View>
              );
            })}
          </ScrollView>
        );
      }}
    </Status>
  );
}

/** 本部门成员的 Agent:只读的状态和健康(降级的层和原因)。 */
export function DepartmentAgents({ cfg, networkId, deptId, people }: { cfg: HubConfig; networkId: string; deptId: string; people: readonly OrgPerson[] }) {
  useTranslation();
  const [data, retry] = useLoad<DepartmentNode[]>(() => fetchDepartmentNodes(cfg, networkId, deptId), [cfg.serverUrl, cfg.token, networkId, deptId]);
  return (
    <Status data={data} retry={retry}>
      {() => {
        const nodes = (data as { value: DepartmentNode[] }).value;
        return (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: spacing.lg }} testID="dept-agents">
            <Text style={{ color: colors.textMuted, fontSize: typeScale.small, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm }}>{tr('dept.agents.note')}</Text>
            {!nodes.length ? <Text style={{ color: colors.textMuted, padding: spacing.lg }} testID="dept-agents-empty">{tr('dept.agents.empty')}</Text> : null}
            {nodes.map(n => {
              const online = n.status !== 'offline';
              return (
                <View key={n.node_id} style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.card }} testID={`dept-agent-${n.node_id}`}>
                  <View style={{ width: 8, height: 8, borderRadius: radius.pill, backgroundColor: n.degraded.length ? colors.failed : statusColor(n.status, online) }} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ color: colors.text, fontSize: typeScale.body, fontWeight: weight.medium }} numberOfLines={1}>{n.display_name || n.alias || n.node_id}</Text>
                    <Text style={{ color: colors.textMuted, fontSize: typeScale.small }} numberOfLines={1}>{tr('dept.agents.owner', { name: nameOf(people, n.owner_user_id) || '—' })}</Text>
                    {n.degraded.map(d => <Text key={d.layer} style={{ color: colors.failed, fontSize: typeScale.small }} numberOfLines={2} testID={`dept-agent-degraded-${n.node_id}-${d.layer}`}>{d.label}{d.reason ? `：${d.reason}` : ''}</Text>)}
                  </View>
                  <Text style={{ color: online ? colors.textSecondary : colors.textMuted, fontSize: typeScale.small }} testID={`dept-agent-status-${n.node_id}`}>{online ? tr('dept.agents.online') : tr('dept.agents.offline')}</Text>
                </View>
              );
            })}
          </ScrollView>
        );
      }}
    </Status>
  );
}

/** 组织架构 + 通讯录(负责人不是管理员,用 /humans 而不是成员管理接口)。 */
function useHeadOrg(cfg: HubConfig, networkId: string) {
  return useLoad<{ org: OrgData; people: OrgPerson[] }>(async () => {
    const [org, people] = await Promise.all([fetchOrg(cfg, networkId), fetchHumans(cfg, networkId)]);
    if (!org) throw new Error('no org');
    return { org, people };
  }, [cfg.serverUrl, cfg.token, networkId]);
}

type EntryProps = { cfg: HubConfig; networkId: string; networkName: string; managed: readonly string[]; onClose: () => void };

function useHeadMode(cfg: HubConfig, networkId: string, managed: readonly string[], people: readonly OrgPerson[]): OrgHeadMode {
  const key = managed.join('\u0000');
  return useMemo(() => ({
    managed: new Set(managed),
    renderTasks: (deptId: string) => <DepartmentTasks key={deptId} cfg={cfg} networkId={networkId} deptId={deptId} people={people} />,
    renderAgents: (deptId: string) => <DepartmentAgents key={deptId} cfg={cfg} networkId={networkId} deptId={deptId} people={people} />,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [cfg, networkId, key, people]);
}

/** 电脑 / 平板:居中大弹窗,里面是负责人模式的左树右详情。 */
export function ManageDepartmentDesktop({ cfg, networkId, networkName, managed, onClose }: EntryProps) {
  useTranslation();
  const [data, reload] = useHeadOrg(cfg, networkId);
  const people = data.state === 'ok' ? data.value.people : [];
  const head = useHeadMode(cfg, networkId, managed, people);
  return (
    <DialogFrame title={tr('dept.manage')} closeLabel={tr('dept.close')} onClose={onClose} scroll={false} sectioned maxWidth={1040} height={720} testID="manage-dept-desktop">
      <Status data={data} retry={reload}>
        {() => <OrgDesktopPanel cfg={cfg} networkId={networkId} networkName={networkName} org={(data as { value: { org: OrgData } }).value.org} people={people} onChanged={reload} head={head} />}
      </Status>
    </DialogFrame>
  );
}

/** 手机:全屏的负责人模式「成员与部门」。读取期间 / 失败时也是全屏(不闪回设置页)。 */
export function ManageDepartmentPhone({ cfg, networkId, networkName, managed, onClose }: EntryProps) {
  useTranslation();
  const [data, reload] = useHeadOrg(cfg, networkId);
  const people = data.state === 'ok' ? data.value.people : [];
  const head = useHeadMode(cfg, networkId, managed, people);
  if (data.state !== 'ok') {
    return (
      <DialogFrame title={tr('dept.manage')} closeLabel={tr('dept.close')} onClose={onClose} testID="manage-dept-phone-loading">
        <Status data={data} retry={reload}>{() => null}</Status>
      </DialogFrame>
    );
  }
  return <OrgPhoneModal cfg={cfg} networkId={networkId} networkName={networkName} org={data.value.org} people={people} onChanged={reload} onClose={onClose} head={head} />;
}

export function ManageDepartmentIcon({ size = 18, color }: { size?: number; color?: string }) {
  return <Ionicons name="git-network-outline" size={size} color={color ?? colors.textMuted} />;
}
