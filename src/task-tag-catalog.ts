// 标签目录与标签管理(Hub capability tag_ops:POST /api/requirements/tags/ops)。
// 标签本身只是卡片 tags 数组里的字符串;Hub 另存可选的颜色,并在 GET /api/requirements/tags 带回
// counts(每个标签用了几张卡)/ colors / can_manage。旧 Hub 只回 tags:这里照样能读(做补全),
// 但 ops = false,界面不给「管理标签」。
import { ACCEPT_COLUMNS_HEADERS } from './requirement-columns';
import type { HubConfig } from './api';
import { appFetch } from './app-fetch';
import { withDeadline } from './deadline';
import { normalizeTags } from './requirement-tags';
import { PROJECT_COLORS } from './task-board-model';

export const TAG_OPS_CAPABILITY = 'tag_ops';
/** 标签颜色的调色板:与项目同一套。 */
export const TAG_COLORS = PROJECT_COLORS;
export const MAX_MERGE_SOURCES = 50;

export interface TagCatalog {
  tags: string[];
  /** 每个标签用在几张卡上(调用者看得见的,含归档)。旧 Hub 没有 → 空。 */
  counts: Record<string, number>;
  colors: Record<string, string>;
  /** Hub 支持 tags/ops 且这个调用者能用(owner / 管理员 / 全部任务的成员)。 */
  canManage: boolean;
  /** Hub 有 tags/ops(回了 can_manage 字段)。 */
  ops: boolean;
}

export type TagOp =
  | { op: 'rename'; from: string; to: string }
  | { op: 'merge'; from: string[]; to: string }
  | { op: 'delete'; tag: string }
  | { op: 'color'; tag: string; color: string | null };

const COLOR = /^#[0-9a-fA-F]{6}$/;

export function catalogFromHub(data: unknown): TagCatalog | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.tags)) return null;
  const tags = d.tags.filter((x): x is string => typeof x === 'string');
  const counts: Record<string, number> = {};
  if (d.counts && typeof d.counts === 'object') for (const [k, v] of Object.entries(d.counts as Record<string, unknown>)) if (typeof v === 'number' && v >= 0) counts[k] = v;
  const colors: Record<string, string> = {};
  if (d.colors && typeof d.colors === 'object') for (const [k, v] of Object.entries(d.colors as Record<string, unknown>)) if (typeof v === 'string' && COLOR.test(v)) colors[k] = v.toLowerCase();
  const ops = typeof d.can_manage === 'boolean';
  return { tags, counts, colors, ops, canManage: d.can_manage === true };
}

/** 能不能在界面上给「管理标签」:列表的 capabilities 带 tag_ops,且 Hub 说这个人能管。 */
export const canManageTags = (capabilities: readonly string[], catalog: TagCatalog | null): boolean =>
  capabilities.includes(TAG_OPS_CAPABILITY) && !!catalog?.ops && catalog.canManage;

const scopedPath = (cfg: HubConfig, path: string) => (cfg.networkId ? `${path}?network_id=${encodeURIComponent(cfg.networkId)}` : path);

export async function fetchTagCatalog(cfg: HubConfig, deadlineMs = 15_000): Promise<TagCatalog | null> {
  const got = await withDeadline((async () => {
    const res = await appFetch(`${cfg.serverUrl}${scopedPath(cfg, '/api/requirements/tags')}`, { headers: { Authorization: `Bearer ${cfg.token}`, ...ACCEPT_COLUMNS_HEADERS } });
    if (!res.ok) return null;
    return catalogFromHub(await res.json().catch(() => null));
  })(), deadlineMs, () => null);
  return got ?? null;
}

/** Hub 错误码 → 界面文案的 key(i18n-task-tags.ts)。 */
export function tagOpErrorKey(status: number, error?: string): string {
  if (error === 'invalid_tag') return 'tags.invalidName';
  if (error === 'invalid_tag_color') return 'tags.invalidColor';
  if (error === 'same_tag') return 'tags.sameTag';
  if (error === 'tag_not_found' || status === 404) return 'tags.notFound';
  if (status === 403) return 'tags.noPermission';
  return 'tags.opFailed';
}

export class TagOpError extends Error {
  constructor(public key: string, public status: number) { super(key); }
}

