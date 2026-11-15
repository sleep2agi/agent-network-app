// 管理员 2026-11-15「提升一下 UI/UX 的体验」(一级栏「组织」截图)。
//
// 渲染态 web export + 页内 Hub fixture(不起 hub、不碰生产)。断言:
//   ① 只有一层标题(没有「组织管理」);统计在部门列头;页签和标题同一行
//   ② 整页不滚,卡片撑到窗口底;Agent 列表自己滚
//   ③ 底部「调整结构」「说明」两块没了;说明收在部门列底部
//   ④ 未归属置顶;有子部门的可折叠,折叠记在本机(刷新后还在)
//   ⑤ 部门行悬停出「⋯」→ 同一份部门菜单;列头「+」→ 新建根部门
//   ⑥ Agent 行悬停出「移动到…」→ 选部门 → PUT 写 Hub,行离开「未归属」
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const web = await serveExport(process.env.WEB_DIR);
const OUT = process.env.OUT_DIR || '/tmp/org-workspace-ux';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: findChromium(), args: ['--no-sandbox'] });

const fixture = () => {
  const NET = 'net-org';
  const kids = ['TMWork', 'TM智能体空间', 'TMWork云+TMBot团队', 'TM门户', 'TM知识库', 'TM基建', 'TMAI网关团队', 'OODA', 'TM安全团队'];
  const departments = [
    { id: 'd_tmai', name: 'TMAI', parent_id: null, sort: 0 },
    ...kids.map((name, i) => ({ id: `d_k${i}`, name, parent_id: 'd_tmai', sort: i })),
    { id: 'd_a', name: 'A 站', parent_id: null, sort: 1 },
    { id: 'd_anet', name: 'ANet', parent_id: null, sort: 2 },
  ];
  const now = new Date().toISOString();
  const names = ['安全扫描-fork-1', '测试员3号', '神明', '神明2号', '神明3号', '实习开源运营牛', '天马设计师', '天启营里欧', '通信欧', '通信客户端欧', '通信飞书欧', '数据分析马', '文档助手', '日志巡检', '发布机器人', '代码审阅员', '值班助理', '翻译官', '知识整理', '客服一号', '客服二号', '运维小助手', '监控哨兵', '需求分析师', '产品经理牛', '前端工程师', '后端工程师', '测试工程师', '运营助手', '市场营销马', '财务助理', '法务助理', '招聘助理', '行政助理'];
  const agent = (n, i, dept) => ({ node_id: `n_${i}`, alias: n, updated_at: now, lifecycle_state: i % 3 === 0 ? 'stopped' : 'active', department_id: dept });
  const mine = names.map((n, i) => agent(n, i, null)).filter((_, i) => i !== 2 && i !== 5);
  const assigned = [agent('基建甲', 100, 'd_k5'), agent('基建乙', 101, 'd_k5'), agent('门户甲', 102, 'd_k3')];
  window.__puts = [];
  window.__routeOverride = (u, body, method) => {
    const p = u.pathname;
    if (p === '/api/auth/me') return { ok: true, user: { user_id: 'u_me', username: 'admin', role: 'admin' }, current_network: NET, networks: [{ network_id: NET, network_name: '网络', member_role: 'owner' }] };
    if (p === '/api/dm/threads') return { ok: true, threads: [] };
    if (p === '/api/status') return { ok: true, sessions: [] };
    if (p === '/api/nodes') return { ok: true, nodes: [] };
    if (p === `/api/networks/${NET}/departments`) return { ok: true, departments: departments.map(d => ({ ...d, leader_user_id: null, viewer_can: { manage: true, create_child: true }, member_count: 0 })), members: [] };
    if (p === `/api/networks/${NET}/humans`) return { ok: true, humans: [{ user_id: 'u_me', username: 'admin' }] };
    if (/\/nodes\/[^/]+\/department$/.test(p) && method === 'PUT') { window.__puts.push({ p, body }); return { ok: true }; }
    if (p === '/api/requirements/people/directory') return { ok: true, people: [{ user_id: 'u_me', username: 'admin', agents: [...mine, ...assigned] }], agents_without_owner: [agent('神明', 2, null), agent('实习开源运营牛', 5, null)], has_more: false, next_offset: null, agent_department_supported: true };
    if (p === '/api/requirements/people') return { ok: true, people: [] };
    return undefined;
  };
};

