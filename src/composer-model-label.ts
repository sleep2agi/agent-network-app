// 输入框底部那行「当前会话的模型」(#4130 显示段)。
//
// 口径(卡面写死):
// · 模型来自会话上报或同 scope 的受权 config.model_effective；档位仅来自后者。
// · 拿不到就**什么都不显示** —— 绝不拿默认配置、别的节点候选、或模型名里的产物猜;
// · 会话离线时把「离线」标出来,别让人以为这是此刻真实在跑的模型;
// · runtime 已经在 model 字符串里(如 `opencode:xxx`)就不重复前缀。
// 纯逻辑,不 import react-native,ck 测试直接 import。

import { t } from './i18n';

export interface ComposerModelInput {
  model?: string | null;
  runtime?: string | null;
  /** hub 会话行的 status;'offline' 时标注。其它值不标注(不臆造「在线」字样)。 */
  status?: string | null;
  /** Effective config readback only. undefined=unknown; null=explicit default. */
  modelVariant?: string | null;
}

export interface ComposerModelSnapshot {
  scope: object;
  value: ComposerModelInput;
  expiresAt: number;
}

/** A render-scope object is never reused across account/chat transitions.
 * Check age during render too: mobile/background timers may be suspended. */
export function activeComposerModelValue(snapshot: ComposerModelSnapshot | null, scope: object, now = Date.now()): ComposerModelInput | null {
  if (!snapshot || snapshot.scope !== scope || !Number.isFinite(snapshot.expiresAt) || now >= snapshot.expiresAt) return null;
  return snapshot.value;
}

export function readComposerModelSnapshot(snapshot: ComposerModelSnapshot | null, scope: object, now = Date.now()): string | null {
  const value = activeComposerModelValue(snapshot, scope, now);
  return value ? composerModelLabel(value) : null;
}

/** Footer variant control: undefined = unknown, null = explicit default, string = selected. */
export function composerVariantLabel(variant: string | null | undefined): string {
  if (variant === undefined) return t('chat.variantUnknownShort');
  if (variant === null) return t('chat.variantDefaultShort');
  return variant;
}

/** Footer variant pill text. An unknown value shows the control's name (never a made-up level);
 * the accessibility label still says unknown via composerVariantLabel. */
export function composerVariantPillLabel(variant: string | null | undefined): string {
  return variant === undefined ? t('chat.variantPillUnknown') : composerVariantLabel(variant);
}

/** Left/right inset of the mobile model row so its pills line up with the text box, not the buttons beside it. */
export function composerModelRowInset(hasLeftCol: boolean, controlSize: number, rowPad: number, gap: number): { left: number; right: number } {
  return { left: rowPad + (hasLeftCol ? controlSize + gap : 0), right: rowPad + controlSize + gap };
}

/** Never combine a config variant with the independently cached status model. */
export function readEffectiveComposerModel(snapshot: ComposerModelSnapshot | null, scope: object, reported: ComposerModelSnapshot | null, reportedScope: object, now = Date.now()): string | null {
  if (!snapshot || snapshot.scope !== scope || !Number.isFinite(snapshot.expiresAt) || now >= snapshot.expiresAt) return null;
  const offline = reported?.scope === reportedScope && now < reported.expiresAt && reported.value.status === 'offline';
  return composerModelLabel({ ...snapshot.value, status: offline ? 'offline' : snapshot.value.status });
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
  const withVariant = withRuntime + t('chat.variantSuffix', { value: input.modelVariant === undefined ? t('chat.variantUnknownShort') : input.modelVariant === null ? t('chat.variantDefaultShort') : input.modelVariant });
  return input.status === 'offline' ? `${withVariant} · 离线` : withVariant;
}
