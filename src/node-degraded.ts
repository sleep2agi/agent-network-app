// 节点「降级」(board #460,#448 的子项)—— 纯逻辑,无 RN 依赖,node-degraded.test.ts 直接 import。
//
// 节点在 Hub 上显示 idle,实际 App Server 端口没人听 / TUI 不在 / 登录态被作废 —— agent-node .94 起把这几层
// 报给 Hub(report_status.health),Hub 对确知坏掉的节点拒收新任务(node_degraded)。这里决定列表行 / 节点详情
// 画不画「降级」、写什么原因。
//
// 数据两种来源,同一套判据:
//   1. `degraded: [{ layer, label, reason }]` —— Hub(#460 起)只在确知降级时给,列表用的 ?light=1 也有;
//   2. `health` + `health_observed_ms_ago` —— 完整投影(节点详情)在 Hub .84 / .85 上就有,但没有 `degraded`;
//      按 Hub 的同一规则自己算:报告 < 10 分钟、某层明确 ok=false / 登录 revoked|expired。
// 🔴 不知道 = 不画:health 为 null(老节点)、报告过期、某层没报 —— 什么都不显示,不猜。

export type DegradedLayer = { layer: 'app_server' | 'tui' | 'model_auth' | string; label: string; reason: string };

export type NodeDegraded = {
  layers: DegradedLayer[];
  /** 行上徽标的短原因:第一层的 label。 */
  short: string;
  /** 读屏 / 提示里的完整一句:「降级:App Server 断开、需要重新登录」。 */
  summary: string;
};

/** 与 Hub 的 NODE_HEALTH_TTL_MS 同值:超过它的报告当「不知道」。 */
export const HEALTH_FRESH_MS = 10 * 60_000;

const TUI_LABEL: Record<string, string> = {
  'session-missing': 'TUI 会话不在',
  'pane-dead': 'TUI 已退出',
  'sleep-placeholder': 'TUI 被占位(sleep)',
  'tmux-unavailable': 'tmux 不可用',
};

/** 每一层怎么修(提示条第二行)。只说本节点自己的修法,不教人拷别的节点的凭据。 */
export const LAYER_HINT: Record<string, string> = {
  app_server: '节点的 codex app-server 没有响应,需要在节点所在机器上重启节点',
  tui: '共存 TUI 不在运行,需要在节点所在机器上重新拉起',
  model_auth: '该节点自己的 CODEX_HOME 需要重新登录',
};

type HealthLike = {
  app_server?: { ok?: unknown; last_error?: unknown } | null;
  tui?: { ok?: unknown; reason?: unknown } | null;
  model_auth?: unknown;
} | null | undefined;

export function layersFromHealth(health: HealthLike): DegradedLayer[] {
  if (!health || typeof health !== 'object') return [];
  const out: DegradedLayer[] = [];
  if (health.app_server && health.app_server.ok === false) {
    out.push({ layer: 'app_server', label: 'App Server 断开', reason: typeof health.app_server.last_error === 'string' ? health.app_server.last_error : 'unreachable' });
  }
  if (health.tui && health.tui.ok === false) {
    const reason = typeof health.tui.reason === 'string' ? health.tui.reason : 'unknown';
    out.push({ layer: 'tui', label: TUI_LABEL[reason] ?? 'TUI 不可用', reason });
  }
  if (health.model_auth === 'revoked' || health.model_auth === 'expired') {
    out.push({ layer: 'model_auth', label: health.model_auth === 'revoked' ? '需要重新登录' : '登录已过期', reason: health.model_auth });
  }
  return out;
}

function parseDegradedField(raw: unknown): DegradedLayer[] | null {
  if (!Array.isArray(raw)) return null;
  const out: DegradedLayer[] = [];
  for (const l of raw) {
    if (!l || typeof l !== 'object') continue;
    const { layer, label, reason } = l as Record<string, unknown>;
    if (typeof label !== 'string' || !label.trim()) continue;
    out.push({ layer: typeof layer === 'string' ? layer : 'unknown', label: label.trim(), reason: typeof reason === 'string' ? reason : '' });
  }
  return out;
}

/** 一个 /api/status 行 → 降级信息;不降级 / 不知道 → null。 */
export function nodeDegraded(row: unknown): NodeDegraded | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as { degraded?: unknown; health?: unknown; health_observed_ms_ago?: unknown };
  let layers = parseDegradedField(r.degraded);
  if (layers === null) {
    const age = r.health_observed_ms_ago;
    const fresh = typeof age === 'number' && Number.isFinite(age) && age >= 0 && age <= HEALTH_FRESH_MS;
    layers = fresh ? layersFromHealth(r.health as HealthLike) : [];
  }
  if (!layers.length) return null;
  return { layers, short: layers[0].label, summary: `降级:${layers.map(l => l.label).join('、')}` };
}

/** 提示条 / 长按详情的逐行文本:「App Server 断开 — 节点的 codex app-server 没有响应…」。 */
export function degradedDetailLines(d: NodeDegraded): string[] {
  return d.layers.map(l => (LAYER_HINT[l.layer] ? `${l.label} — ${LAYER_HINT[l.layer]}` : l.label));
}
