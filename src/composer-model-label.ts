// 输入框底部那行「当前会话的模型」(#4130 显示段)。
//
// 口径(卡面写死):
// · 只显示**会话自己上报的值**(hub /api/status 的 session.model / session.runtime,节点自报);
// · 拿不到就**什么都不显示** —— 绝不拿默认配置、别的节点候选、或模型名里的产物猜;
// · 会话离线时把「离线」标出来,别让人以为这是此刻真实在跑的模型;
// · runtime 已经在 model 字符串里(如 `opencode:xxx`)就不重复前缀。
// 纯逻辑,不 import react-native,ck 测试直接 import。

export interface ComposerModelInput {
  model?: string | null;
  runtime?: string | null;
  /** hub 会话行的 status;'offline' 时标注。其它值不标注(不臆造「在线」字样)。 */
  status?: string | null;
}

export interface ComposerModelSnapshot {
  scope: object;
  value: ComposerModelInput;
  expiresAt: number;
}

/** A render-scope object is never reused across account/chat transitions.
 * Check age during render too: mobile/background timers may be suspended. */
export function readComposerModelSnapshot(snapshot: ComposerModelSnapshot | null, scope: object, now = Date.now()): string | null {
  if (!snapshot || snapshot.scope !== scope || !Number.isFinite(snapshot.expiresAt) || now >= snapshot.expiresAt) return null;
  return composerModelLabel(snapshot.value);
}

/** Only accept an unambiguous full-status row from the selected network. */
export function reportedComposerModel(rows: ReadonlyArray<{ alias: string; network_id?: string | null; model?: string | null; runtime?: string | null; status?: string | null }>, networkId: string | undefined, alias: string): ComposerModelInput | null {
  if (!networkId) return null;
  const matching = rows.filter(row => row.alias === alias && row.network_id === networkId);
  if (matching.length !== 1 || !matching[0].model?.trim()) return null;
  return { model: matching[0].model, runtime: matching[0].runtime, status: matching[0].status };
}

export function composerModelLabel(input: ComposerModelInput): string | null {
  const model = typeof input.model === 'string' ? input.model.trim() : '';
  if (!model) return null;
  const runtime = typeof input.runtime === 'string' ? input.runtime.trim() : '';
  const withRuntime = runtime && !model.toLowerCase().includes(runtime.toLowerCase()) ? `${runtime} · ${model}` : model;
  return input.status === 'offline' ? `${withRuntime} · 离线` : withRuntime;
}
