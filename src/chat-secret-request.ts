// admin 2026-11-24 —— 「要密钥弹卡片」的聊天侧纯逻辑（不 import react-native，便于测试）。
//
// Hub 的 request_secret 工具把卡片随回执放进这次对话：tasks.meta_json.reply_secret_request
// = { node_id, key, label?, hint? }（永无值）。这里：
//   · 从任务行读出卡片（读不出就返回 null，按普通回复渲染兜底正文）；
//   · 生成保存后以用户身份发出的那句话（只含名字，不含值）——AI 收到它才会继续；
//   · 从后面的消息里认出「已保存」，重开聊天时卡片直接显示已保存，不为此发任何请求。

export interface ChatSecretRequest {
  nodeId: string;
  key: string;
  label?: string;
  hint?: string;
}

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,119}$/;
const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : undefined);

export function chatSecretRequestFromMeta(metaJson: unknown): ChatSecretRequest | null {
  let meta: unknown = metaJson;
  if (typeof metaJson === 'string') {
    try { meta = JSON.parse(metaJson); } catch { return null; }
  }
  const raw = meta && typeof meta === 'object' ? (meta as Record<string, unknown>).reply_secret_request : null;
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const nodeId = str(r.node_id, 200);
  const key = str(r.key, 120);
  if (!nodeId || !key || !KEY_RE.test(key)) return null;
  const label = str(r.label, 80);
  const hint = str(r.hint, 200);
  return { nodeId, key, ...(label ? { label } : {}), ...(hint ? { hint } : {}) };
}

const SAVED_PREFIX = '🔑 已在卡片里保存';

/** 保存成功后以用户身份发出的一句话：只有名字和变量名，没有值。 */
export function secretSavedMessage(req: Pick<ChatSecretRequest, 'key' | 'label'>): string {
  return `${SAVED_PREFIX}「${req.label || req.key}」（${req.key}），下次启动后作为环境变量 ${req.key} 可用。`;
}

/** 这张卡（发于 cardAt）之后，**当前用户自己**发过「已保存 KEY」吗？
 *  只看卡片之后、只看本人：旧的确认不会吞掉后来同名的换钥请求，别人的话也不算（Dash 欧评审 #463）。 */
export function secretSavedAfter(
  rows: readonly { content?: string | null; at?: string | null; own: boolean }[],
  key: string,
  cardAt: string | null | undefined,
): boolean {
  const since = cardAt ? Date.parse(cardAt) : NaN;
  for (const r of rows) {
    if (!r.own || !r.content || !r.content.startsWith(SAVED_PREFIX)) continue;
    const hit = /（([A-Za-z_][A-Za-z0-9_]*)）/.exec(r.content);
    if (!hit || hit[1] !== key) continue;
    const at = r.at ? Date.parse(r.at) : NaN;
    // 时间未知（卡片或确认缺时间 / 不可解析）一律**不算**：宁可让人再填一次，也不能把新请求误判成已保存
    // （客户端欧评审 #1712）。刚点保存的那一刻由卡片自己的 phase=saved 保持；本地回显也带真实时间。
    if (!Number.isNaN(since) && !Number.isNaN(at) && at >= since) return true;
  }
  return false;
}

/** 保存失败时给人看的话：说清原因和下一步，不出现内部错误码。 */
export function secretSaveErrorText(kind: string): string {
  switch (kind) {
    case 'forbidden': return '只有这个网络的管理员能保存密钥，请让管理员来填。';
    case 'unsupported': return '这台机器上的 ANet 版本太旧，升级后再保存。';
    case 'invalid': return '内容不能为空，且不超过 8KB。';
    default: return '这台机器暂时没有回应，确认它在线后再点一次保存。';
  }
}
