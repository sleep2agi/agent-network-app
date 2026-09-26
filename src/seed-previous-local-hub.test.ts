// app#389: Windows 发版冒烟里 `previous Hub did not become healthy: fetch failed`
// 偶发红灯(0.2.102 / .104 / .106),重跑就过。根因是等待只有固定 8 秒、没有退避,
// 且 Hub 的 stdout/stderr 被 stdio:'ignore' 丢掉,失败时无从判断。
// 这里用真 HTTP 假 Hub 覆盖两条路径:晚健康的能等到 / 永远不健康的会失败并打日志尾部。
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {
  HEALTH_BACKOFF_INITIAL_MS,
  HEALTH_BACKOFF_MAX_MS,
  HEALTH_TIMEOUT_MS,
  LOG_TAIL_LINES,
  printHubLogTail,
  readLogTail,
  waitForHealth,
} from '../scripts/seed-previous-local-hub.mjs';

let passed = 0;
let total = 0;
const check = (name: string, condition: boolean) => {
  total += 1;
  if (condition) {
    passed += 1;
    console.log('✅', name);
  } else {
    console.error('❌', name);
  }
};

const FAKE_VERSION = '0.9.9-seed-hub-389';

const listen = (server: http.Server) =>
  new Promise<number>((resolvePort, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('fake hub bound to a non-TCP address'));
        return;
      }
      resolvePort(address.port);
    });
  });

const close = (server: http.Server) =>
  new Promise<void>(resolveClose => server.close(() => resolveClose()));

const run = async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-hub-389-'));
  const logPath = path.join(tmp, 'previous-hub.log');
  // 60 行、行号补零:尾部 50 行必须是 011..060,这样「只打尾部」可以被精确断言。
  fs.writeFileSync(
    logPath,
    `${Array.from({ length: 60 }, (_, i) => `hub line-${String(i + 1).padStart(3, '0')}`).join('\n')}\n`,
  );

  check('健康等待窗口 ≥ 60 秒(原为固定 8 秒)', HEALTH_TIMEOUT_MS >= 60_000);
  check('等待带退避(上限高于起始间隔,不是固定 100ms)', HEALTH_BACKOFF_MAX_MS > HEALTH_BACKOFF_INITIAL_MS);
  check('日志尾部固定 50 行', LOG_TAIL_LINES === 50);
  check(
    '读不到的日志返回 null 而不是抛错',
    readLogTail(path.join(tmp, 'missing.log')) === null,
  );

  // ── 案例 1:假 Hub 3 秒后才变健康,必须等到它 ────────────────────────────
  let healthy = false;
  const hits: number[] = [];
  const slowHub = http.createServer((request, response) => {
    hits.push(Date.now());
    response.setHeader('Content-Type', 'application/json');
    if (healthy) {
      response.end(JSON.stringify({ ok: true, version: FAKE_VERSION }));
      return;
    }
    response.statusCode = 503;
    response.end(JSON.stringify({ ok: false, error: 'NOT_READY' }));
  });
  const port = await listen(slowHub);
  setTimeout(() => { healthy = true; }, 3000);

  try {
    const startedAt = Date.now();
    await waitForHealth({
      endpoint: `http://127.0.0.1:${port}`,
      previousVersion: FAKE_VERSION,
      logPath,
      timeoutMs: HEALTH_TIMEOUT_MS,
    });
    const elapsed = Date.now() - startedAt;
    check('3 秒后才健康的假 Hub 能等到', elapsed >= 3000);
    check('健康后立刻返回(不会白等满超时窗口)', elapsed < 20_000);
    check('等待期间持续重试(退避轮询,不是单次探测)', hits.length >= 3);
  } catch (error) {
    check(
      `3 秒后才健康的假 Hub 能等到(抛错了: ${error instanceof Error ? error.message : String(error)})`,
      false,
    );
  } finally {
    await close(slowHub);
  }

  // ── 案例 2:永远不健康的假 Hub → 失败,且打印日志最后 50 行 ─────────────
  // 用「刚关掉的端口」复现生产症状:连不上,failures 的原文就是 fetch failed。
  const probe = http.createServer();
  const deadPort = await listen(probe);
  await close(probe);

  const chunks: string[] = [];
  const fakeStderr = {
    write: (chunk: string) => {
      chunks.push(String(chunk));
      return true;
    },
  } as unknown as NodeJS.WriteStream;

  const timeoutMs = 800;
  let failure: unknown;
  const startedAt = Date.now();
  try {
    await waitForHealth({
      endpoint: `http://127.0.0.1:${deadPort}`,
      previousVersion: FAKE_VERSION,
      logPath,
      timeoutMs,
      stderr: fakeStderr,
    });
  } catch (error) {
    failure = error;
  }
  const elapsed = Date.now() - startedAt;
  const printed = chunks.join('');

  check(
    '永远不健康的假 Hub 会失败',
    failure instanceof Error
      && failure.message.startsWith('previous Hub did not become healthy:'),
  );
  check('失败是等到超时窗口耗尽才发生的', elapsed >= timeoutMs);
  check(
    '失败错误标记「日志尾部已打印」,上层不会重复打',
    Boolean(failure) && (failure as { hubLogDumped?: boolean }).hubLogDumped === true,
  );
  check(
    '失败时打印日志最后 50 行(含最后一行)',
    printed.includes('hub line-060') && printed.includes(logPath),
  );
  check(
    '只打尾部 50 行:第 11 行在、第 10 行与第 1 行不在',
    printed.includes('hub line-011') && !printed.includes('hub line-010') && !printed.includes('hub line-001'),
  );
  check(
    '尾部标题写明等了多久、等的是哪个 health',
    printed.includes(`waited ${timeoutMs}ms`) && printed.includes('/health'),
  );

  // ── 静态:Hub 的 stdout/stderr 必须进日志文件,不能再 stdio:'ignore' ─────
  const seed = fs.readFileSync(new URL('../scripts/seed-previous-local-hub.mjs', import.meta.url), 'utf8');
  check(
    "hub 输出接到日志 fd,而不是被 stdio:'ignore' 丢掉",
    seed.includes("stdio: ['ignore', hubLogFd, hubLogFd]"),
  );
  check('失败路径会打印日志尾部', seed.includes('printHubLogTail('));

  // ── 没有日志文件时也不崩,只说一句没有日志 ───────────────────────────────
  const orphanChunks: string[] = [];
  const orphanDumped = printHubLogTail(path.join(tmp, 'absent.log'), {
    stderr: {
      write: (chunk: string) => {
        orphanChunks.push(String(chunk));
        return true;
      },
    } as unknown as NodeJS.WriteStream,
  });
  check(
    '日志缺失时打一行说明而不是抛错',
    orphanDumped === true && orphanChunks.join('').includes('(no previous Hub log at'),
  );

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${passed}/${total} passed`);
  process.exitCode = passed === total ? 0 : 1;
};

void run();
