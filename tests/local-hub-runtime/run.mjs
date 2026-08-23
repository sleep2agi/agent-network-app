import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const binary = process.env.LOCAL_HUB_BINARY || '/work/commhub';
const root = await mkdtemp(join(tmpdir(), 'anet-local-hub-e2e-'));
const database = join(root, 'commhub.db');
const uploads = join(root, 'uploads');
const logPath = join(root, 'commhub.log');
const endpoint = 'http://127.0.0.1:9200';
const username = 'local-e2e-admin';
const password = 'isolated-E2E-only-4d4cb745-7e4d-4fa7-A9!';

const waitFor = async (predicate, timeoutMs = 10000) => {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      last = error;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw last || new Error('timed out');
};

const start = () => {
  const child = spawn(binary, [], {
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: '9200',
      COMMHUB_DB: database,
      COMMHUB_UPLOADS_DIR: uploads,
      COMMHUB_DEV_OPEN: '',
      COMMHUB_AUTH_TOKEN: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const chunks = [];
  child.stdout.on('data', chunk => chunks.push(chunk));
  child.stderr.on('data', chunk => chunks.push(chunk));
  child.on('exit', async () => {
    await import('node:fs/promises').then(fs => fs.writeFile(logPath, Buffer.concat(chunks))).catch(() => {});
  });
  return { child, chunks };
};

const json = async (path, init) => {
  const response = await fetch(`${endpoint}${path}`, init);
  const body = await response.json();
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}: ${JSON.stringify(body)}`);
  return body;
};

const stop = async child => {
  const exited = new Promise((resolve, reject) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
    child.once('error', reject);
  });
  child.kill('SIGTERM');
  return Promise.race([
    exited,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Hub ignored SIGTERM')), 3000)),
  ]);
};

let first;
let second;
try {
  first = start();
  const health = await waitFor(async () => {
    const value = await json('/health');
    return value.ok ? value : null;
  });
  if (health.version !== '0.9.0-preview.29' || health.api_version !== 'v3' || health.security !== 'secured') {
    throw new Error(`unexpected health contract: ${JSON.stringify(health)}`);
  }

  const registered = await json('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, display_name: 'Local E2E' }),
  });
  if (!registered.ok || typeof registered.token !== 'string' || !registered.token) throw new Error('register omitted token');
  const me = await json('/api/auth/me', { headers: { Authorization: `Bearer ${registered.token}` } });
  if (me?.user?.username !== username) throw new Error('auth/me did not restore registered user');

  await stop(first.child);
  const firstLog = Buffer.concat(first.chunks).toString('utf8');
  if (firstLog.includes(password) || firstLog.includes(registered.token)) throw new Error('credential leaked to Hub log');
  if ((await stat(database)).size <= 0) throw new Error('database was not persisted');

  second = start();
  await waitFor(async () => (await json('/health')).ok);
  const loggedIn = await json('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!loggedIn.ok || typeof loggedIn.token !== 'string') throw new Error('restart login failed');
  await stop(second.child);
  console.log(JSON.stringify({
    ok: true,
    endpoint,
    version: health.version,
    apiVersion: health.api_version,
    security: health.security,
    gracefulSigterm: true,
    restartPersistence: true,
    credentialLeak: false,
  }));
} finally {
  if (first?.child.exitCode === null) first.child.kill('SIGKILL');
  if (second?.child.exitCode === null) second.child.kill('SIGKILL');
}
