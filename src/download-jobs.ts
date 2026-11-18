// 附件下载任务表 —— 纯逻辑层(无 RN 依赖, bun 直跑, 见 download-jobs.test.ts)。
//
// admin 2026-11-18「我切换会话之后,点击下载就不能在后台下载了吗?」:
// 原来下载状态放在附件卡片组件自己的 useState 里。切会话 = 卡片卸载,
//   - 进度、「已保存到…」全丢,回来看是一张「点击下载」的新卡,像是下载被掐了;
//   - 再点一次就并发起第二个下载;移动端第二次会先删同名 .part,把还在跑的第一次弄坏。
// 现在下载任务挂在模块级的表里,按附件(服务器 + 凭据作用域 + 文件)记,和界面生命周期无关:
// 卡片卸载不影响下载继续跑完;回到会话时卡片重新订阅,看到的是真实进度或结果;
// 同一个附件正在下载时再点,复用同一个任务,不会再起一个。

export type DownloadJobState =
  | { kind: 'downloading'; progress?: string }
  | { kind: 'done'; result: string }
  | { kind: 'error'; message: string };

type Entry = { state: DownloadJobState; promise?: Promise<string> };

const jobs = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();

const notify = (key: string) => {
  for (const cb of listeners.get(key) ?? []) {
    try { cb(); } catch { /* 一个订阅者出错不影响其他 */ }
  }
};

const set = (key: string, entry: Entry) => {
  jobs.set(key, entry);
  notify(key);
};

export function getDownloadJob(key: string): DownloadJobState | undefined {
  return jobs.get(key)?.state;
}

export function subscribeDownloadJob(key: string, cb: () => void): () => void {
  let set_ = listeners.get(key);
  if (!set_) { set_ = new Set(); listeners.set(key, set_); }
  set_.add(cb);
  return () => {
    const s = listeners.get(key);
    if (!s) return;
    s.delete(cb);
    if (s.size === 0) listeners.delete(key);
  };
}

/**
 * 跑(或复用)一个下载任务。`run` 拿到 `report` 用来报人话进度。
 * - 同 key 正在下载:返回同一个 promise,不重复下载;
 * - 其余情况(没有、已完成、失败):重新开始 —— 「重试」「另存为」都走这条。
 * 任务的结果和失败都留在表里,直到下一次 run 或 clear。
 */
export function runDownloadJob(key: string, run: (report: (progress?: string) => void) => Promise<string>): Promise<string> {
  const current = jobs.get(key);
  if (current?.state.kind === 'downloading' && current.promise) return current.promise;
  const report = (progress?: string) => {
    const entry = jobs.get(key);
    if (!entry || entry.promise !== promise || entry.state.kind !== 'downloading') return;
    if (entry.state.progress === progress) return;
    set(key, { state: { kind: 'downloading', progress }, promise });
  };
  const promise: Promise<string> = Promise.resolve().then(() => run(report)).then(
    (result) => {
      if (jobs.get(key)?.promise === promise) set(key, { state: { kind: 'done', result } });
      return result;
    },
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (jobs.get(key)?.promise === promise) set(key, { state: { kind: 'error', message } });
      throw error;
    },
  );
  set(key, { state: { kind: 'downloading' }, promise });
  return promise;
}

/** 把一个附件的任务状态清回「没下载过」(不打断正在跑的下载,它跑完也不再写回)。 */
export function clearDownloadJob(key: string): void {
  if (!jobs.has(key)) return;
  jobs.delete(key);
  notify(key);
}

/** 只给测试用。 */
export function resetDownloadJobsForTest(): void {
  jobs.clear();
  listeners.clear();
}
