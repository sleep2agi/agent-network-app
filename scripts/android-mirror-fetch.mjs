// Transport retries only: identity conflicts are validated by callers and never retried.
export function mirrorFetch({ fetchImpl = fetch, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  return async (url, options = {}) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetchImpl(url, { ...options,
          headers: { ...options.headers, 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(120000) });
        if (response.ok || response.status === 404) return response;
        await response.body?.cancel();
      } catch {
        // A transient fetch/timeout failure is distinct from a source mismatch.
      }
      if (attempt < 2) await wait(2000);
    }
    throw new Error('读不到安卓发布记录（镜像暂时不可用），不是提交冲突，请重跑');
  };
}
