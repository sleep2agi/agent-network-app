// 未送达消息 outbox(判据 C·App战线① PR3)。纯模块·持久化注入·可单测。
//
// 🔴 判据是那件事本身(通信龙):「杀掉 app 再开,未送达的消息还在、还能重试」——
// 不是「内存里有个 _failed 标记」。所以:
//   - **提交即落盘**(网络尝试之前):发送中被杀,重开后它还在;
//   - **只有 sendTask 确认成功才删**:失败/被杀都留着;
//   - ChatScreen 打开某会话时,把该会话的 outbox 条目并回消息列表(可重试)。
//
// 重开后 'pending' 条目一律恢复为 'failed':app 死在发送中,送没送到不可知——
// 诚实的做法是标「未送达」交用户决定重试(极端情况下可能重复发出,重复在聊天里
// 可见,比静默丢失好)。绝不把「命运未知」呈现成「已送达」。
//
// 附件限制(v1·PR 注明):只持久化文本内容;图片的本地缓存 URI 不保证活过重启,
// hadImage 标记让恢复后的气泡说明「图片附件未保存」,重试只发文本。

export interface OutboxEntry {
  id: string; // == ChatScreen 的 _localId,重试复用
  alias: string; // 目标会话
  content: string;
  createdAt: number;
  state: 'pending' | 'failed';
  hadImage?: boolean;
  priority?: 'high' | 'normal';
}

let entries: Record<string, OutboxEntry> = {};
let persist: ((all: OutboxEntry[]) => void) | null = null;

function flush(): void {
  if (persist) {
    try { persist(Object.values(entries)); } catch { /* best-effort */ }
  }
}

/** 启动时注入:saved=磁盘上的条目(重开恢复),persist=落盘写手。
 * A process exit while a request is in flight is ambiguous: the Hub may have
 * committed it before the HTTP acknowledgement was lost. Preserve `pending`
 * until ChatScreen reconciles against the authoritative task list. */
export function initOutbox(saved: OutboxEntry[] | null, persistFn: (all: OutboxEntry[]) => void): void {
  entries = {};
  for (const e of saved ?? []) {
    if (!e || !e.id || !e.alias) continue;
    // Pre-dreq app versions persisted every ambiguous timeout/restart as a
    // red failed local-* row. Those rows have no stable Hub correlation id,
    // cannot be retried idempotently, and accumulated across every chat. Retire
    // that legacy failed-state clutter once; current dreq rows remain eligible
    // for authoritative reconciliation and a real retry.
    if (e.state === 'failed' && !/^dreq_[a-f0-9]{32}$/.test(e.id)) continue;
    entries[e.id] = { ...e };
  }
  persist = persistFn;
  // Persist the migration immediately so retired legacy rows do not return on
  // the next launch even if no chat screen is opened in this process.
  flush();
}

/** 提交即登记(网络尝试之前调)。 */
export function outboxAdd(e: OutboxEntry): void {
  entries[e.id] = e;
  flush();
}

/** sendTask 确认成功——唯一的删除路径。 */
export function outboxRemove(id: string): void {
  if (!entries[id]) return;
  delete entries[id];
  flush();
}

export function outboxMarkFailed(id: string): void {
  const e = entries[id];
  if (!e || e.state === 'failed') return;
  entries[id] = { ...e, state: 'failed' };
  flush();
}

/** 重试前标回 pending(仍在盘上——重试中被杀照样恢复)。 */
export function outboxMarkPending(id: string, createdAt = Date.now()): void {
  const e = entries[id];
  if (!e) return;
  entries[id] = { ...e, state: 'pending', createdAt };
  flush();
}

export function outboxForAlias(alias: string): OutboxEntry[] {
  return Object.values(entries)
    .filter((e) => e.alias === alias)
    .sort((a, b) => a.createdAt - b.createdAt);
}

// 无订阅机制(PR3 review②):「ChatScreen 早于 initOutbox 挂载」的竞态不存在——
// App.tsx 的 `booting` 早返回把所有 screen 挡在 initOutbox 完成之后。🔴 若将来拆掉
// booting 门,这里就断了根线:届时需要订阅/重并入机制(或别的 mount-after-init 保证)。

/** Test-only. */
export function __resetOutboxForTest(): void {
  entries = {};
  persist = null;
}
