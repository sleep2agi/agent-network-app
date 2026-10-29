// 节点权限白名单的**显示规则**(Hub RFC-041 白名单小节)。
//
// 三条不能违反的规则,全在这里收口:
//   1. null / undefined = 不限制(界面必须写「不限制」); [] = 一个都不允许 —— 两者完全不同;
//   2. 保活类工具不许被单独禁用(挡掉它们,节点既干不了活也报不了自己干不了,变成更隐蔽的假活节点);
//   3. 拒绝原因码要照实显示,它们指向完全不同的排查动作,不能合并成「权限不足」。
export const ALWAYS_TOOLS = ['get_inbox', 'ack_inbox', 'send_reply', 'report_status'] as const;

export const isAlwaysTool = (tool: string): boolean => (ALWAYS_TOOLS as readonly string[]).includes(tool);

/** 白名单的「人话」:null = 不限制;空数组 = 一个都不允许;否则列出来。 */
export function allowlistText(list: readonly string[] | null | undefined, kind: 'peer' | 'tool'): string {
  if (list === null || list === undefined) return '不限制';
  if (list.length === 0) return kind === 'peer' ? '不与任何节点通信' : '不允许任何工具';
  return list.join('、');
}

/** 输入框 → 白名单:空白 = 清空限制(null);否则按逗号/空格/顿号拆开去重。 */
export function parseAllowlistInput(text: string): string[] | null {
  const items = text
    .split(/[\s,、，]+/)
    .map(s => s.trim())
    .filter(Boolean);
  return items.length ? [...new Set(items)] : null;
}

/** 编辑工具清单时:保活类不能被移除(即使界面给了置灰入口,这里也兜一层)。 */
export function withoutAlwaysTools(tools: readonly string[]): string[] {
  return tools.filter(t => !isAlwaysTool(t));
}

export const PERMISSION_REASONS: Record<string, string> = {
  mode_readonly: '节点被设为「只读」：先在上面的模式里改回「正常」再重试',
  mode_restricted_not_assigned: '节点是「受限」模式，但这个节点没有被分配任务：让网络管理员分配任务，或把模式改为「正常」',
  peer_not_allowed: '对端节点不在这个节点的「可通信节点」白名单里：把对端加进白名单，或清空白名单',
  tool_not_allowed: '这个工具被「可用工具」白名单挡住了：把该工具加进清单，或清空清单',
  secret_transport_plain: '密钥只能走加密通道，当前连接是明文：改用 https / wss 再试',
  secret_transport_unknown: '无法确认通道是否加密：检查服务端地址是否 https / wss',
};

/** 原因码 → 可执行的一句话。未知码原样带出,别吞掉(吞掉等于让排查人猜)。 */
export function permissionReasonText(code: string | null | undefined): string | null {
  if (!code) return null;
  const key = code.trim();
  return PERMISSION_REASONS[key] ?? `未知的拒绝原因：${key}`;
}
