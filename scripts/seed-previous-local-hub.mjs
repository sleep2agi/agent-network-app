import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const [appRootArg, packageRootArg, passwordFileArg] = process.argv.slice(2);
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
const previousVersion = '0.9.0-preview.28';
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
});

const waitForHealth = async () => {
  let last = 'not ready';
  for (let i = 0; i < 80; i++) {
    try {
      const response = await fetch(`${endpoint}/health`);
      const body = await response.json();
      if (response.ok && body.ok && body.version === previousVersion) return;
      if (response.ok && body.ok) last = `unexpected version ${body.version ?? 'missing'}`;
      last = `HTTP ${response.status}`;
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
} finally {
  if (child.exitCode === null) {
    child.kill('SIGTERM');
    await new Promise(resolve => child.once('exit', resolve));
  }
}
