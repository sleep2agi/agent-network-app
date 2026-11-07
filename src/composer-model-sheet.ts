// #4130 第一主线（只读）：聊天页模型行的「查询"当前模型/Provider/可用档位"」面板模型。
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

  // 4) 思考档位：当前 catalog 没有 variants 字段 → 明确不可确定
  rows.push({
    key: 'variants',
    label: '可用思考档位',
    value: '不可确定：当前 Hub 的模型目录不提供 variants / 思考程度字段',
    readOnly: true,
  });

  return { rows, hasCurrent: !!model, variantsKnown: false };
}

/** 切换能力：本轮一律关闭，并给出原因；调用方不得把它当作成功。 */
export function switchAvailability(): { enabled: false; reason: string } {
  return { enabled: false, reason: '需要会话级切换接口 + 切换后回读；当前只有节点级写入，未启用' };
}
