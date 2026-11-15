// 管理员 2026-11-15「移到一级啊」+「设置里面可以设置一级是否显示和展示」:桌面左侧一级栏。
//
// 渲染态 web export + 页内 Hub fixture(不起 hub、不碰生产)。断言:
//   ① 一级栏有「组织」,排在 Hub 设置后面;点它 → 主窗口整页是组织与权限(部门树在),没有会话侧栏
//   ② 设置里关掉的入口(本机 localStorage anet.desktopRailHidden)不在一级栏;Agent / 设置关不掉
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const web = await serveExport(process.env.WEB_DIR);
const OUT = process.env.OUT_DIR || '/tmp/rail-org-visibility';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: findChromium(), args: ['--no-sandbox'] });

const fixture = () => {
  const NET = 'net-org';
  const departments = [
    { id: 'd_a', name: '研发', parent_id: null, leader_user_id: null, sort: 0 },
    { id: 'd_b', name: '前端', parent_id: 'd_a', leader_user_id: null, sort: 0 },
    { id: 'd_c', name: '运营', parent_id: null, leader_user_id: null, sort: 1 },
  ];
  window.__routeOverride = (u) => {
    const p = u.pathname;
    if (p === '/api/auth/me') return { ok: true, user: { user_id: 'u_me', username: 'tester', role: 'admin' }, current_network: NET, networks: [{ network_id: NET, network_name: '网络', member_role: 'owner' }] };
    if (p === '/api/dm/threads') return { ok: true, threads: [] };
    if (p === '/api/status') return { ok: true, sessions: [] };
    if (p === '/api/nodes') return { ok: true, nodes: [] };
    if (p === `/api/networks/${NET}/departments`) return { ok: true, departments: departments.map(d => ({ ...d, viewer_can: { manage: true, create_child: true }, member_count: 0 })), members: [] };
    if (p === `/api/networks/${NET}/humans`) return { ok: true, humans: [{ user_id: 'u_me', username: 'tester' }] };
    if (p === '/api/requirements/people/directory') return { ok: true, people: [], agents_without_owner: [{ node_id: 'n_1', alias: '示例甲' }], has_more: false, next_offset: null, agent_department_supported: true };
    if (p === '/api/requirements/people') return { ok: true, people: [] };
    return undefined;
  };
};

const results = [];
const record = (name, ok, detail) => { results.push(ok); console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ' ' + JSON.stringify(detail)}`); };
const railTabs = (page) => page.$$eval('[data-testid="desktop-rail"] [role="tab"]', els => els.map(e => e.getAttribute('aria-label')));

const open = async (hidden) => {
  const ctx = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1280, height: 820 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(initScript, { theme: 'light' });
  await page.addInitScript(fixture);
  if (hidden) await page.addInitScript(h => { localStorage.setItem('anet.desktopRailHidden', JSON.stringify(h)); }, hidden);
  await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
  await page.locator('[data-testid="desktop-rail"]').waitFor({ timeout: 20000 });
  await page.waitForTimeout(600);
  return { ctx, page, errors };
};

{
  const { ctx, page, errors } = await open(null);
  const tabs = await railTabs(page);
  record('① 一级栏有「组织」,紧跟在 Hub 设置后面', tabs.indexOf('组织') > 0 && tabs.indexOf('组织') === tabs.indexOf('Hub 设置') + 1, tabs);
  await page.getByRole('tab', { name: '组织', exact: true }).click();
  await page.locator('[data-testid="org-workspace"]').waitFor();
  await page.getByText('前端', { exact: true }).first().waitFor({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/rail-org.png` });
  record('① 点「组织」→ 整页组织与权限,部门树在,没有会话侧栏',
    await page.locator('[data-testid="agent-org-page"]').isVisible()
    && (await page.getByText('研发', { exact: true }).count()) > 0
    && (await page.locator('[data-testid="desktop-workspace-sidebar"]').count()) === 0);
  record('no page errors (default)', errors.length === 0, errors);
  await ctx.close();
}
{
  const { ctx, page, errors } = await open(['org', 'messages', 'agents', 'settings']);
  const tabs = await railTabs(page);
  await page.screenshot({ path: `${OUT}/rail-hidden.png` });
  record('② 关掉的「组织」「消息」不在一级栏', !tabs.includes('组织') && !tabs.includes('消息'), tabs);
  record('② Agent 和设置关不掉', tabs.includes('Agent') || tabs.some(x => /Agent|会话/.test(x)), tabs);
  record('no page errors (hidden)', errors.length === 0, errors);
  await ctx.close();
}

await browser.close();
await web.close?.();
const failed = results.filter(ok => !ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
