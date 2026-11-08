// 新建节点向导里「可选项」的纯判断（runtime / model 的搜索与分组）。
// 与模型命令面板同一口径：搜索大小写不敏感、按 provider 分组并带计数。
// 纯函数，不 import react-native；CreateNodeWizardScreen 与 ck 测试共用。

export interface RuntimeLike {
  id: string;
  label: string;
  note?: string;
  models?: readonly string[];
  advancedOf?: string;
}

const norm = (value: string | null | undefined) => (value ?? '').trim().toLowerCase();

/** runtime 行是否命中搜索：id / 标签 / 说明都算。空查询 = 全命中。 */
export function runtimeMatchesQuery(runtime: RuntimeLike, query: string | null | undefined): boolean {
  const q = norm(query);
  if (!q) return true;
  return [runtime.id, runtime.label, runtime.note ?? ''].some(value => norm(value).includes(q));
}

/** 模型名是否命中搜索：`provider/model` 与裸 model 都能命中。 */
export function modelMatchesQuery(model: string, query: string | null | undefined): boolean {
  const q = norm(query);
  if (!q) return true;
  return norm(model).includes(q);
}

/** `provider/model` → provider；没有 `/` 时归到「其他」，不猜 provider。 */
export function modelProviderOf(model: string): string {
  const idx = model.indexOf('/');
  if (idx <= 0) return '其他';
  return model.slice(0, idx);
}

export interface ModelGroup {
  provider: string;
  count: number;
  models: string[];
}

/** 按 provider 分组：组序 = 首次出现顺序，组内保序；count = 组内模型数。 */
export function groupModelsByProvider(models: readonly string[]): ModelGroup[] {
  const buckets = new Map<string, string[]>();
  for (const model of models) {
    const provider = modelProviderOf(model);
    const bucket = buckets.get(provider);
    if (bucket) bucket.push(model);
    else buckets.set(provider, [model]);
  }
  return [...buckets.entries()].map(([provider, list]) => ({ provider, count: list.length, models: list }));
}

/** 搜索后的 provider 分组：空组不画。 */
export function filteredModelGroups(models: readonly string[], query: string | null | undefined): ModelGroup[] {
  const q = norm(query);
  const kept = q ? models.filter(model => modelMatchesQuery(model, query)) : [...models];
  return groupModelsByProvider(kept);
}
