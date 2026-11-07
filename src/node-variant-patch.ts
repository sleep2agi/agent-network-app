// #4099 客户端 modelVariant 契约（对齐 server/agent-node f2ad9629 的准确语义）
//
// 契约（读自共享树 /tmp/opencode/anet-4099-node-variant）：
// · patch.modelVariant: **省略 = 沿旧 model 语义不修改档**；**null = 显式清除**；**string = 选中档位**；
// · string 约束：1..200 字符，且**不得含空白/控制字符**（server 侧 invalid_patch）；
// · 能力门：节点 config_snapshot 里必须 `opencode_variant_config_capable === true`（server 侧 variant_unsupported）；
// · modelVariant 与 flags/channels 不可同时出现；
// · apply_mode：带 modelVariant 即 hot（f2ad9629 server/src/tools.ts:3923）。
// 纯逻辑，不 import react-native。

export interface NodePatchInput {
  model?: string;
  modelVariant?: string | null;
  flags?: Record<string, unknown>;
}

/** 序列化 patch：**只有显式给出 modelVariant 才写**（null 也照写 → 清除档位）。 */
export function buildConfigPatch(input: NodePatchInput): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (typeof input.model === 'string' && input.model.length > 0) patch.model = input.model;
  if (Object.prototype.hasOwnProperty.call(input, 'modelVariant')) patch.modelVariant = input.modelVariant;
  if (input.flags && typeof input.flags === 'object' && Object.keys(input.flags).length) patch.flags = input.flags;
  return patch;
}

const VARIANT_RE = /^[^\s\x00-\x1f\x7f]{1,200}$/;

/** 客户端侧预检（与 server 同口径，避免明知会 invalid_patch 还发出去）。 */
export function variantValueError(value: unknown): string | null {
  if (value === undefined || value === null) return null;   // 省略/清除都合法
  if (typeof value !== 'string') return '档位必须是字符串';
  if (!VARIANT_RE.test(value)) return '档位不能含空白或控制字符（1–200 字符）';
  return null;
}

/** 档位可写性：必须节点显式声明能力；runtime 必须是 opencode 系。 */
export function variantWritable(input: { variantCapable?: boolean | null; runtime?: string | null }): { ok: boolean; reason: string } {
  const rt = (input.runtime ?? '').trim();
  const opencodeRt = rt === 'opencode' || rt === 'opencode-cli';
  if (!opencodeRt) return { ok: false, reason: `当前 runtime（${rt || '未上报'}）不支持档位写入` };
  if (input.variantCapable !== true) return { ok: false, reason: '该节点未声明 opencode_variant_config_capable，不能写档位' };
  return { ok: true, reason: '可写：带 modelVariant 的 patch 会以 hot 方式应用' };
}

export type VariantChoices =
  | { kind: 'unknown'; options: [] }
  | { kind: 'none'; options: [] }
  | { kind: 'list'; options: string[] };

/** 目录里的档位：undefined = 未知；[] = 明确没有；非空 = 可选（去重保序）。 */
export function variantChoices(variants: unknown): VariantChoices {
  if (!Array.isArray(variants)) return { kind: 'unknown', options: [] };
  const list = [...new Set(variants.filter((v): v is string => typeof v === 'string' && v.length > 0))];
  return list.length ? { kind: 'list', options: list } : { kind: 'none', options: [] };
}

/** 切模型时原档位是否仍然适配：模型变了且目录里该新模型没有同档位 → 需要按合同清除或要求重选。 */
export function variantAfterModelSwitch(input: {
  previousModel?: string | null;
  nextModel?: string | null;
  currentVariant?: string | null;
  nextModelVariants?: unknown;
}): { action: 'keep' | 'clear' | 'must-reselect'; reason: string } {
  const prev = (input.previousModel ?? '').trim();
  const next = (input.nextModel ?? '').trim();
  const cur = typeof input.currentVariant === 'string' ? input.currentVariant.trim() : '';
  if (!cur) return { action: 'keep', reason: '当前没有档位' };
  if (prev && next && prev === next) return { action: 'keep', reason: '模型未变，档位保持' };
  const choices = variantChoices(input.nextModelVariants);
  if (choices.kind === 'list' && choices.options.includes(cur)) return { action: 'keep', reason: '新模型支持同一档位' };
  if (choices.kind === 'none') return { action: 'clear', reason: '新模型没有可选档位 → 按合同显式清除（modelVariant: null）' };
  return { action: 'must-reselect', reason: '新模型的档位未知或不含原档位 → 要求重新选择，不拼后缀、不硬编码' };
}