export async function runTagOp(cfg: HubConfig, op: TagOp, deadlineMs = 20_000): Promise<{ affected: number }> {
  const got = await withDeadline((async () => {
    const res = await appFetch(`${cfg.serverUrl}${scopedPath(cfg, '/api/requirements/tags/ops')}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json', ...ACCEPT_COLUMNS_HEADERS },
      body: JSON.stringify(op),
    });
    return { status: res.status, data: await res.json().catch(() => null) as any };
  })(), deadlineMs, () => null);
  if (!got) throw new TagOpError('tags.opTimeout', 0);
  if (got.status !== 200 || got.data?.ok !== true) throw new TagOpError(tagOpErrorKey(got.status, got.data?.error), got.status);
  return { affected: typeof got.data.affected === 'number' ? got.data.affected : 0 };
}

/** 单个标签名(规则同 Hub):去首尾空格,1–20 个码位,无控制字符。不合法 = null。 */
export function tagName(value: string): string | null {
  const tags = normalizeTags([value]);
  return tags && tags.length === 1 ? tags[0] : null;
}

/** 与 Hub 同一个改写规则:位置保留、去重;没变 = null。成功后先在本地改,下一轮轮询对齐。 */
export function applyTagOp(tags: readonly string[], op: TagOp): string[] | null {
  if (op.op === 'color') return null;
  const sources = op.op === 'rename' ? [op.from] : op.op === 'merge' ? op.from : [op.tag];
  const to = op.op === 'delete' ? null : op.to;
  if (!tags.some(tag => sources.includes(tag))) return null;
  const next: string[] = [];
  for (const tag of tags) {
    const mapped = sources.includes(tag) ? to : tag;
    if (mapped !== null && !next.includes(mapped)) next.push(mapped);
  }
  return next;
}

/** 操作成功后目录的样子(用量按卡重算前的近似:来源的用量并进目标,上限是 affected)。 */
export function applyTagOpToCatalog(cat: TagCatalog, op: TagOp): TagCatalog {
  const colors = { ...cat.colors };
  if (op.op === 'color') {
    if (op.color) colors[op.tag] = op.color.toLowerCase(); else delete colors[op.tag];
    return { ...cat, colors };
  }
  const sources = op.op === 'rename' ? [op.from] : op.op === 'merge' ? op.from : [op.tag];
  const counts = { ...cat.counts };
  let moved = 0;
  for (const tag of sources) { moved += counts[tag] ?? 0; delete counts[tag]; }
  if (op.op !== 'delete') {
    counts[op.to] = (counts[op.to] ?? 0) + moved;
    if (!colors[op.to]) { const inherited = sources.map(t => colors[t]).find(Boolean); if (inherited) colors[op.to] = inherited; }
  }
  for (const tag of sources) delete colors[tag];
  const tags = [...new Set([...cat.tags.filter(t => !sources.includes(t)), ...(op.op === 'delete' ? [] : [op.to])])].sort();
  return { ...cat, tags, counts, colors };
}

/**
 * 输入框补全:已有标签里匹配输入的(前缀优先,其次包含;同档按用量多→少,再按名字),去掉卡上已有的。
 * 输入为空 = 最常用的几个。
 */
export function tagSuggestions(all: readonly string[], counts: Readonly<Record<string, number>>, current: readonly string[], query: string, limit = 8): string[] {
  const q = query.trim().toLocaleLowerCase();
  const rank = (tag: string) => {
    const t = tag.toLocaleLowerCase();
    if (!q) return 1;
    if (t === q) return 0;
    if (t.startsWith(q)) return 1;
    return t.includes(q) ? 2 : -1;
  };
  return [...new Set(all)]
    .filter(tag => !current.includes(tag) && rank(tag) >= 0)
    .sort((a, b) => rank(a) - rank(b) || (counts[b] ?? 0) - (counts[a] ?? 0) || a.localeCompare(b))
    .slice(0, limit);
}

/** 本地卡片上的用量(侧栏的数字按当前列表算,与项目的数字同一口径)。 */
export function localTagCounts(items: readonly { tags?: readonly string[] }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const item of items) for (const tag of item.tags ?? []) m.set(tag, (m.get(tag) ?? 0) + 1);
  return m;
}
