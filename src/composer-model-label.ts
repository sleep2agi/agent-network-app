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

export function composerModelLabel(input: ComposerModelInput): string | null {
  const model = typeof input.model === 'string' ? input.model.trim() : '';
  if (!model) return null;
  const runtime = typeof input.runtime === 'string' ? input.runtime.trim() : '';
  const withRuntime = runtime && !model.toLowerCase().includes(runtime.toLowerCase()) ? `${runtime} · ${model}` : model;
  return input.status === 'offline' ? `${withRuntime} · 离线` : withRuntime;
}
