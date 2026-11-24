// 「agent 在聊天里举手要密钥」的识别层（admin 2026-11-20 插队需求）。
//
// agent 只能通过 Hub 的 MCP action（`daemon_provider_snapshot` / `secret_request_ui`）
// 举一次手：{node_id, key, label?}。它拿到的是 {ok:true,pending:true}，**拿不到值**。
// App 侧要做的第一件事就是从消息流里认出这次举手，把它渲染成加密输入卡，而不是原始 tool-call 文本。
//
// 这个模块只做纯识别（不 import react-native），因为 agent 的输出形态还没定稿：
// Hub 的 action 名字/参数以通信欧的 PR 为准。所以识别写成「宽进严出」：
//   · 认 fenced json 里的 {"name":"secret_request_ui", ...} / {"tool":...} / {"action":...}
//   · 认同名的紧凑调用 `secret_request_ui({...})` / `secret_request_ui {...}`
//   · 参数既可以在顶层，也可以在 arguments / input / params 里
// 认不出就返回 null（宁可当普通文本，也不能把一段普通文本误判成要密钥）。

export interface SecretRequest {
  /** 要写的 key（如 GITHUB_TOKEN），展示与写库都用它。 */
  key: string;
  /** 人话提示（如「GitHub 密钥」）；没有就用 key。 */
  label?: string;
  /** 标题下一行：这是做什么用的（request_secret 的 hint）。 */
  hint?: string;
}

/** Hub 侧可能叫的名字，按优先级匹配。 */
export const SECRET_REQUEST_NAMES = ['secret_request_ui', 'daemon_provider_snapshot'] as const;

const MAX_SCAN = 4000;

const asRecord = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** 从一段 JSON 里取出 key/label；支持参数在顶层或 arguments/input/params 里。 */
function requestFromObject(obj: unknown): SecretRequest | null {
  const rec = asRecord(obj);
  if (!rec) return null;
  const name = str(rec.name) || str(rec.tool) || str(rec.action);
  const wrapped = asRecord(rec.arguments) ?? asRecord(rec.input) ?? asRecord(rec.params) ?? rec;
  const action = str(wrapped.action);
  const matched = SECRET_REQUEST_NAMES.includes((name || action) as (typeof SECRET_REQUEST_NAMES)[number])
    || SECRET_REQUEST_NAMES.includes(action as (typeof SECRET_REQUEST_NAMES)[number]);
  if (!matched) return null;
  const key = str(wrapped.key) || str(wrapped.secret_key) || str(wrapped.name);
  if (!key) return null;
  const label = str(wrapped.label) || str(wrapped.description) || undefined;
  return label ? { key, label } : { key };
}

/** 尝试把一段字符串当 JSON 解析（允许外面包一层 ```json 围栏或前后有零散文字）。 */
function parseJsonCandidate(text: string): unknown | null {
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidates = [fence?.[1], text];
  for (const c of candidates) {
    if (!c) continue;
    const trimmed = c.trim();
    const starts = [trimmed.indexOf('{'), trimmed.indexOf('[')].filter(i => i >= 0);
    if (!starts.length) continue;
    const from = Math.min(...starts);
    const to = Math.max(trimmed.lastIndexOf('}'), trimmed.lastIndexOf(']'));
    if (to <= from) continue;
    try { return JSON.parse(trimmed.slice(from, to + 1)); } catch { /* 下一个候选 */ }
  }
  return null;
}

/** 紧凑调用：`secret_request_ui({...})` / `secret_request_ui {...}` / `secret_request_ui({"key":...})`。 */
function parseCompactCall(text: string): SecretRequest | null {
  const re = /(secret_request_ui|daemon_provider_snapshot)\s*\(?\s*(\{[\s\S]*?\})\s*\)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    try {
      const args = JSON.parse(m[2]);
      // 紧凑调用里对象只是参数，工具名在外面的标识符上。
      return requestFromObject({ name: m[1], arguments: m[1] === 'daemon_provider_snapshot' ? { action: 'secret_request_ui', ...args } : args });
    } catch { /* 不是合法 JSON，继续找 */ }
  }
  return null;
}

/** 认一次「举手」。认不出返回 null。 */
export function parseSecretRequest(content: unknown): SecretRequest | null {
  if (typeof content !== 'string' || !content.trim()) return null;
  const text = content.length > MAX_SCAN ? content.slice(0, MAX_SCAN) : content;
  if (!SECRET_REQUEST_NAMES.some(n => text.includes(n))) return null;
  const json = parseJsonCandidate(text);
  const fromJson = json ? requestFromObject(json) : null;
  if (fromJson) return fromJson;
  return parseCompactCall(text);
}

/**
 * 把消息内容拆成「要显示的文本」和「要渲染成卡片的举手」。
 * 显示文本里会去掉那段 tool-call（不是删整条消息：agent 可能还写了别的话）。
 */
export function splitSecretRequest(content: unknown): { text: string; request: SecretRequest | null } {
  const raw = typeof content === 'string' ? content : '';
  const request = parseSecretRequest(raw);
  if (!request) return { text: raw, request: null };
  const fences = raw.replace(/```(?:json)?\s*[\s\S]*?```/gi, block => (parseSecretRequest(block) ? '' : block));
  const withoutJson = fences
    .replace(/(secret_request_ui|daemon_provider_snapshot)\s*\(?\s*\{[\s\S]*?\}\s*\)?/g, '')
    .trim();
  return { text: withoutJson, request };
}

/** 保存成功后发给对话的确认语：只说 key 已保存，绝不带值。 */
export function secretSavedConfirmation(request: SecretRequest): string {
  return `${request.key} 已保存。`;
}
