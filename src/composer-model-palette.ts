// #4130 follow-up —— 聊天页「选模型」命令面板的纯逻辑。
//
// 口径（不能为了好看破）：
// · 目录只来自**这台节点**的 `read_opencode_catalog` 快照（providerId/id），
//   不从裸模型名猜 provider、不合并别的节点、不编内置清单；
// · 当前模型只来自定向会话上报或同 scope 的受权 config 读回；
//   只有 `provider/model` 与目录行**逐字相等**才认为「这是当前项」并打勾；
// · 分组/计数/搜索/置顶全部是纯函数，JSX 只负责画；
// · 切换是否生效由 `confirmComposer*Switch` 判定：本次 update_id 的终局 ACK
//   **且** 真实读回匹配才算 confirmed，任何一项缺失都是 unknown。
//
// 纯逻辑，不 import react-native，ck 测试直接 import。

import { lastUpdateApplied } from './node-model-change';
import { variantChoices, type VariantChoices } from './node-variant-patch';

export interface PaletteCatalogSnapshot {
  providers?: ReadonlyArray<{ id?: string | null; activation?: string | null }> | null;
  models?: ReadonlyArray<{ providerId?: string | null; id?: string | null; variants?: unknown }> | null;
}

export interface PaletteModel {
  /** `provider/model`，也是写配置时唯一允许的模型标识。 */
  key: string;
  providerId: string;
  id: string;
  /** 目录若真的给了该模型的档位就原样保留；缺省 = 未知，不补默认档。 */
  variants?: unknown;
}

export interface PaletteRow extends PaletteModel {
  /** 只有与可信当前模型逐字相等才为 true。 */
  current: boolean;
  choices: VariantChoices;
}

export interface PaletteGroup {
  provider: string;
  count: number;
  rows: PaletteRow[];
}

export type PaletteStatus = 'loading' | 'error' | 'ready';

export interface PaletteView {
  status: PaletteStatus;
  /** 只有 status=error 时非空；原样来自 Hub/daemon 的真实原因。 */
  errorText: string | null;
  groups: PaletteGroup[];
  /** 搜索过滤后的模型数（= 各组 count 之和）。 */
  total: number;
  /** 过滤前的目录模型数：用来区分「目录本来就是空」和「搜索没命中」。 */
  catalogTotal: number;
  /** 当前模型命中的 provider；裸模型名/不在目录里 = null（不猜）。 */
  currentProvider: string | null;
}

