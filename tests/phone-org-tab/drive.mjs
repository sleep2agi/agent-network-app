// admin 2026-11-16「手机上没有组织架构啊」「手机上的体验提升一下吧」:手机底栏「组织」。
//
// 渲染态 web export(390×844 手机)+ 页内 Hub fixture。断言:
//   ① 底栏五项 Agent / 任务 / 组织 / 定时任务 / 设置,点「组织」进组织页
//   ② 组织页:顶上一行「架构图」,下面部门树;点部门进部门页
//   ③ 部门页:左上小链接「全部部门」(不是整行),下级部门是文件夹行,Agent 行可点;不显示「长按部门…」说明
//   ④ 点 Agent → 节点页;返回回到部门页
//   ⑤ 「架构图」→ 架构图页,有返回;页面不横向溢出
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const web = await serveExport(process.env.WEB_DIR);
const OUT = process.env.OUT_DIR || '/tmp/phone-org-tab';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: findChromium(), args: ['--no-sandbox'] });

const fixture = () => {
  const NET = 'net-org';
  const now = new Date().toISOString();
  const nodes = [
    { node_id: 'n_100', alias: '通信欧', owner_user_id: 'u_me', department_id: 'd_a', lifecycle_state: 'active', viewer_can: { permission_mode: true }, attrs_revision: 1, description: '负责 App 发版。' },
    { node_id: 'n_101', alias: 'Mac打包牛', owner_user_id: 'u_me', department_id: 'd_a', lifecycle_state: 'active', attrs_revision: 0 },
    { node_id: 'n_102', alias: '插件研发', owner_user_id: 'u_me', department_id: 'd_b', lifecycle_state: 'idle', attrs_revision: 0 },
  ];
  window.__routeOverride = (u) => {
    const p = u.pathname;
    if (p === '/api/auth/me') return { ok: true, user: { user_id: 'u_me', username: 'admin', role: 'admin' }, current_network: NET, networks: [{ network_id: NET, network_name: '网络', member_role: 'owner' }] };
    if (p === '/api/dm/threads') return { ok: true, threads: [] };
    if (p === '/api/status') return { ok: true, sessions: nodes.map(n => ({ alias: n.alias, status: 'idle', agent: 'claude-code', runtime: 'agent-node', node_id: n.node_id, updated_at: now })) };
    if (p === '/api/nodes') return { ok: true, nodes };
    if (p === `/api/networks/${NET}/departments`) return { ok: true, departments: [
      { id: 'd_a', name: 'TMWork', parent_id: null, leader_user_id: null, sort: 0, viewer_can: { manage: true, create_child: true }, member_count: 0 },
      { id: 'd_b', name: 'VSCODE插件', parent_id: 'd_a', leader_user_id: null, sort: 0, viewer_can: { manage: true, create_child: true }, member_count: 0 },
    ], members: [] };
    if (p === `/api/networks/${NET}/humans`) return { ok: true, humans: [{ user_id: 'u_me', username: 'admin' }] };
    if (p === '/api/requirements/people/directory') return { ok: true, people: [{ user_id: 'u_me', username: 'admin', agents: nodes.map(n => ({ node_id: n.node_id, alias: n.alias, updated_at: now, lifecycle_state: n.lifecycle_state, department_id: n.department_id })) }], agents_without_owner: [], has_more: false, next_offset: null, agent_department_supported: true };
    if (p === '/api/requirements/people') return { ok: true, people: [] };
    return undefined;
  };
};

