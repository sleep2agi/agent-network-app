// 多图发送的上传队列(纯逻辑,不依赖 RN):
// - 并发受限(默认 3),结果按输入顺序返回 —— 一条消息里的图片顺序 = 选择顺序;
// - 一张失败不打断其它张(取证要全集:用户要看到到底哪几张没传上);
// - 调用方据 failed 决定「整条不发」,绝不静默发出缺图的半条消息;
// - memo:重试时已传成功的那几张不再重传。

export const UPLOAD_CONCURRENCY = 3;

export type UploadStatus = 'queued' | 'uploading' | 'done' | 'failed';
export interface UploadState {
  status: UploadStatus;
  error?: string;
}

export interface UploadQueueResult<R> {
  /** 与输入同序;失败的位置为 undefined。 */
  results: (R | undefined)[];
  /** 与输入同序;成功的位置为 undefined。 */
  errors: (string | undefined)[];
  /** 失败项的下标(升序)。 */
  failed: number[];
}

const describe = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return message || '上传失败';
};

export async function runUploadQueue<T, R>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<R>,
  options: { concurrency?: number; onState?: (index: number, state: UploadState) => void } = {},
): Promise<UploadQueueResult<R>> {
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? UPLOAD_CONCURRENCY));
  const results: (R | undefined)[] = new Array(items.length).fill(undefined);
  const errors: (string | undefined)[] = new Array(items.length).fill(undefined);
  const emit = (index: number, state: UploadState) => {
    try { options.onState?.(index, state); } catch { /* UI 回调出错不能拖垮上传 */ }
  };
  items.forEach((_, index) => emit(index, { status: 'queued' }));
  let cursor = 0;
  const lane = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      emit(index, { status: 'uploading' });
      try {
        results[index] = await worker(items[index], index);
        emit(index, { status: 'done' });
      } catch (error) {
        errors[index] = describe(error);
        emit(index, { status: 'failed', error: errors[index] });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, lane));
  const failed = errors.map((e, i) => (e === undefined ? -1 : i)).filter(i => i >= 0);
  return { results, errors, failed };
}

/** 失败汇总,显示在「未送达」下方:「2 张附件上传失败：a.jpg（超时）、b.png（…）」。 */
export const uploadFailureSummary = (names: readonly string[], errors: readonly (string | undefined)[]): string | null => {
  const parts = errors
    .map((error, i) => (error === undefined ? null : `${names[i] ?? `第 ${i + 1} 个`}（${error}）`))
    .filter((p): p is string => !!p);
  if (!parts.length) return null;
  return `${parts.length} 个附件上传失败：${parts.join('、')}`;
};

/** 重试不重传:按 (hub, 本地 uri, 原图档) 记住已上传结果。换 hub / 换档都要重传。 */
export const createUploadMemo = <R>() => {
  const map = new Map<string, R>();
  const key = (serverUrl: string, uri: string, original: boolean) => `${serverUrl}\u0000${original ? 'orig' : 'std'}\u0000${uri}`;
  return {
    get: (serverUrl: string, uri: string, original: boolean) => map.get(key(serverUrl, uri, original)),
    set: (serverUrl: string, uri: string, original: boolean, value: R) => { map.set(key(serverUrl, uri, original), value); },
    size: () => map.size,
  };
};

/** 按下标替换一个状态,缺的位置补 queued(纯函数,给 setMessages 用)。 */
export const withUploadState = (
  current: readonly UploadState[] | undefined,
  length: number,
  index: number,
  state: UploadState,
): UploadState[] => {
  const next: UploadState[] = Array.from({ length }, (_, i) => current?.[i] ?? { status: 'queued' });
  if (index >= 0 && index < length) next[index] = state;
  return next;
};

/** 从一条失败消息里移除第 index 个附件(连同它的上传状态)。 */
export const removeAttachmentAt = <T>(imgs: readonly T[], states: readonly UploadState[] | undefined, index: number) => ({
  imgs: imgs.filter((_, i) => i !== index),
  states: states ? states.filter((_, i) => i !== index) : undefined,
});