const results = [];
const record = (name, ok, detail) => { results.push(ok); console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ' ' + JSON.stringify(detail)}`); };

const open = async (theme, ctx0) => {
  const ctx = ctx0 ?? await browser.newContext({ locale: 'zh-CN', viewport: { width: 1240, height: 920 }, colorScheme: theme });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(initScript, { theme });
  await page.addInitScript(fixture);
  await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
  await page.locator('[data-testid="desktop-rail"]').waitFor({ timeout: 20000 });
  await page.getByRole('tab', { name: '组织', exact: true }).click();
  await page.locator('[data-testid="agent-org-dept-unassigned"]').waitFor();
  await page.waitForTimeout(400);
  return { ctx, page, errors };
};

{
  const { ctx, page, errors } = await open('light');
  await page.screenshot({ path: `${OUT}/org-light.png` });
  const body = await page.locator('[data-testid="org-workspace"]').innerText();
  record('① 没有第二层标题「组织管理」', !body.includes('组织管理'), null);
  record('① 统计在部门列头', (await page.locator('[data-testid="agent-org-summary"]').innerText()).includes('个未归属'), null);
  const headY = await page.evaluate(() => {
    const r = (sel) => document.querySelector(sel)?.getBoundingClientRect();
    const h = [...document.querySelectorAll('[role="heading"]')].find(e => e.textContent === '组织')?.getBoundingClientRect();
    const tabs = r('[data-testid="org-access-tabs"]');
    return h && tabs ? Math.abs((h.top + h.bottom) / 2 - (tabs.top + tabs.bottom) / 2) : 999;
  });
  record('① 页签和标题在同一行', headY < 8, headY);
  const geo = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="agent-org-tree"]').getBoundingClientRect();
    const list = document.querySelector('[data-testid="agent-org-member-list"]');
    const scrollers = [...document.querySelectorAll('[data-testid="org-workspace"] *')].filter(e => e.scrollHeight > e.clientHeight + 2 && getComputedStyle(e).overflowY !== 'visible' && getComputedStyle(e).overflowY !== 'hidden');
    return { cardBottom: card.bottom, vh: innerHeight, listScrolls: list.scrollHeight > list.clientHeight, scrollers: scrollers.map(e => e.getAttribute('data-testid') || e.tagName) };
  });
  record('② 卡片撑到窗口底', geo.cardBottom > geo.vh - 40 && geo.cardBottom <= geo.vh, geo);
  record('② 只有 Agent 列表在滚(没有整页滚动)', geo.listScrolls && geo.scrollers.every(s => s === 'agent-org-member-list' || s === 'DIV'), geo);
  record('③ 底部「调整结构」没了', await page.locator('[data-testid="agent-org-demo"]').count() === 0, null);
  record('③ 说明收在部门列底部', await page.locator('[data-testid="agent-org-navigation"] [data-testid="agent-org-info-toggle"]').count() === 1, null);
  const order = await page.$$eval('[data-testid="agent-org-departments"] [role="button"][aria-selected]', els => els.map(e => e.getAttribute('data-testid')));
  record('④ 未归属在树的第一行', order[0] === 'agent-org-dept-unassigned', order.slice(0, 3));

  await page.locator('[data-testid="agent-org-dept-d_tmai-toggle"]').click();
  await page.waitForTimeout(200);
  record('④ 折叠 TMAI 后子部门不显示', await page.locator('[data-testid="agent-org-dept-d_k0"]').count() === 0, null);
  await page.reload();
  await page.locator('[data-testid="desktop-rail"]').waitFor({ timeout: 20000 });
  await page.getByRole('tab', { name: '组织', exact: true }).click();
  await page.locator('[data-testid="agent-org-dept-unassigned"]').waitFor();
  await page.waitForTimeout(300);
  record('④ 折叠刷新后还在', await page.locator('[data-testid="agent-org-dept-d_k0"]').count() === 0 && await page.locator('[data-testid="agent-org-dept-d_tmai"]').count() === 1, null);
  await page.locator('[data-testid="agent-org-dept-d_tmai-toggle"]').click();
  await page.waitForTimeout(200);
  record('④ 再点展开', await page.locator('[data-testid="agent-org-dept-d_k0"]').count() === 1, null);

  await page.locator('[data-testid="agent-org-dept-d_anet"]').hover();
  await page.locator('[data-testid="agent-org-dept-d_anet-more"]').click();
  await page.locator('[data-testid="agent-org-dept-menu"]').waitFor();
  record('⑤ 悬停「⋯」打开部门菜单', await page.locator('[data-testid="agent-org-dept-menu-rename"]').count() === 1, null);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.locator('[data-testid="agent-org-create-root"]').click();
  await page.locator('[data-testid="agent-org-department-editor"]').waitFor();
  record('⑤ 列头「+」打开新建根部门', (await page.locator('[data-testid="agent-org-department-editor"]').innerText()).includes('新建根部门'), null);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  const row = page.locator('[data-testid="agent-org-agent-n_1"]');
  await row.hover();
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${OUT}/org-hover.png` });
  const op = await page.locator('[data-testid="agent-org-agent-n_1-move"]').evaluate(e => getComputedStyle(e).opacity);
  record('⑥ 悬停出「移动到…」', op === '1', op);
  await page.locator('[data-testid="agent-org-agent-n_1-move"]').click();
  await page.locator('[data-testid="agent-org-selector"]').waitFor();
  await page.screenshot({ path: `${OUT}/org-move.png` });
  await page.locator('[data-testid="agent-org-move-dept-d_k5"]').click();
  await page.waitForTimeout(500);
  const puts = await page.evaluate(() => window.__puts);
  record('⑥ 移动写 Hub(PUT …/nodes/n_1/department)', puts.length === 1 && puts[0].p.endsWith('/nodes/n_1/department') && puts[0].body.includes('d_k5'), puts);
  record('⑥ 行离开「未归属」', await page.locator('[data-testid="agent-org-agent-n_1"]').count() === 0, null);
  record('无页面报错', errors.length === 0, errors);
  await ctx.close();
}
{
  const { ctx, page, errors } = await open('dark');
  await page.locator('[data-testid="agent-org-dept-d_k5"]').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/org-dark.png` });
  record('暗色无页面报错', errors.length === 0, errors);
  await ctx.close();
}
await browser.close();
web.close?.();
const p = results.filter(Boolean).length, t = results.length;
console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
