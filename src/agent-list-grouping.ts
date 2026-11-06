// 侧栏分组视图(0.477,#1253 的最小切片,本仓自建实现)。
//
// 现状:侧栏只按部门/团队分区(AgentsScreen 的 buildSections + teamOf)。admin/通讯录里
// 一多,「谁在干活、谁掉线了」就得靠肉眼扫。这里先把**分组维度**收敛成一个纯函数,让 UI 层
// 只负责选视图 + 持久化,分组键的计算可被单测钉住:
//
//   department(默认) —— 沿用部门/团队分区,不改变现有行为
//   status           —— 按在线态分区:正在工作 / 在线 / 异常 / 离线 / 未上报
//
// 为什么先做 status:数据已经在 Session.status 上(不需要新的 hub 接口),而且它直接回答
// 「谁掉线了」这个每天都在问的问题。运行时 / 主机分组要等 agentDirectory 的字段落定再加。

export type GroupBy = 'department' | 'status';
export const GROUP_BY_KEY = 'agent_list_group_by_v1';

/** 分组键的展示名。顺序即分区顺序:在干活的排最前,离线的沉底。 */
export const STATUS_GROUP_ORDER = ['正在工作', '在线', '异常', '离线', '未上报'] as const;
export type StatusGroup = (typeof STATUS_GROUP_ORDER)[number];

/**
 * Session.status → 分区名。
 *
 * 认的值:`working` / `running`(hub 两个历史写法)→ 正在工作;`online` / `idle` → 在线;
 * `error` / `failed` → 异常;`offline` / `down` → 离线;空 / 认不出 → 未上报。
 * 认不出的一律归「未上报」而不是猜:把不明状态塞进「在线」会让掉线的节点看起来还活着。
 */
export function statusGroupOf(status?: string | null): StatusGroup {
  const s = (status ?? '').trim().toLowerCase();
  if (s === 'working' || s === 'running') return '正在工作';
  if (s === 'online' || s === 'idle') return '在线';
  if (s === 'error' || s === 'failed') return '异常';
  if (s === 'offline' || s === 'down') return '离线';
  return '未上报';
}

/** 分组视图的排序权重(小在前)。未知维度返回 0,不倒序。 */
export function statusGroupRank(group: string): number {
  const i = (STATUS_GROUP_ORDER as readonly string[]).indexOf(group);
  return i < 0 ? STATUS_GROUP_ORDER.length : i;
}

/**
 * 读回设备上保存的视图。
 * 只认已知的两个值:旧版本写进来的空串、别的维度名、损坏数据都退回默认(department),
 * 这样升级后不会出现「列表突然空了」这种吓人结果。
 */
export function parseGroupBy(raw: string | null | undefined): GroupBy {
  return raw === 'status' || raw === 'department' ? raw : 'department';
}

/** 给 UI 用的一行说明:切换后用户能预期看到什么。 */
export function groupByHint(by: GroupBy): string {
  return by === 'status'
    ? '按在线态分区:正在工作 / 在线 / 异常 / 离线 / 未上报'
    : '按部门/团队分区(默认)';
}
