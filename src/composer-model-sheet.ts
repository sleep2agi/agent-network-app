// #4130 第一主线（只读）：聊天页模型行的「查询"当前模型/Provider/可用档位"」面板模型。
//
// ⚠️ 2026-11-14 状态更正（#4823）：本文件是 #4130 时期的**只读**面板模型，现在**没有任何生产代码引用它**
// （`grep "from './composer-model-sheet'" src/` 只剩它自己的测试）。线上在用的是
// `ComposerModelPalette.tsx` —— 那里的切换**已启用**：写节点配置（`updateNodeConfig` + `baseRevision`）
// 并做「本次 update_id 终局 ACK + 真实读回」双条件判定。所以下面那句「切换未启用」只描述本文件的历史形态，
// 不代表当前客户端行为；不要再拿它当现状引用。是否删除本文件见 #4823 的后续决定（不在此次改动内）。
//
// 口径（admin 2026-11-07）：
// · 只展示**可信来源**：当前模型来自定向会话上报（scope+35s TTL，见 composer-model-label.ts）；
//   Provider / 模型清单来自 `read_opencode_catalog`（指定 node/daemon，只读、不启动 server）；
// · 不拿别的节点目录、不拿 fallback、不从裸模型名猜 Provider；
// · **切换未启用**：目前只有节点级 `updateNodeConfig`，没有会话级 switch + 回读，所以
//   `switchAvailability()` 恒为 false 并给出原因；点开面板不算切换成功。
// 纯逻辑，不 import react-native，ck 测试直接 import。

export interface SheetReportedModel {
  model?: string | null;
  runtime?: string | null;
  status?: string | null;
}

export interface SheetCatalog {
  providers?: ReadonlyArray<{ id?: string | null }>;
  models?: ReadonlyArray<{ providerId?: string | null; id?: string | null }>;
}

export interface SheetInput {
  reported: SheetReportedModel | null;
  catalog: SheetCatalog | null;
  /** 目录里该模型真实给出的档位：undefined = 接口未提供（未知）；[] = 明确没有；非空 = 可选档位。 */
  variants?: string[] | null;
  /** catalog 取不到时的原因（unsupported / timeout / 非 V2 等），原样展示，不编造。 */
  catalogError?: string | null;
}

export interface SheetRow {
  key: string;
  label: string;
  value: string;
  /** true = 这一行只是说明，不可执行（本轮全部只读）。 */
  readOnly: boolean;
}

export interface SheetModel {
  rows: SheetRow[];
  /** 有无可信的当前模型（决定「当前模型」行是值还是未知说明）。 */
  hasCurrent: boolean;
  /** 可用档位（思考程度）是否可确定 —— 当前 catalog 不提供该字段，恒为 false。 */
  variantsKnown: boolean;
}

const providerOf = (model: string | null | undefined): string | null => {
  if (typeof model !== 'string') return null;
  const m = model.trim();
  const i = m.indexOf('/');
  return i > 0 ? m.slice(0, i) : null;
};

/** Provider 分组计数：只统计 catalog 里真实给出的 providerId。 */
export function providerGroups(catalog: SheetCatalog | null): Array<{ provider: string; count: number }> {
  const rows = catalog?.models ?? [];
  const seen = new Map<string, number>();
  for (const m of rows) {
    const p = typeof m?.providerId === 'string' ? m.providerId.trim() : '';
    if (!p) continue;
    seen.set(p, (seen.get(p) ?? 0) + 1);
  }
  return [...seen.entries()]
    .map(([provider, count]) => ({ provider, count }))
    .sort((a, b) => (a.provider === b.provider ? 0 : a.provider < b.provider ? -1 : 1));
}

export function modelSheet(input: SheetInput): SheetModel {
  const reported = input.reported;
  const model = typeof reported?.model === 'string' ? reported.model.trim() : '';
  const runtime = typeof reported?.runtime === 'string' ? reported.runtime.trim() : '';
  const rows: SheetRow[] = [];

  // 1) 当前模型：只认上报值
  const current = model ? `${runtime ? `${runtime} · ` : ''}${model}` : '';
  rows.push({
    key: 'current',
    label: '当前模型',
    value: current || '未知（本会话尚未上报）',
    readOnly: true,
  });

  // 2) Provider：只有上报模型带 provider 前缀时才敢说；否则只说「未上报」
  const reportedProvider = providerOf(model);
  rows.push({
    key: 'provider',
    label: 'Provider',
    value: reportedProvider ?? '未上报（不从裸模型名猜）',
    readOnly: true,
  });

  // 3) 目录：Provider 分组 + 模型数（来自 catalog，只读）
  const groups = providerGroups(input.catalog);
  if (input.catalogError) {
    rows.push({ key: 'catalog', label: '可用模型目录', value: `不可用：${input.catalogError}`, readOnly: true });
  } else if (!groups.length) {
    rows.push({ key: 'catalog', label: '可用模型目录', value: '空（这台节点没有上报任何模型，先从节点页拉取）', readOnly: true });
  } else {
    const total = groups.reduce((n, g) => n + g.count, 0);
    rows.push({
      key: 'catalog',
      label: '可用模型目录',
      value: groups.map(g => `${g.provider}(${g.count})`).join(' · ') + ` — 共 ${total} 个`,
      readOnly: true,
    });
  }

  // 4) 思考档位：区分「接口未提供（未知）」与「明确没有档位」与「真实可选档位」，不编造可写能力。
  const variants = input.variants;
  const variantsKnown = Array.isArray(variants);
  let variantsValue: string;
  if (!variantsKnown) variantsValue = '未知：Hub 目录尚未提供 variants 字段（不猜、不显示假档位）';
  else if (variants.length === 0) variantsValue = '该模型没有可选档位';
  else variantsValue = `可选：${variants.join(' · ')}（只读展示，未接入写入）`;
  rows.push({ key: 'variants', label: '可用思考档位', value: variantsValue, readOnly: true });

  return { rows, hasCurrent: !!model, variantsKnown };
}

export interface SwitchInput {
  /** 是否有目标绑定：本账号当前 network 的受权 HubNode 详情（含真实 daemon 绑定）。 */
  hasTarget: boolean;
  /** 目标节点是否声明支持配置写入（config_update_capable）。 */
  configUpdateCapable?: boolean | null;
  /** 是否有可选模型（来自本节点 catalog）。 */
  optionCount?: number;
}

/** 切换能力：只复用**现有节点设置**受支持路径（updateNodeConfig/baseRevision/回读），不做会话级写。
 *  不具备目标绑定 / 节点不支持配置写入 / 没有可选模型时，明确禁用并给准确原因。 */
export function switchAvailability(input: SwitchInput): { enabled: boolean; reason: string } {
  if (!input.hasTarget) return { enabled: false, reason: '无目标绑定：本账号当前 network 内找不到该节点的受权详情' };
  if (input.configUpdateCapable !== true) return { enabled: false, reason: '该 Hub 不提供节点配置写入（config_update_capable≠true），不能切换' };
  if ((input.optionCount ?? 0) === 0) return { enabled: false, reason: '本节点没有可选的模型目录，先到节点页拉取' };
  return { enabled: true, reason: '切换 = 写入该节点配置（带 baseRevision），成功后以节点上报回读为准' };
}
