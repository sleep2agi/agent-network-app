import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

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

const child = spawn('bun', [join(packageRoot, 'bin/commhub.ts')], {
  cwd: dataDir,
  env: {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: '9200',
    COMMHUB_DB: join(dataDir, 'commhub.db'),
    COMMHUB_UPLOADS_DIR: join(dataDir, 'uploads'),
    COMMHUB_SERVER_VERSION: previousVersion,
  },
  stdio: 'ignore',
  // --keep-running(app#246 stale-takeover smoke):让这个「旧版」Hub 在脚本退出后继续占着 9200,
  // 并把它的 pid 写进 supervisor.lock —— 复现 app 自动更新后旧 sidecar 没被收掉的现场。
  detached: keepRunning,
});

const waitForHealth = async () => {
  let last = 'not ready';
  for (let i = 0; i < 80; i++) {
    try {
      const response = await fetch(`${endpoint}/health`);
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
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`previous Hub did not become healthy: ${last}`);
};

const callJson = async (route, init) => {
  const response = await fetch(`${endpoint}${route}`, init);
  const body = await response.json();
  if (!response.ok || body.ok === false) throw new Error(`${route} returned HTTP ${response.status}`);
  return body;
};

try {
  await waitForHealth();
  const password = `${randomUUID()}-A9!`;
  const registration = await callJson('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'local-admin', password, display_name: 'Local workspace' }),
  });
  const token = registration.token;
  const networkId = registration.network_id;
  const nodeCredential = await callJson('/api/auth/node-token', {
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
  await callJson('/api/task', {
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
} finally {
  if (keepRunning && child.exitCode === null) {
    child.unref();
  } else if (child.exitCode === null) {
    child.kill('SIGTERM');
    await new Promise(resolve => child.once('exit', resolve));
  }
}
