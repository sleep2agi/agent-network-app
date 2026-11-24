// #5502 —— 聊天消息撤回与重新编辑纯逻辑（无 RN 依赖，可直接单测）。
import { copyTextOf } from './chat-actions';
import { taskExecutionState } from './task-execution';

export interface RecallableChatRow {
  task_id?: string | null;
  status?: string | null;
  content?: string | null;
  result?: string | null;
  reply?: string | null;
  meta?: unknown;
  meta_json?: string | null;
  _localId?: string;
  _proactive?: boolean;
  runtime_submitted_at?: string | null;
  consumed_at?: string | null;
}

export function parseTaskMetaObject(item?: Pick<RecallableChatRow, 'meta' | 'meta_json'> | null): Record<string, unknown> {
  if (!item) return {};
  if (item.meta && typeof item.meta === 'object' && !Array.isArray(item.meta)) {
    return item.meta as Record<string, unknown>;
  }
  if (typeof item.meta_json === 'string' && item.meta_json.trim()) {
    try {
      const parsed = JSON.parse(item.meta_json);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

export function isRecalledTask(item?: Pick<RecallableChatRow, 'meta' | 'meta_json'> | null): boolean {
  return parseTaskMetaObject(item).recalled === true;
}

export type RecallEligibility =
  | { readonly allowed: true; readonly needsInterrupt: boolean }
  | { readonly allowed: false; readonly reason: string };

const QUEUED_STATUSES = new Set(['created', 'delivered', 'acked', 'queued', 'pending']);
const RUNNING_STATUSES = new Set(['running', 'in_progress', 'started']);

/**
 * 判定一条聊天消息当前是否允许展示并执行「撤回」：
 * - 只能撤回自己发出的、已落 Hub（有 task_id）且尚未回复、尚未撤回的气泡；
 * - 排队中（created/delivered/acked）⇒ 直接原子撤回；
 * - 处理中（running / consumed）⇒ 仅当节点支持中断（turn_interrupt_capable）时允许「先中断再撤回」；
 * - 已回复 / 终态 ⇒ 不允许撤回。
 */
export function recallEligibility(opts: {
  item?: RecallableChatRow | null;
  kind?: 'sent' | 'reply';
  isMine: boolean;
  canInterrupt: boolean;
}): RecallEligibility {
  const { item, kind, isMine, canInterrupt } = opts;
  if (!item || kind !== 'sent' || !isMine) return { allowed: false, reason: 'not_own_sent' };
  if (item._proactive || item._localId || !item.task_id) return { allowed: false, reason: 'no_hub_task' };
  if (isRecalledTask(item)) return { allowed: false, reason: 'already_recalled' };
  if (item.result || item.reply) return { allowed: false, reason: 'already_replied' };

  const status = (item.status ?? '').toLowerCase();
  if (status === 'replied' || status === 'failed' || status === 'expired' || status === 'cancelled') {
    return { allowed: false, reason: 'terminal' };
  }
  const execState = taskExecutionState(item as any);
  if (RUNNING_STATUSES.has(status) || execState === 'consumed') {
    return canInterrupt
      ? { allowed: true, needsInterrupt: true }
      : { allowed: false, reason: 'running_no_interrupt' };
  }
  if (!status || QUEUED_STATUSES.has(status)) {
    return { allowed: true, needsInterrupt: false };
  }
  return { allowed: false, reason: 'unsupported_status' };
}

/** 撤回成功后在本地列表里乐观标记该行（保持现有 meta 字段，避免闪烁）。 */
export function markTaskRecalled<T extends RecallableChatRow>(item: T, recalledAt?: string | null): T {
  const nextMeta = {
    ...parseTaskMetaObject(item),
    recalled: true,
    recalled_at: recalledAt || new Date().toISOString(),
  };
  return {
    ...item,
    status: 'cancelled',
    meta: nextMeta,
    meta_json: JSON.stringify(nextMeta),
  };
}

/** 点「重新编辑」时填回输入框的文本：剥离可能的引用前缀，保留正文。 */
export function reeditContentOf(content?: string | null): string {
  if (!content) return '';
  const cleaned = copyTextOf(content);
  return cleaned || content.trim();
}