/** 目录 → 可展示的模型行。停用的 provider 不出现；空 id、重复项丢掉；保持目录顺序。 */
export function paletteCatalogModels(snapshot: PaletteCatalogSnapshot | null | undefined): PaletteModel[] {
  const disabled = new Set(
    (snapshot?.providers ?? [])
      .filter(p => p?.activation === 'disabled')
      .map(p => (typeof p?.id === 'string' ? p.id.trim() : ''))
      .filter(Boolean),
  );
  const out: PaletteModel[] = [];
  const seen = new Set<string>();
  for (const row of snapshot?.models ?? []) {
    const providerId = typeof row?.providerId === 'string' ? row.providerId.trim() : '';
    const id = typeof row?.id === 'string' ? row.id.trim() : '';
    if (!providerId || !id || disabled.has(providerId)) continue;
    const key = `${providerId}/${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, providerId, id, variants: row?.variants });
  }
  return out;
}

/** 搜索：provider 名或模型名都能命中，大小写不敏感；空查询返回全部（保序）。 */
export function filterPaletteModels(models: readonly PaletteModel[], query: string | null | undefined): PaletteModel[] {
  const q = (query ?? '').trim().toLowerCase();
  if (!q) return [...models];
  return models.filter(m =>
    m.providerId.toLowerCase().includes(q) ||
    m.id.toLowerCase().includes(q) ||
    m.key.toLowerCase().includes(q));
}

/** 当前模型必须是目录里的一整条 `provider/model`；裸模型名不猜 provider。 */
export function paletteCurrentKey(currentModel: string | null | undefined, models: readonly PaletteModel[]): string | null {
  const cur = (currentModel ?? '').trim();
  if (!cur) return null;
  return models.find(m => m.key === cur)?.key ?? null;
}

/** 按 provider 分组：组序 = 目录里首次出现的顺序；当前模型所在组置顶；组内保持目录顺序。 */
export function groupPaletteModels(models: readonly PaletteModel[], currentKey: string | null): PaletteGroup[] {
  const buckets = new Map<string, PaletteRow[]>();
  for (const m of models) {
    const row: PaletteRow = {
      ...m,
      current: currentKey !== null && m.key === currentKey,
      choices: variantChoices(m.variants),
    };
    const bucket = buckets.get(m.providerId);
    if (bucket) bucket.push(row);
    else buckets.set(m.providerId, [row]);
  }
  const groups = [...buckets.entries()].map(([provider, rows]) => ({ provider, count: rows.length, rows }));
  if (!currentKey) return groups;
  const idx = groups.findIndex(g => g.rows.some(r => r.current));
  if (idx <= 0) return groups;
  return [groups[idx], ...groups.slice(0, idx), ...groups.slice(idx + 1)];
}

export interface PaletteViewInput {
  snapshot: PaletteCatalogSnapshot | null;
  query?: string | null;
  currentModel?: string | null;
  loading?: boolean;
  /** 目录读取失败的真实原因（Hub 原文 / catalogErrorText 的结果）。 */
  error?: string | null;
}

/** 面板的完整视图模型：loading / 真实错误 / 分组结果，三态互斥。 */
export function paletteView(input: PaletteViewInput): PaletteView {
  if (input.loading) {
    return { status: 'loading', errorText: null, groups: [], total: 0, catalogTotal: 0, currentProvider: null };
  }
  if (input.error) {
    return { status: 'error', errorText: input.error, groups: [], total: 0, catalogTotal: 0, currentProvider: null };
  }
  const all = paletteCatalogModels(input.snapshot);
  const currentKey = paletteCurrentKey(input.currentModel, all);
  const filtered = filterPaletteModels(all, input.query);
  const groups = groupPaletteModels(filtered, currentKey);
  const currentProvider = currentKey ? all.find(m => m.key === currentKey)?.providerId ?? null : null;
  return {
    status: 'ready',
    errorText: null,
    groups,
    total: filtered.length,
    catalogTotal: all.length,
    currentProvider,
  };
}

/** 目录里这条模型真的给出了档位列表吗？缺省 = 未知（不是「没有档位」）。 */
export function paletteVariantChoices(
  snapshot: PaletteCatalogSnapshot | null | undefined,
  modelKey: string | null | undefined,
): VariantChoices {
  const key = (modelKey ?? '').trim();
  if (!key) return variantChoices(undefined);
  const row = (snapshot?.models ?? []).find(m => {
    const p = typeof m?.providerId === 'string' ? m.providerId.trim() : '';
    const i = typeof m?.id === 'string' ? m.id.trim() : '';
    return p && i && `${p}/${i}` === key;
  });
  return variantChoices(row?.variants);
}

/** 目录提供的 per-model 档位映射（写档位前的本地预检用；缺省不补）。 */
export function paletteVariantMap(snapshot: PaletteCatalogSnapshot | null | undefined): Record<string, VariantChoices> {
  const out: Record<string, VariantChoices> = {};
  for (const m of paletteCatalogModels(snapshot)) {
    const choices = variantChoices(m.variants);
    if (choices.kind !== 'unknown') out[m.key] = choices;
  }
  return out;
}

export interface ComposerSwitchConfirmation {
  confirmed: boolean;
  reason: string;
  /** 本次 ACK 已 applied，但节点不回报 model_effective（agent-node 旧版 / 尚未心跳）。
   *  不是「已确认」，也不是失败：Hub 回执说节点已经换好，只是没有会话级读回。 */
  ackOnly?: boolean;
}

/** 模型切换：本次 update_id 的终局 ACK + model_effective 真实读回，两者都匹配才算生效。 */
export function confirmComposerModelSwitch(input: {
  after: { model_effective?: string | null; last_update?: Parameters<typeof lastUpdateApplied>[0] } | null;
  updateId: string | undefined;
  requested: string;
}): ComposerSwitchConfirmation {
  if (!input.after) return { confirmed: false, reason: '节点配置读回为空' };
  const ack = lastUpdateApplied(input.after.last_update, input.updateId, input.requested);
  if (!ack.applied) return { confirmed: false, reason: ack.reason };
  const effective = typeof input.after.model_effective === 'string' ? input.after.model_effective.trim() : '';
  // 2026-11-09 admin 实测（通信客户端欧，agent-node .184）：节点 198ms 内已热切换成功，
  // 但旧版 agent-node 不上报 model_effective，面板把成功报成失败，再选一次又撞 revision 冲突。
  // 缺读回 ≠ 读回不一致：只有「读回了另一个模型」才算失败。
  if (!effective) return { confirmed: false, ackOnly: true, reason: 'last_update=applied；节点未回报 model_effective' };
  if (effective !== input.requested) {
    return { confirmed: false, reason: `model_effective=${effective} 与请求 ${input.requested} 不一致` };
  }
  return { confirmed: true, reason: 'last_update=applied 且 model_effective 读回一致' };
}

/** 档位切换：同模型 + 本次 ACK + 读回档位必须显式等于请求值（null = 明确清除）。 */
export function confirmComposerVariantSwitch(input: {
  after: { model_effective?: string | null; modelVariant?: string | null; last_update?: Parameters<typeof lastUpdateApplied>[0] } | null;
  updateId: string | undefined;
  requestedModel: string;
  requestedVariant: string | null;
}): ComposerSwitchConfirmation {
  if (!input.after) return { confirmed: false, reason: '节点配置读回为空' };
  const ack = lastUpdateApplied(input.after.last_update, input.updateId, input.requestedModel);
  if (!ack.applied) return { confirmed: false, reason: ack.reason };
  const effective = typeof input.after.model_effective === 'string' ? input.after.model_effective.trim() : '';
  if (effective !== input.requestedModel) {
    return { confirmed: false, reason: `model_effective=${effective || 'unknown'} 与请求 ${input.requestedModel} 不一致` };
  }
  if (!Object.prototype.hasOwnProperty.call(input.after, 'modelVariant')) {
    return { confirmed: false, reason: '读回缺 modelVariant（unknown，不当作明确默认档）' };
  }
  if (input.after.modelVariant !== input.requestedVariant) {
    return { confirmed: false, reason: `modelVariant=${input.after.modelVariant ?? 'null'} 与请求 ${input.requestedVariant ?? 'null'} 不一致` };
  }
  return { confirmed: true, reason: 'last_update=applied 且 modelVariant 读回一致' };
}
