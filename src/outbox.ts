// 未送达消息 outbox(判据 C·App战线① PR3)。纯模块·持久化注入·可单测。
//
// 🔴 判据是那件事本身(通信龙):「杀掉 app 再开,未送达的消息还在、还能重试」——
// 不是「内存里有个 _failed 标记」。所以:
//   - **提交即落盘**(网络尝试之前):发送中被杀,重开后它还在;
//   - **只有 sendTask 确认成功才删**:失败/被杀都留着;
//   - ChatScreen 打开某会话时,把该会话的 outbox 条目并回消息列表(可重试)。
//
// 重开后 'pending' 条目一律恢复为 'failed'(#518:由 ChatScreen 打开会话时按 send-lifecycle 的孤儿判据做,
// 先保留 pending 只为让同一次 load 能先按 client_request_id 对掉 hub 已收的):app 死在发送中,送没送到不可知——
// 诚实的做法是标「未送达」交用户决定重试(极端情况下可能重复发出,重复在聊天里
// 可见,比静默丢失好)。绝不把「命运未知」呈现成「已送达」。
//
// 附件(#527「图片发送失败，我点击重新发送它那个图片并不会去重新发送」):
//   旧版只持久化文本 + hadImage 标记,任何「从 outbox 重建回显」(切会话再切回、两栏重挂、主题/密度
//   重 key、杀 app 重开)都把图片丢了 —— 重试只发出「[附件] x.png」这行字。现在:
//   - attachments 与气泡里的图同序,能活过重启的本地 uri(file:// 等,非 blob:/data:)和已传成功的
//     hub 文件(uploaded)都落盘;重试复用 uploaded,不重传;
//   - liveImages 是本进程内的原始 PickedImage(含 web/Tauri 的 Blob),重挂后靠它保住预览与重传;
//   - 都拿不回来的图 = 丢了:重试拒发(绝不发出只剩文字的半条),见 resend-plan.ts。

export interface OutboxEntry {
  id: string; // == ChatScreen 的 _localId,重试复用
  alias: string; // 目标会话
  content: string;
  createdAt: number;
  state: 'pending' | 'failed';
  hadImage?: boolean;
  priority?: 'high' | 'normal';
  /** 发送时的「原图」开关;重试沿用它。 */
  original?: boolean;
  /** 与气泡里的图同序(#527)。缺省 = 纯文本消息,或旧版本落的盘(只有 hadImage)。 */
  attachments?: OutboxAttachment[];
}

export interface OutboxUploaded {
  file_id: string;
  path: string;
  url: string;
  size: number;
  mime: string;
}

export interface OutboxAttachment {
  fileName: string;
  mimeType: string;
  fileSize?: number;
  width?: number;
  height?: number;
  /** 能活过重启的本地 uri(blob:/data: 只在本进程有效,不落盘)。 */
  uri?: string;
  /** 这张已经传上 hub:重试直接用它的 file_id,不重传。name/mime 是上传时(压缩后)的那一份。 */
  uploaded?: { name: string; mime: string; up: OutboxUploaded };
}

/** 本进程内的原图(PickedImage 形状;这里不 import attach.ts,保持纯模块)。 */
export interface OutboxLiveImage {
  uri: string;
  fileName: string;
  mimeType: string;
  fileSize?: number;
  width?: number;
  height?: number;
}

/** blob:/data: 是进程内句柄(或巨大的内联字节),不能当「重开后还能读」的地址落盘。 */
export const persistableUri = (uri: string | undefined): string | undefined =>
  uri && !/^(blob:|data:)/i.test(uri) ? uri : undefined;

export const describeAttachments = (imgs: readonly OutboxLiveImage[]): OutboxAttachment[] =>
  imgs.map(img => {
    const a: OutboxAttachment = { fileName: img.fileName, mimeType: img.mimeType };
    if (typeof img.fileSize === 'number') a.fileSize = img.fileSize;
    if (typeof img.width === 'number') a.width = img.width;
    if (typeof img.height === 'number') a.height = img.height;
    const uri = persistableUri(img.uri);
    if (uri) a.uri = uri;
    return a;
  });

