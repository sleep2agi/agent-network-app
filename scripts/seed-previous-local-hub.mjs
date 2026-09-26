// Previous factory Hub seed for the packaged migration / stale-takeover smoke.
//
// app#389: the Windows release runner intermittently died with
// `previous Hub did not become healthy: fetch failed` (0.2.102 / .104 / .106,
// green on rerun). Two causes, both here: the wait was a fixed 80 × 100ms =
// 8s window with no backoff, and `stdio: 'ignore'` threw the Hub's own
// startup errors away, so the job reported one line and nothing to debug.
// The wait is now deadline-based (~60s) with exponential backoff, the Hub's
// stdout/stderr land in local-hub/logs/previous-hub.log, and a failed wait
// prints the tail of that log before it throws.

import { randomUUID } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const HEALTH_TIMEOUT_MS = 60_000;
export const HEALTH_BACKOFF_INITIAL_MS = 100;
export const HEALTH_BACKOFF_MAX_MS = 2_000;
export const LOG_TAIL_LINES = 50;

export const readLogTail = (logPath, lines = LOG_TAIL_LINES) => {
  if (!logPath) return null;
  let content;
  try {
    content = readFileSync(logPath, 'utf8');
  } catch {
    return null;
  }
  const rows = content.split(/\r?\n/);
  while (rows.length > 0 && rows[rows.length - 1] === '') rows.pop();
  if (rows.length === 0) return [];
  return rows.slice(Math.max(0, rows.length - lines));
};

// 失败时唯一的信息源就是 Hub 自己写的日志 —— 所以这里必须先把它打出来再抛错。
// 返回值告诉调用方「已经打过了」,避免上层 catch 再重复一遍。
export const printHubLogTail = (
  logPath,
  { stderr = process.stderr, lines = LOG_TAIL_LINES, context = '' } = {},
) => {
  if (!logPath) return false;
  const tail = readLogTail(logPath, lines);
  if (tail === null) {
    stderr.write(`\n(no previous Hub log at ${logPath})\n`);
    return true;
  }
  stderr.write(
    `\n--- last ${Math.min(tail.length, lines)} lines of previous Hub log: ${logPath}`
      + `${context ? ` — ${context}` : ''} ---\n`,
  );
  stderr.write(`${tail.join('\n')}\n`);
  return true;
};