const results = [];
const record = (name, ok, detail) => { results.push(ok); console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ' ' + JSON.stringify(detail)}`); };
const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({ locale: 'zh-CN', viewport: { width: 390, height: 844 }, colorScheme: theme, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(initScript, { theme });
  await page.addInitScript(fixture);
  await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
  await page.locator('[data-testid="mobile-tab-bar"]').waitFor();
  const tabs = await page.locator('[data-testid^="mobile-tab-"]:not([data-testid="mobile-tab-bar"]):not([data-testid^="mobile-tab-badge"])').evaluateAll(els => els.map(e => e.getAttribute('data-testid')));
  record(`${theme} ① 底栏 Agent / 任务 / 组织 / 定时任务 / 设置`, JSON.stringify(tabs) === JSON.stringify(['mobile-tab-agents', 'mobile-tab-tasks', 'mobile-tab-org', 'mobile-tab-scheduled', 'mobile-tab-settings']), tabs);
  await page.locator('[data-testid="mobile-tab-org"]').click();
  await page.locator('[data-testid="org-workspace-phone"]').waitFor();
  await page.locator('[data-testid="agent-org-chart-open"]').waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${theme}-1-tree.png` });
  record(`${theme} ② 组织页:「架构图」入口 + 部门树`, await page.locator('[data-testid="agent-org-chart-open"]').isVisible() && await page.getByText('TMWork', { exact: true }).first().isVisible(), null);
  record(`${theme} ② 不横向溢出(树)`, await noOverflow(page), null);
  await page.getByText('TMWork', { exact: true }).first().click();
  await page.locator('[data-testid="agent-org-detail-card"]').waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${theme}-2-dept.png` });
  const back = page.locator('[data-testid="agent-org-back"]');
  const backBox = await back.boundingBox();
  record(`${theme} ③ 返回是左上小链接(不是整行)`, !!backBox && backBox.width < 200 && backBox.height < 50, backBox);
  record(`${theme} ③ 下级部门行 + Agent 行可点`, await page.locator('[data-testid="agent-org-child-d_b"]').isVisible() && (await page.locator('[data-testid="agent-org-agent-n_101"]').getAttribute('role')) === 'button', null);
  record(`${theme} ③ 部门页不显示「长按部门…」说明`, !(await page.locator('[data-testid="agent-org-departments-edit-hint"]').isVisible().catch(() => false)), null);
  record(`${theme} ③ 不横向溢出(部门)`, await noOverflow(page), null);
  await page.locator('[data-testid="agent-org-agent-n_100"]').click();
  await page.locator('[data-testid="org-agent-detail"]').waitFor();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${theme}-3-node.png` });
  record(`${theme} ④ 点 Agent → 节点页`, await page.locator('[data-testid="org-agent-detail"]').getByText('通信欧', { exact: true }).first().isVisible(), null);
  await page.locator('[data-testid="org-agent-detail"]').getByRole('button').first().click();
  await page.locator('[data-testid="agent-org-detail-card"]').waitFor();
  record(`${theme} ④ 返回回到部门页`, await page.locator('[data-testid="agent-org-child-d_b"]').isVisible(), null);
  await back.click();
  await page.locator('[data-testid="agent-org-chart-open"]').click();
  await page.locator('[data-testid="agent-org-chart"]').waitFor();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${theme}-4-chart.png` });
  const chartBack = await page.locator('[data-testid="agent-org-chart-back"]').boundingBox();
  record(`${theme} ⑤ 架构图页 + 左上小返回链接`, !!chartBack && chartBack.width < 200 && chartBack.height < 50, chartBack);
  record(`${theme} ⑤ 架构图页不显示编辑说明`, !(await page.locator('[data-testid="agent-org-departments-edit-hint"]').isVisible().catch(() => false)), null);
  record(`${theme} ⑤ 不横向溢出(架构图)`, await noOverflow(page), null);
  await page.locator('[data-testid="agent-org-chart-back"]').click();
  record(`${theme} ⑤ 返回回到树`, await page.locator('[data-testid="agent-org-chart-open"]').isVisible(), null);
  record(`${theme} 无页面错误`, errors.length === 0, errors);
  await ctx.close();
}
await browser.close();
web.close?.();
const passed = results.filter(Boolean).length;
console.log(`${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
