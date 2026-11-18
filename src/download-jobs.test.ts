import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { clearDownloadJob, getDownloadJob, resetDownloadJobsForTest, runDownloadJob, subscribeDownloadJob } from './download-jobs';

// admin 2026-11-18「我切换会话之后,点击下载就不能在后台下载了吗?」
// 下载状态原来在卡片组件的 useState 里,切会话卸载就丢;再点会并发第二次下载。

const deferred = <T,>() => {
  let resolve!: (v: T) => void; let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
const tick = () => new Promise((r) => setTimeout(r, 0));

const tests: [string, () => Promise<void> | void][] = [];
const test = (name: string, fn: () => Promise<void> | void) => tests.push([name, fn]);
{

  test('job outlives its subscriber: a card that unmounts mid-download sees the result when it comes back', async () => {
    const d = deferred<string>();
    const unsubscribe = subscribeDownloadJob('k', () => {});
    const run = runDownloadJob('k', () => d.promise);
    assert.deepEqual(getDownloadJob('k'), { kind: 'downloading' });
    unsubscribe(); // 切会话:卡片卸载
    d.resolve('/Downloads/video.mp4');
    await run;
    // 回到会话:新卡片读到的是结果,不是「点击下载」
    assert.deepEqual(getDownloadJob('k'), { kind: 'done', result: '/Downloads/video.mp4' });
  });

  test('pressing again while downloading reuses the running job instead of starting a second download', async () => {
    const d = deferred<string>();
    let starts = 0;
    const a = runDownloadJob('k', () => { starts++; return d.promise; });
    const b = runDownloadJob('k', () => { starts++; return Promise.resolve('other'); });
    assert.equal(b, a);
    d.resolve('x');
    await a; await tick();
    assert.equal(starts, 1);
  });

  test('progress reports reach subscribers and survive remount', async () => {
    const d = deferred<string>();
    let report!: (p?: string) => void;
    const seen: unknown[] = [];
    const unsub = subscribeDownloadJob('k', () => seen.push(getDownloadJob('k')));
    const run = runDownloadJob('k', (r) => { report = r; return d.promise; });
    await tick();
    report('40% · 剩余约 8 秒');
    unsub();
    assert.deepEqual(getDownloadJob('k'), { kind: 'downloading', progress: '40% · 剩余约 8 秒' });
    assert.ok(seen.some((x) => JSON.stringify(x) === JSON.stringify({ kind: 'downloading', progress: '40% · 剩余约 8 秒' })));
    d.resolve('ok'); await run;
  });

  test('failure is kept for the card to show, and a retry starts a fresh job', async () => {
    const run = runDownloadJob('k', () => Promise.reject(new Error('下载失败：服务端返回 404')));
    await assert.rejects(run, /404/);
    assert.deepEqual(getDownloadJob('k'), { kind: 'error', message: '下载失败：服务端返回 404' });
    await runDownloadJob('k', () => Promise.resolve('ok'));
    assert.deepEqual(getDownloadJob('k'), { kind: 'done', result: 'ok' });
  });

  test('cleared job does not get overwritten by the stale download finishing later', async () => {
    const d = deferred<string>();
    const run = runDownloadJob('k', () => d.promise);
    clearDownloadJob('k');
    d.resolve('late');
    await run;
    assert.equal(getDownloadJob('k'), undefined);
  });

  test('attachment cards keep download state in the job table, not component state', () => {
    for (const file of ['./AttachmentFileDesktop.tsx', './AuthedThumb.tsx']) {
      const src = readFileSync(new URL(file, import.meta.url), 'utf8');
      assert.ok(src.includes('useDownloadJob('), file);
      assert.ok(src.includes('runDownloadJob('), file);
    }
    const thumb = readFileSync(new URL('./AuthedThumb.tsx', import.meta.url), 'utf8');
    // 卡片离开屏幕后,下载完成不能突然弹分享面板
    assert.ok(thumb.includes('if (!mounted.current) return;'));
  });
}

let passed = 0;
for (const [name, fn] of tests) {
  resetDownloadJobsForTest();
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.log(`  ✗ ${name}\n    ${e instanceof Error ? e.message : String(e)}`); }
}
console.log(`download-jobs: ${passed}/${tests.length} passed`);
process.exit(passed === tests.length ? 0 : 1);