let entries: Record<string, OutboxEntry> = {};
let liveImages: Record<string, OutboxLiveImage[]> = {};
let persist: ((all: OutboxEntry[]) => void) | null = null;

const listeners = new Set<() => void>();
let notifyQueued = false;

function flush(): void {
  if (persist) {
    try { persist(Object.values(entries)); } catch { /* best-effort */ }
  }
  // #518: a mounted ChatScreen re-derives its echoes from the outbox when another instance's send
  // settles. Deferred to a microtask so a caller that adds an entry and starts its send in the same
  // tick is already marked in-flight when listeners look (send-lifecycle.ts).
  if (listeners.size && !notifyQueued) {
    notifyQueued = true;
    queueMicrotask(() => {
      notifyQueued = false;
      for (const l of [...listeners]) { try { l(); } catch { /* a listener must not break the outbox */ } }
    });
  }
}

/** A send settled without changing the outbox (e.g. it was already removed): let listeners re-derive. */
export function notifyOutboxListeners(): void {
  const persistFn = persist;
  persist = null;
  try { flush(); } finally { persist = persistFn; }
}

/** Called after any outbox change. Returns the unsubscribe function. */
export function subscribeOutbox(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function outboxEntry(id: string): OutboxEntry | undefined {
  return entries[id];
}

/** 启动时注入:saved=磁盘上的条目(重开恢复),persist=落盘写手。
 * A process exit while a request is in flight is ambiguous: the Hub may have
 * committed it before the HTTP acknowledgement was lost. Preserve `pending`
 * until ChatScreen reconciles against the authoritative task list. */
export function initOutbox(saved: OutboxEntry[] | null, persistFn: (all: OutboxEntry[]) => void): void {
  entries = {};
  liveImages = {};
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

/** 提交即登记(网络尝试之前调)。带图时传 imgs:描述落盘,原件留在本进程(#527)。 */
export function outboxAdd(e: OutboxEntry, imgs?: readonly OutboxLiveImage[]): void {
  if (imgs && imgs.length) {
    entries[e.id] = { ...e, hadImage: true, attachments: e.attachments ?? describeAttachments(imgs) };
    liveImages[e.id] = [...imgs];
  } else {
    entries[e.id] = e;
  }
  flush();
}

/** sendTask 确认成功——唯一的删除路径。 */
export function outboxRemove(id: string): void {
  if (!entries[id]) return;
  delete entries[id];
  delete liveImages[id];
  flush();
}

/** 本进程内这条消息的原图(重挂后恢复预览、重传用)。重启后为 undefined。 */
export function outboxLiveImages(id: string): OutboxLiveImage[] | undefined {
  return liveImages[id];
}

/** 第 index 张已传上 hub(#527):落盘,之后的重试(含杀 app 重开后)复用 file_id、不重传。 */
export function outboxRecordUpload(id: string, index: number, name: string, mime: string, up: OutboxUploaded): void {
  const e = entries[id];
  const list = e?.attachments;
  if (!e || !list || index < 0 || index >= list.length) return;
  const { file_id, path, url, size } = up;
  const next = list.map((a, i) => (i === index ? { ...a, uploaded: { name, mime, up: { file_id, path, url, size, mime: up.mime } } } : a));
  entries[id] = { ...e, attachments: next };
  flush();
}

/** 第 index 张已传上的 hub 文件,没有则 undefined。 */
export function outboxUploadedAt(id: string, index: number): OutboxAttachment['uploaded'] {
  return entries[id]?.attachments?.[index]?.uploaded;
}

/** 失败消息里用户删掉第 index 张(与气泡同步,否则下标错位)。 */
export function outboxRemoveAttachment(id: string, index: number): void {
  const e = entries[id];
  if (!e) return;
  if (e.attachments) {
    const attachments = e.attachments.filter((_, i) => i !== index);
    entries[id] = { ...e, attachments, hadImage: attachments.length > 0 };
  }
  if (liveImages[id]) liveImages[id] = liveImages[id].filter((_, i) => i !== index);
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
  liveImages = {};
  persist = null;
  listeners.clear();
}