export const waitForHealth = async ({
  endpoint,
  previousVersion,
  logPath,
  timeoutMs = HEALTH_TIMEOUT_MS,
  fetchImpl = fetch,
  sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms)),
  stderr = process.stderr,
}) => {
  const deadline = Date.now() + timeoutMs;
  let last = 'not ready';
  let delay = HEALTH_BACKOFF_INITIAL_MS;
  for (;;) {
    try {
      const response = await fetchImpl(`${endpoint}/health`);
      const body = await response.json();
      if (response.ok && body.ok && body.version === previousVersion) return;
      // 版本对不上要说出对不上的是什么(0.2.48 首轮:这里被下一行的 `HTTP 200` 盖掉,
      // 日志只剩「did not become healthy: HTTP 200」,看不出是包版本 != 期望版本)。
      last = response.ok && body.ok
        ? `package reports version ${body.version ?? 'missing'}, expected ${previousVersion} (the server does not take the version from env; install that exact package)`
        : `HTTP ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    // 退避而不是固定间隔:8 秒窗口 × 固定 100ms 是 #389 的偶发红灯,
    // 冷 runner 上 npm 装出来的 Hub 就是起不来这么快。
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(delay, remaining));
    delay = Math.min(delay * 2, HEALTH_BACKOFF_MAX_MS);
  }
  const error = new Error(`previous Hub did not become healthy: ${last}`);
  error.hubLogDumped = printHubLogTail(logPath, {
    stderr,
    context: `waited ${timeoutMs}ms for ${endpoint}/health, expected version ${previousVersion}`,
  });
  throw error;
};

const main = async () => {
  const keepRunning = process.argv.includes('--keep-running');
  const [appRootArg, packageRootArg, passwordFileArg] = process.argv.slice(2).filter(arg => arg !== '--keep-running');
  if (!appRootArg || !packageRootArg || !passwordFileArg) {
    throw new Error('usage: seed-previous-local-hub.mjs <app-root> <package-root> <password-file>');
  }
  const appRoot = resolve(appRootArg);
  const packageRoot = resolve(packageRootArg);
  const passwordFile = resolve(passwordFileArg);
  const localRoot = join(appRoot, 'local-hub');
  const dataDir = join(localRoot, 'data');
  const logsDir = join(localRoot, 'logs');
  const endpoint = 'http://127.0.0.1:9200';
  const previousVersion = (process.env.ANET_SMOKE_PREVIOUS_HUB_VERSION || '').trim();
  if (!previousVersion) {
    throw new Error('ANET_SMOKE_PREVIOUS_HUB_VERSION is required; refusing a silent default that would keep this smoke green when the seed is missing');
  }
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  mkdirSync(logsDir, { recursive: true, mode: 0o700 });
  const hubLogPath = join(logsDir, 'previous-hub.log');
  const hubLogFd = openSync(hubLogPath, 'w', 0o600);

  let child;
  try {
    child = spawn('bun', [join(packageRoot, 'bin/commhub.ts')], {
      cwd: dataDir,
      env: {
        ...process.env,
        HOST: '127.0.0.1',
        PORT: '9200',
        COMMHUB_DB: join(dataDir, 'commhub.db'),
        COMMHUB_UPLOADS_DIR: join(dataDir, 'uploads'),
        COMMHUB_SERVER_VERSION: previousVersion,
      },
      // Hub 的 stdout/stderr 全写进 previous-hub.log(#389 失败时唯一能看的东西)。
      stdio: ['ignore', hubLogFd, hubLogFd],
      // --keep-running(app#246 stale-takeover smoke):让这个「旧版」Hub 在脚本退出后继续占着 9200,
      // 并把它的 pid 写进 supervisor.lock —— 复现 app 自动更新后旧 sidecar 没被收掉的现场。
      detached: keepRunning,
    });

    await waitForHealth({ endpoint, previousVersion, logPath: hubLogPath });
    const password = `${randomUUID()}-A9!`;
    const registration = await callJson(endpoint, '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'local-admin', password, display_name: 'Local workspace' }),
    });
    const token = registration.token;
    const networkId = registration.network_id;
    const nodeCredential = await callJson(endpoint, '/api/auth/node-token', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ network_id: networkId, node_name: 'previous-version-node' }),
    });
    const report = await fetch(`${endpoint}/mcp`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${nodeCredential.token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-03-26',
      },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'report_status', arguments: {
          resume_id: 'previous-version-resume', alias: 'previous-version-node',
          status: 'idle', agent: 'previous-packaged-migration', network_id: networkId,
        } },
      }),
    });
    const reportBody = await report.text();
    if (!report.ok || reportBody.includes('"isError":true')) {
      throw new Error(`previous Hub report_status returned HTTP ${report.status}`);
    }
    await callJson(endpoint, '/api/task', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        alias: 'previous-version-node', task: 'previous-version-task', priority: 'normal',
        network_id: networkId, from: 'local-admin',
      }),
    });
    writeFileSync(passwordFile, password, { mode: 0o600 });
    writeFileSync(join(localRoot, 'config.json'), `${JSON.stringify({
      schemaVersion: 1, enabled: true, host: '127.0.0.1', port: 9200,
      endpoint, hubVersion: previousVersion,
    }, null, 2)}\n`, { mode: 0o600 });
    if (keepRunning) {
      writeFileSync(join(localRoot, 'supervisor.lock'), `${child.pid}\n`, { mode: 0o600 });
      console.log(`stale previous Hub ${previousVersion} kept running on ${endpoint} as pid ${child.pid}`);
    }
  } catch (error) {
    if (error && typeof error === 'object' && !error.hubLogDumped) {
      printHubLogTail(hubLogPath, { context: 'previous Hub seed failed' });
    }
    throw error;
  } finally {
    if (child) {
      if (keepRunning && child.exitCode === null) {
        child.unref();
      } else if (child.exitCode === null) {
        child.kill('SIGTERM');
        await new Promise(resolveExit => child.once('exit', resolveExit));
      }
    }
    closeSync(hubLogFd);
  }
};

const callJson = async (endpoint, route, init) => {
  const response = await fetch(`${endpoint}${route}`, init);
  const body = await response.json();
  if (!response.ok || body.ok === false) throw new Error(`${route} returned HTTP ${response.status}`);
  return body;
};

const invokedDirectly = Boolean(process.argv[1])
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if ((import.meta.main ?? false) || invokedDirectly) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
