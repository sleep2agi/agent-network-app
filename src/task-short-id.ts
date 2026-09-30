// 任务短号(Hub capabilities 含 requirement_seq 起):每个网络自己的 #1、#2…,主键 req_<uuid> 太长不显示。
// 旧 Hub 没有 seq:列表 / 看板什么都不加,只有详情头显示 uuid 前 8 位(点了复制完整 ID)。
import { registerTranslations } from './i18n';
import type { Requirement } from './requirements-model';

registerTranslations({
  'fields.seq': ['ID', 'ID'],
  'taskId.copyShort': ['复制 {id}', 'Copy {id}'],
  'taskId.copyFull': ['复制完整 ID', 'Copy full ID'],
  'taskId.copied': ['已复制', 'Copied'],
  'taskId.copiedFull': ['已复制完整 ID', 'Full ID copied'],
});

export const SEQ_CAPABILITY = 'requirement_seq';

/** Hub 给的短号:正整数才算;别的形状当没有。 */
export function seqFromHub(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** 列表 / 看板 / 详情显示的「#42」;没有短号 = null(不显示任何东西)。 */
export function shortIdLabel(item: Pick<Requirement, 'seq'>): string | null {
  return typeof item.seq === 'number' && item.seq > 0 ? `#${item.seq}` : null;
}

/** 旧 Hub 的详情头:uuid 前 8 位(去掉 req_ 前缀)。 */
export function idPrefix(id: string): string {
  return id.replace(/^req_/, '').replace(/-/g, '').slice(0, 8);
}

/**
 * 搜索:「#42」或「42」精确对短号;完整 id,或 8 位以上的 id 前缀(带不带 req_ 都行)对主键。
 * 空串 / 太短的前缀不算命中,免得输入「1」时把所有 id 里含 1 的都搜出来。
 */
export function matchesTaskId(item: Pick<Requirement, 'id' | 'seq'>, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  const n = /^#?(\d{1,15})$/.exec(q);
  if (n) return typeof item.seq === 'number' && item.seq === Number(n[1]);
  const id = item.id.toLowerCase();
  if (q === id) return true;
  const bare = q.replace(/^req_/, '');
  return bare.length >= 8 && id.replace(/^req_/, '').startsWith(bare);
}

/** 排序:短号升序;没有短号的永远在最后(同空期限)。 */
export function seqCmp(a: Pick<Requirement, 'seq'>, b: Pick<Requirement, 'seq'>, sign: 1 | -1): number {
  const av = typeof a.seq === 'number' ? a.seq : null, bv = typeof b.seq === 'number' ? b.seq : null;
  if (av === null || bv === null) return av === bv ? 0 : av === null ? 1 : -1;
  return (av - bv) * sign;
}
