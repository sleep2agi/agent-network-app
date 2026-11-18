import { useCallback, useSyncExternalStore } from 'react';
import { getDownloadJob, subscribeDownloadJob, type DownloadJobState } from './download-jobs';

/** 订阅一个附件的下载任务;卡片卸载再挂载(切会话回来)时直接拿到当前进度或结果。 */
export function useDownloadJob(key: string): DownloadJobState | undefined {
  const subscribe = useCallback((cb: () => void) => subscribeDownloadJob(key, cb), [key]);
  const get = useCallback(() => getDownloadJob(key), [key]);
  return useSyncExternalStore(subscribe, get, get);
}
