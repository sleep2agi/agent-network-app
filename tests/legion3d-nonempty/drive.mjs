// 2026-11-14 起:军团 3D 已从设置「组织与权限」页下掉(管理员:「感觉没必要放这里」)。
// 本 drive 改为负控:渲染态 web export + 页面内 Hub fixture,打开「组织与权限」后
//   ① 没有 legion3d-canvas 面板 ② 没有「查看/收起军团 3D」按钮 ③ 组织管理内容仍在。
// (原 #4086「面板非空」断言随入口一起退役;组件仍在 src/legion3d-view.tsx,有单测。)
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium } from '../test-layout-sweep/harness.mjs';

const source = process.env.SOURCE_COMMIT || process.env.GITHUB_SHA;
assert.match(source ?? '', /^[0-9a-f]{40}$/);
console.log(`product_source=${source}; fixture Hub only（无真实 daemon / 无生产凭据）`);

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const web = await serveExport(process.env.WEB_DIR);
const OUT = process.env.OUT_DIR || '/tmp/legion3d-nonempty';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: findChromium(), args: ['--no-sandbox'] });

const fixture = () => {
  // 注意：这个函数会被序列化到页面里执行，不能用 Node 侧变量，常量写在函数内。
  const NET = 'net-legion';
  const departments = [
    { id: 'd_a', name: '研发', parent_id: null, leader_user_id: 'u_me', sort: 0 },
    { id: 'd_b', name: '产品', parent_id: null, leader_user_id: null, sort: 1 },
    { id: 'd_c', name: '运营', parent_id: null, leader_user_id: null, sort: 2 },
  ];
  const members = [
    { user_id: 'u_me', department_id: 'd_a' },
    { user_id: 'u_x', department_id: 'd_a' },
    { user_id: 'u_y', department_id: 'd_b' },
  ];
  window.__routeOverride = (u, _body, method) => {
    const p = u.pathname;
    if (p === '/api/auth/me') return { ok: true, user: { user_id: 'u_me', username: 'tester', role: 'user' }, current_network: NET, networks: [{ id: NET, name: '军团' }] };
    if (p === '/api/dm/threads') return { ok: true, threads: [] };
    if (p === '/api/status') return { ok: true, sessions: [] };
    if (p === '/api/nodes') return { ok: true, nodes: [] };
    if (p === `/api/networks/${NET}/departments`) {
      if (method && method !== 'GET') return { ok: false };
      return { ok: true, departments: departments.map(d => ({ ...d, member_count: members.filter(m => m.department_id === d.id).length })), members };
    }
    if (p === `/api/networks/${NET}/humans`) return { ok: true, humans: members.map(m => ({ user_id: m.user_id, username: m.user_id, display_name: m.user_id })) };
    if (p === '/api/requirements/people/directory') {
      return { ok: true, people: [
        { user_id: 'u_me', username: 'me', display_name: '我', department: { id: 'd_a', name: '研发' }, agents: [{ node_id: 'n_1', alias: '示例甲' }] },
        { user_id: 'u_x', username: 'x', display_name: '甲', department: { id: 'd_a', name: '研发' }, agents: [{ node_id: 'n_2', alias: '示例乙' }] },
      ], agents_without_owner: [{ node_id: 'n_3', alias: '示例丙' }], has_more: false, next_offset: null, agent_department_supported: true };
    }
    if (p === '/api/requirements/people') return { ok: true, people: members };
    return undefined;
  };
};

const obs = {};
let code = 0;
try {
  const ctx = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.addInitScript(initScript, { theme: 'light' });
  await page.addInitScript(fixture);
  await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
  await page.waitForFunction(() => !!window.__anetLayoutSweep);
  await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'settings' }));
  await page.waitForTimeout(1500);

  // 设置页先落到侧栏；点「组织与权限」(默认页签「部门与 Agent」)才渲染这一节（管理员截图也是这一步之后的画面）。
  if (await page.getByText('组织与权限', { exact: true }).count() > 0) {
    await page.getByText('组织与权限', { exact: true }).first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1200);
  }
  const panel = page.locator('[data-testid="legion3d-canvas"]').first();
  const panelCount = await page.locator('[data-testid="legion3d-canvas"]').count();
  obs.panelCount = panelCount;
  if (panelCount === 0) obs.bodyText = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 400);
  if (panelCount > 0) {
    await panel.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(1200);
    const box = await panel.boundingBox();
    obs.panelBox = box;
    const bodies = page.locator('[data-testid^="legion3d-body-"]');
    const nb = await bodies.count();
    obs.bodies = nb;
    const sizes = [];
    for (let i = 0; i < Math.min(nb, 12); i += 1) {
      const b = await bodies.nth(i).boundingBox().catch(() => null);
      if (b) sizes.push({ w: Math.round(b.width), h: Math.round(b.height) });
    }
    obs.bodySizes = sizes;
    obs.paintedBodies = sizes.filter(s => s.w >= 2 && s.h >= 2).length;
    // 关键负控：任何一个体都不能大得像「整块背景」——#4086 就是单个体被放大 ~300 倍铺满面板。
    obs.oversizedBodies = sizes.filter(s => box && (s.w > box.width * 0.5 || s.h > box.height * 0.5)).length;
    const labels = page.locator('[data-testid="legion3d-label"]');
    obs.labels = await labels.count();
    obs.labelTexts = (await labels.allInnerTexts().catch(() => [])).slice(0, 5).map(t => t.trim());
    const stateNodes = page.locator('[data-testid^="legion3d-empty"], [data-testid^="legion3d-error"], [data-testid="legion3d-loading"]');
    obs.stateNodes = await stateNodes.count();
    obs.stateText = (await stateNodes.allInnerTexts().catch(() => [])).join(' ').replace(/\s+/g, ' ').trim().slice(0, 160);
  }
  await page.screenshot({ path: `${OUT}/legion3d.png`, fullPage: false });
  obs.pageErrors = errors.length;
  obs.firstErrors = errors.slice(0, 3);
  console.log('OBSERVATIONS ' + JSON.stringify(obs, null, 2));

  // 2026-11-14 管理员要求把军团 3D 从「组织与权限」页下掉:这里改成负控 —— 页面不应再出现面板和开关,
  // 组织管理内容照常渲染。
  obs.toggleCount = await page.locator('[data-testid="settings-legion3d-toggle"]').count();
  obs.orgSection = await page.locator('[data-testid="settings-section-agent-teams"]').count();
  assert.equal(obs.panelCount, 0, '「组织与权限」页不应再渲染军团 3D 面板');
  assert.equal(obs.toggleCount, 0, '「组织与权限」页不应再有「查看/收起军团 3D」按钮');
  assert.ok(obs.orgSection > 0, '组织管理内容仍应渲染');
  console.log('LEGION3D-REMOVED PASS');
} catch (e) {
  code = 1;
  console.log('OBSERVATIONS ' + JSON.stringify(obs, null, 2));
  console.error('LEGION3D-NONEMPTY FAIL: ' + (e && e.message));
} finally {
  await browser.close().catch(() => {});
  setTimeout(() => process.exit(code), 50);
}
