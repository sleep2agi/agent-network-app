// Hub / Daemon 侧栏「域集成」分组标题 —— web 夹具截图验收。
//
//   WEB_DIR=<expo export> OUT=/opt/cursor/artifacts [PLAYWRIGHT_MODULE=…] node tests/test-hub-integration-labels/shoot.mjs
//
import { mkdirSync, writeFileSync } from 'node:fs';
import { serveExport, initScript, findChromium, TEST_LOCALE } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
const OUT = process.env.OUT || '/opt/cursor/artifacts';
if (!WEB) throw new Error('need WEB_DIR');

const fixtureScript = ({ manyHosts: _manyHosts }) => {
  const now = Date.now();
  const iso = (minAgo) => new Date(now - minAgo * 60000).toISOString().replace('T', ' ').slice(0, 19);
  const host = (hostname, o = {}) => ({ hostname, ip: '192.0.2.1', cpu_load_1min: 3, cpu_cores: 16, mem_total_gb: 62.6, mem_used_gb: 20, mem_avail_gb: 42.6, disk_total_gb: 500, disk_used_gb: 120, disk_avail_gb: 380, ...o });
  const rows = [];
  const add = (alias, status, minAgo, h) => rows.push({ alias, status, agent: 'claude-code', runtime: 'agent-node', node_id: `n_${alias}`, updated_at: iso(minAgo), ...h, host: { ...h } });
  for (let i = 1; i <= 4; i++) add(`示例-A${i}`, 'idle', 1, host('host-a'));
  const daemons = [{ daemon_node_id: 'd_sweep_alpha', alias: 'daemon-alpha', hostname: 'host-a', online: true, last_seen_at: iso(0), runtimes_supported: ['claude-code'] }];
  const daemonNodes = [
    { node_id: 'd_sweep_alpha', alias: 'daemon-alpha', role: 'host_supervisor', hostname: 'host-a', lifecycle_state: 'running' },
    ...['示例-A1', '示例-A2', '示例-A3', '示例-A4'].map(alias => ({ node_id: `n_${alias}`, alias, role: 'agent', lifecycle_daemon_node_id: 'd_sweep_alpha', lifecycle_state: 'running' })),
  ];
  window.__routeOverride = (u) => {
    if (u.pathname === '/api/host-supervisors') return { ok: true, count: daemons.length, daemons };
    if (u.pathname === '/api/nodes') return { ok: true, nodes: daemonNodes, count: daemonNodes.length };
    if (u.pathname !== '/api/status') return undefined;
    if (u.searchParams.get('light') === '1') return { ok: true, sessions: rows.map(s => ({ alias: s.alias, status: s.status, agent: s.agent, task: null, server: null, updated_at: s.updated_at, runtime: s.runtime ?? null, network_id: 'net-sweep' })) };
    return { ok: true, sessions: rows };
  };
};

const web = await serveExport(WEB);
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const failures = [];
const ck = (name, ok, extra = '') => {
  if (!ok) failures.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? ` (${extra})` : ''}`);
};

for (const { locale, lang, hubLabel, daemonLabel, hubFile, daemonFile } of [
  { locale: TEST_LOCALE, lang: 'zh', hubLabel: 'Hub 域集成', daemonLabel: 'Daemon 域集成', hubFile: 'hub-sidebar-integrations-zh.png', daemonFile: 'daemon-sidebar-integrations-zh.png' },
  { locale: 'en-US', lang: 'en', hubLabel: 'Hub integrations', daemonLabel: 'Daemon integrations', hubFile: 'hub-sidebar-integrations-en.png', daemonFile: 'daemon-sidebar-integrations-en.png' },
]) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 850 }, locale, colorScheme: 'light' });
  const page = await ctx.newPage();
  page.on('pageerror', e => failures.push(`pageerror ${lang}: ${e}`));
  await page.addInitScript(initScript, { theme: 'light' });
  await page.addInitScript(({ pref }) => { try { localStorage.setItem('anet.language.v1', pref); } catch {} }, { pref: lang });
  await page.addInitScript(fixtureScript, { manyHosts: false });
  await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
  await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 20000 });
  await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'server' }));
  await page.locator('[data-testid="server-sidebar"]').waitFor({ timeout: 15000 });
  const hubText = await page.locator('[data-testid="server-integrations-label"]').textContent();
  ck(`${lang}: Hub 侧栏分组标题`, hubText === hubLabel, String(hubText));
  await page.screenshot({ path: `${OUT}/${hubFile}`, fullPage: false });
  await page.locator('[data-testid="server-hostrow-host-a"]').click();
  await page.locator('[data-testid="daemon-management"]').waitFor({ timeout: 12000 });
  const daemonText = await page.locator('[data-testid="daemon-integrations-label"]').textContent();
  ck(`${lang}: Daemon 侧栏分组标题`, daemonText === daemonLabel, String(daemonText));
  await page.screenshot({ path: `${OUT}/${daemonFile}`, fullPage: false });
  await ctx.close();
}

await browser.close();
web.close();
writeFileSync(`${OUT}/hub-integration-labels-result.json`, JSON.stringify({ failures }, null, 2));
if (failures.length) { console.error('FAILED:', failures); process.exit(1); }
console.log('All integration label checks passed.');
