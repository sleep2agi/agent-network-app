// 侧栏分组视图(0.477,#1253 的最小切片,本仓自建实现)。
//
// 现状:侧栏只按部门/团队分区(AgentsScreen 的 buildSections + teamOf)。admin/通讯录里
// 一多,「谁在干活、谁掉线了」就得靠肉眼扫。这里先把**分组维度**收敛成一个纯函数,让 UI 层
// 只负责选视图 + 持久化,分组键的计算可被单测钉住:
//
//   department(默认) —— 沿用部门/团队分区,不改变现有行为
//   status           —— 按在线态分区:正在工作 / 在线 / 异常 / 离线 / 未上报
//   runtime          —— 按运行时分区(codex-cli / opencode-cli / grok-… / 未上报)
//
// 为什么先做 status:数据已经在 Session.status 上(不需要新的 hub 接口),而且它直接回答
// 「谁掉线了」这个每天都在问的问题。运行时 / 主机分组要等 agentDirectory 的字段落定再加。

export type GroupBy = 'department' | 'status' | 'runtime';
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

/** 分区名的「未上报」兜底:运行时没上报时不要显示空标题。 */
export const UNKNOWN_GROUP = '未上报';

/**
 * Session.runtime → 分区名(0.478)。
 *
 * 不把运行时改写成漂亮名字:运维贴回来的诊断行里写的就是 `runtime=codex-cli` / `runtime=opencode-cli`,
 * 两边用同一个字符串才对得上。空 → 「未上报」;去首尾空白,大小写保持原样(上游是固定枚举)。
 */
export function runtimeGroupOf(runtime?: string | null): string {
  const r = (runtime ?? '').trim();
  return r || UNKNOWN_GROUP;
}

/** 运行时分区的排序权重:「未上报」永远最后,其余交给 buildSections 原有规则(在线人数→拼音)。 */
export function runtimeGroupRank(title: string): number {
  return title === UNKNOWN_GROUP ? 1 : 0;
}

/**
 * 读回设备上保存的视图。
 * 只认已知的两个值:旧版本写进来的空串、别的维度名、损坏数据都退回默认(department),
 * 这样升级后不会出现「列表突然空了」这种吓人结果。
 */
export function parseGroupBy(raw: string | null | undefined): GroupBy {
  return raw === 'status' || raw === 'runtime' || raw === 'department' ? raw : 'department';
}

/** 给 UI 用的一行说明:切换后用户能预期看到什么。 */
export function groupByHint(by: GroupBy): string {
  if (by === 'status') return '按在线态分区:正在工作 / 在线 / 异常 / 离线 / 未上报';
  if (by === 'runtime') return '按运行时分区:codex-cli / opencode-cli / grok… / 未上报';
  return '按部门/团队分区(默认)';
}

/** 切换顺序(0.478):部门 → 在线态 → 运行时 → 部门。单键循环比下拉更省一次点击。 */
export const GROUP_BY_CYCLE: readonly GroupBy[] = ['department', 'status', 'runtime'];
export function nextGroupBy(by: GroupBy): GroupBy {
  const i = Math.max(0, GROUP_BY_CYCLE.indexOf(by));
  return GROUP_BY_CYCLE[(i + 1) % GROUP_BY_CYCLE.length];
}

/** 分区按钮上显示什么(短)。 */
export function groupByLabel(by: GroupBy): string {
  if (by === 'status') return '分组 · 在线态';
  if (by === 'runtime') return '分组 · 运行时';
  return '分组 · 部门';
}

/**
 * 分组标题右侧的计数文案(0.480)。
 *
 * 按部门/团队看时 `在线/总数` 有意义(一个部门里有人在线、有人离线)。但按**在线态**或**运行时**分区时,
 * 「离线」组的在线人数恒为 0 —— 写 `0/4` 会被读成「这组没人」,读到「0/4 在线」更是自相矛盾。
 * 所以这两种视图只给总数,a11y 也改成「N 个」。
 */
export function groupCountLabel(
  by: GroupBy,
  online: number,
  total: number,
): { text: string; a11y: string } {
  if (by === 'department') {
    return { text: `${online}/${total}`, a11y: `${online}/${total} 在线` };
  }
  return { text: String(total), a11y: `${total} 个` };
}

/**
 * 「未上报」组为什么存在(0.481)。
 *
 * 按在线态/运行时分区时,总有一组行没有状态/运行时 —— 这不是 bug:旧 agent-node 不上报清单,
 * 或者会话只是别名、根本没有节点身份。以前这一组只显示「未上报」,用户会以为是数据丢了。
 * 返回 null = 这组不需要解释(部门视图、或别的组)。
 */
export function groupHeaderHint(by: GroupBy, title: string): string | null {
  if (title !== UNKNOWN_GROUP) return null;
  if (by === 'status') return '这些会话没有上报在线态（旧 agent-node 不上报，或只是别名、没有节点身份）';
  if (by === 'runtime') return '这些会话没有上报运行时（旧 agent-node 不上报清单，或只是别名、没有节点身份）';
  return null;
}
