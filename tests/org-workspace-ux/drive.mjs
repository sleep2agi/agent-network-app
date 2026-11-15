// 管理员 2026-11-15「提升一下 UI/UX 的体验」(一级栏「组织」截图)。
//
// 渲染态 web export + 页内 Hub fixture(不起 hub、不碰生产)。断言:
//   ① 只有一层标题(没有「组织管理」);左边整条侧栏贴着一级栏、撑满窗口高,标题「组织」和统计在侧栏顶上;
//      「成员与权限」是侧栏里的一项(不再是页签),点它右侧换成成员面板;「已保存到 Hub」是几秒就消失的小条
//   ② 整页不滚,卡片撑到窗口底;Agent 列表自己滚
//   ③ 底部「调整结构」「说明」两块没了;说明收在部门列底部
//   ④ 未归属置顶;有子部门的可折叠,折叠记在本机(刷新后还在)
//   ⑤ 部门行悬停出「⋯」→ 同一份部门菜单;列头「+」→ 新建根部门
//   ⑥ Agent 行悬停出「移动到…」→ 选部门 → PUT 写 Hub,行离开「未归属」
//   ⑦ 点 Agent 行 → 组织页里打开它的节点页,落在「权限」;「← 组织」回来,部门选择还在
//   ⑧ 侧栏「架构图」:概览 + 四个大数字 + 每个根部门一栏
//   ⑩ 部门详情「Agent / 成员」页签:成员页是这个部门的人(负责人 + 直属成员 + 调动),不再有第二棵树;
//      「成员与权限」里也不再嵌部门树
//   ⑨ 下钻:点部门 → 以它为根重画(面包屑可回);叶子部门是 Agent 卡片墙;「在列表中查看」回列表
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
  // 前 12 个留在未归属;后面的轮流分到各部门(架构图要有像样的分布)。
  const spread = ['d_k0', 'd_k0', 'd_k1', 'd_k2', 'd_k4', 'd_k5', 'd_k6', 'd_k8', 'd_anet', 'd_anet', 'd_a'];
  const mine = names.map((n, i) => agent(n, i, i >= 12 ? spread[i % spread.length] : null)).filter((_, i) => i !== 2 && i !== 5);
  const assigned = [agent('基建甲', 100, 'd_k5'), agent('基建乙', 101, 'd_k5'), agent('门户甲', 102, 'd_k3')];
  window.__puts = [];
  window.__routeOverride = (u, body, method) => {
    const p = u.pathname;
    if (p === '/api/auth/me') return { ok: true, user: { user_id: 'u_me', username: 'admin', role: 'admin' }, current_network: NET, networks: [{ network_id: NET, network_name: '网络', member_role: 'owner' }] };
    if (p === '/api/dm/threads') return { ok: true, threads: [] };
    if (p === '/api/status') return { ok: true, sessions: [{ alias: '基建甲', status: 'idle', agent: 'claude-code', runtime: 'agent-node', node_id: 'n_100', updated_at: now }] };
    if (p === '/api/nodes') return { ok: true, nodes: [{ node_id: 'n_100', alias: '基建甲', owner_user_id: 'u_me', permission_mode: 'default', department_id: 'd_k5', lifecycle_state: 'active', viewer_can: { permission_mode: true } }] };
    if (p === `/api/networks/${NET}/departments`) return { ok: true, departments: departments.map(d => ({ ...d, leader_user_id: d.id === 'd_k5' ? 'u_li' : null, viewer_can: { manage: true, create_child: true }, member_count: 0 })), members: [{ user_id: 'u_li', department_id: 'd_k5' }, { user_id: 'u_wang', department_id: 'd_k5' }] };
    if (p === `/api/networks/${NET}/members`) return { ok: true, members: [{ user_id: 'u_me', username: 'admin', role: 'owner' }, { user_id: 'u_li', username: 'lisi', display_name: '李四', role: 'member' }, { user_id: 'u_wang', username: 'wangwu', display_name: '王五', role: 'member' }] };
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
  const side = await page.evaluate(() => {
    const nav = document.querySelector('[data-testid="agent-org-navigation"]').getBoundingClientRect();
    const rail = document.querySelector('[data-testid="desktop-rail"]').getBoundingClientRect();
    const title = [...document.querySelectorAll('[data-testid="agent-org-navigation"] [role="heading"]')].map(e => e.textContent);
    return { gap: nav.left - rail.right, top: nav.top, bottom: nav.bottom, vh: innerHeight, title, tabs: !!document.querySelector('[data-testid="org-access-tabs"]') };
  });
  record('① 侧栏贴着一级栏、从顶到底', Math.abs(side.gap) <= 1 && side.top <= 1 && side.bottom >= side.vh - 1, side);
  record('① 标题「组织」在侧栏顶上,没有页签条', side.title.includes('组织') && !side.tabs, side);
  const geo = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="agent-org-tree"]').getBoundingClientRect();
    const list = document.querySelector('[data-testid="agent-org-member-list"]');
    const scrollers = [...document.querySelectorAll('[data-testid="org-workspace"] *')].filter(e => e.scrollHeight > e.clientHeight + 2 && getComputedStyle(e).overflowY !== 'visible' && getComputedStyle(e).overflowY !== 'hidden');
    return { cardBottom: card.bottom, vh: innerHeight, listScrolls: list.scrollHeight > list.clientHeight, scrollers: scrollers.map(e => e.getAttribute('data-testid') || e.tagName) };
  });
  record('② 内容撑到窗口底', geo.cardBottom >= geo.vh - 1 && geo.cardBottom <= geo.vh, geo);
  record('② 没有整页滚动(能滚的只有 Agent 列表 / 部门树)', geo.scrollers.every(s => s === 'agent-org-member-list' || s === 'DIV'), geo);
  record('③ 底部「调整结构」没了', await page.locator('[data-testid="agent-org-demo"]').count() === 0, null);
  record('③ 说明收在部门列底部', await page.locator('[data-testid="agent-org-navigation"] [data-testid="agent-org-info-toggle"]').count() === 1, null);
  const order = await page.$$eval('[data-testid="agent-org-departments"] [role="button"][aria-selected]', els => els.map(e => e.getAttribute('data-testid')));
  record('④ 部门里未归属在第一行(上面只有「架构图」「成员与权限」)', order.filter(x => !x.startsWith('agent-org-nav-'))[0] === 'agent-org-dept-unassigned', order.slice(0, 3));

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
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/org-move.png` });
  await page.locator('[data-testid="agent-org-move-dept-d_k5"]').click();
  await page.waitForTimeout(500);
  const puts = await page.evaluate(() => window.__puts);
  record('⑥ 移动写 Hub(PUT …/nodes/n_1/department)', puts.length === 1 && puts[0].p.endsWith('/nodes/n_1/department') && puts[0].body.includes('d_k5'), puts);
  record('⑥ 行离开「未归属」', await page.locator('[data-testid="agent-org-agent-n_1"]').count() === 0, null);
  record('⑥ 保存结果是小条提示(不是常驻文字)', (await page.locator('[data-testid="agent-org-toast"]').innerText()).includes('已保存') && await page.locator('[data-testid="agent-org-department-result"]').count() === 0, null);
  await page.waitForTimeout(3000);
  record('⑥ 小条几秒后消失', await page.locator('[data-testid="agent-org-toast"]').count() === 0, null);
  await page.locator('[data-testid="agent-org-nav-members"]').click();
  await page.waitForTimeout(400);
  record('① 侧栏「成员与权限」→ 右侧成员面板', await page.locator('[data-testid="agent-org-members"]').isVisible() && await page.locator('[data-testid="agent-org-nav-members"]').getAttribute('aria-selected') === 'true', null);
  await page.screenshot({ path: `${OUT}/org-members.png` });
  await page.locator('[data-testid="agent-org-dept-d_k5"]').click();
  await page.waitForTimeout(200);
  await page.locator('[data-testid="agent-org-agent-n_100"]').click();
  await page.locator('[data-testid="org-agent-detail"]').waitFor();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/org-agent-detail.png` });
  const crumb = await page.locator('[data-testid="org-agent-detail"]').innerText();
  record('⑦ 点 Agent 行打开节点页(面包屑「组织 / 基建甲」)', crumb.includes('组织') && crumb.includes('基建甲'), crumb.slice(0, 80));
  const content = await page.locator('[data-testid="node-page-content"]').innerText();
  record('⑦ 落在「权限」(权限模式可改)', content.includes('权限模式') && content.includes('只读'), content.slice(0, 60));
  record('⑦ 组织页藏起来了', !(await page.locator('[data-testid="agent-org-tree"]').isVisible()), null);
  await page.locator('[data-testid="org-agent-detail-back"]').click();
  await page.waitForTimeout(300);
  record('⑦「← 组织」回来,还停在 TM基建', await page.locator('[data-testid="agent-org-dept-d_k5"]').getAttribute('aria-selected') === 'true' && await page.locator('[data-testid="org-agent-detail"]').count() === 0, null);
  await page.locator('[data-testid="agent-org-nav-chart"]').click();
  await page.locator('[data-testid="org-showcase-hero"]').waitFor();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/org-chart-light.png` });
  await page.screenshot({ path: `${OUT}/org-chart-light-full.png`, fullPage: true });
  const statAgents = await page.locator('[data-testid="org-showcase-stat-agents"]').innerText();
  const cols = await page.locator('[data-testid^="org-showcase-col-"]').count();
  record('⑧ 架构图:横幅 + Agent 总数', /\d/.test(statAgents) && statAgents.includes('Agent'), statAgents);
  record('⑧ 架构图:每个根部门一栏(TMAI / A 站 / ANet)', cols === 3, cols);
  record('⑧ 架构图:子部门挂在根部门下', await page.locator('[data-testid="org-showcase-col-d_tmai"] [data-testid="org-showcase-dept-d_k5"]').count() === 1, null);
  record('⑧ 架构图:未归属是最后一张虚线卡', await page.locator('[data-testid="org-showcase-unassigned"]').count() === 1, null);
  // ⑩ 部门详情的「成员」页签
  await page.locator('[data-testid="agent-org-dept-d_k5"]').click();
  await page.waitForTimeout(300);
  await page.locator('[data-testid="agent-org-dept-tab-people"]').click();
  await page.locator('[data-testid="org-detail-members"]').waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/org-dept-people.png` });
  const people = await page.locator('[data-testid="agent-org-dept-people"]').innerText();
  record('⑩「成员」页签:这个部门的人 + 负责人', people.includes('李四') && people.includes('王五') && people.includes('负责人'), people.slice(0, 120));
  record('⑩ 成员页里没有第二棵部门树', await page.locator('[data-testid="org-tree"]').count() === 0 && await page.locator('[data-testid="org-desk-move-wangwu"]').count() === 1, null);
  await page.locator('[data-testid="agent-org-dept-d_k4"]').click();
  await page.waitForTimeout(300);
  record('⑩ 换部门仍停在「成员」页签', await page.locator('[data-testid="agent-org-dept-tab-people"]').getAttribute('aria-selected') === 'true', null);
  await page.locator('[data-testid="agent-org-dept-tab-agents"]').click();
  await page.waitForTimeout(200);
  await page.locator('[data-testid="agent-org-nav-members"]').click();
  await page.waitForTimeout(500);
  record('⑩「成员与权限」里不再嵌部门树', await page.locator('[data-testid="org-group"]').count() === 0 && await page.locator('[data-testid="user-management"]').count() === 1, null);
  await page.locator('[data-testid="agent-org-nav-chart"]').click();
  await page.waitForTimeout(300);
  // ⑨ 下钻(管理员「点击这里能下钻吗」)
  await page.locator('[data-testid="org-showcase-dept-d_tmai"]').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/org-chart-drill.png` });
  record('⑨ 点根部门卡 → 以它为根:面包屑「组织 › TMAI」,下级部门成栏', await page.locator('[data-testid="org-showcase-crumb-d_tmai"]').count() === 1 && await page.locator('[data-testid="org-showcase-col-d_k5"]').count() === 1 && await page.locator('[data-testid="org-showcase-col-d_tmai"]').count() === 0, null);
  const fitView = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="org-showcase-root"]').getBoundingClientRect();
    const card = document.querySelector('[data-testid="org-showcase-chart"]').getBoundingClientRect();
    const cols = [...document.querySelectorAll('[data-testid^="org-showcase-col-"]')].map(e => e.getBoundingClientRect());
    return { rootIn: root.left >= card.left && root.right <= card.right, colsIn: cols.every(c => c.right <= card.right + 1), grid: !!document.querySelector('[data-testid="org-showcase-grid"]') };
  });
  record('⑨ 9 个下级部门放不下一行 → 换网格,根节点和每张卡都在视野里', fitView.rootIn && fitView.colsIn && fitView.grid, fitView);
  record('⑨ 下钻后概览跟着换(标题 TMAI)', (await page.locator('[data-testid="org-showcase-hero"]').innerText()).includes('TMAI'), null);
  await page.locator('[data-testid="org-showcase-dept-d_k5"]').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/org-chart-leaf.png` });
  record('⑨ 没有下级的部门 → Agent 卡片墙', await page.locator('[data-testid="org-showcase-agents"]').count() === 1 && await page.locator('[data-testid="org-showcase-agent-n_100"]').count() === 1, null);
  await page.locator('[data-testid="org-showcase-crumb-root"]').click();
  await page.waitForTimeout(300);
  record('⑨ 面包屑「组织」回到最上层', await page.locator('[data-testid="org-showcase-col-d_tmai"]').count() === 1, null);
  await page.locator('[data-testid="org-showcase-dept-d_anet"]').click();
  await page.waitForTimeout(200);
  await page.locator('[data-testid="org-showcase-open-list"]').click();
  await page.waitForTimeout(300);
  record('⑨「在列表中查看」→ 列表视图选中该部门', await page.locator('[data-testid="agent-org-dept-d_anet"]').getAttribute('aria-selected') === 'true' && await page.locator('[data-testid="org-showcase"]').count() === 0, null);
  record('无页面报错', errors.length === 0, errors);
  await ctx.close();
}
{
  const { ctx, page, errors } = await open('dark');
  await page.locator('[data-testid="agent-org-dept-d_k5"]').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/org-dark.png` });
  await page.locator('[data-testid="agent-org-nav-chart"]').click();
  await page.locator('[data-testid="org-showcase-hero"]').waitFor();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/org-chart-dark.png` });
  record('暗色无页面报错', errors.length === 0, errors);
  await ctx.close();
}
await browser.close();
web.close?.();
const p = results.filter(Boolean).length, t = results.length;
console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
