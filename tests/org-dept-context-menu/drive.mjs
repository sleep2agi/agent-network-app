// 管理员 2026-11-14「这个支持一下右键,可以新建组织、重命名组织等」:设置「组织与权限 → 部门与 Agent」左栏部门树。
//
// 渲染态 web export + 页内 Hub fixture(不起 hub、不碰生产)。断言:
//   ① 管理员右键部门行 → 自己的菜单(新建子部门 / 重命名 / 移动到… / 删除 / 新建根部门),浏览器原生菜单被拦
//   ② 重命名 → PATCH 只带 name;树里换成新名字
//   ③ 新建子部门 → POST 带 parent_id;新部门出现在树里
//   ④ 有成员的部门删除被本地挡住(按钮禁用 + 说明);空部门删除 → DELETE,行消失
//   ⑤ 右键「未归属」→ 只有「新建根部门」
//   ⑥ 普通成员(Hub viewer_can 全 false):右键不出菜单、不拦原生菜单;页头仍是只读说明
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const web = await serveExport(process.env.WEB_DIR);
const OUT = process.env.OUT_DIR || '/tmp/org-dept-context-menu';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: findChromium(), args: ['--no-sandbox'] });

const fixture = (admin) => {
  const NET = 'net-org';
  const can = { manage: admin, create_child: admin };
  let departments = [
    { id: 'd_a', name: '研发', parent_id: null, leader_user_id: null, sort: 0 },
    { id: 'd_b', name: '产品', parent_id: null, leader_user_id: null, sort: 1 },
    { id: 'd_c', name: '运营', parent_id: null, leader_user_id: null, sort: 2 },
  ];
  const members = [{ user_id: 'u_me', department_id: null }, { user_id: 'u_y', department_id: 'd_b' }];
  window.__deptCalls = [];
  window.__routeOverride = (u, body, method) => {
    const p = u.pathname;
    const m = method || 'GET';
    if (p === '/api/auth/me') return { ok: true, user: { user_id: 'u_me', username: 'tester', role: admin ? 'admin' : 'user' }, current_network: NET, networks: [{ id: NET, name: '网络', member_role: admin ? 'owner' : 'member' }] };
    if (p === '/api/dm/threads') return { ok: true, threads: [] };
    if (p === '/api/status') return { ok: true, sessions: [] };
    if (p === '/api/nodes') return { ok: true, nodes: [] };
    if (p === `/api/networks/${NET}/departments` && m === 'GET') {
      return { ok: true, departments: departments.map(d => ({ ...d, viewer_can: can, member_count: members.filter(x => x.department_id === d.id).length })), members };
    }
    if (p === `/api/networks/${NET}/departments` && m === 'POST') {
      const b = JSON.parse(body || '{}');
      window.__deptCalls.push({ method: m, path: p, body: b });
      const d = { id: `d_new${departments.length}`, name: b.name, parent_id: b.parent_id ?? null, leader_user_id: null, sort: departments.length };
      departments = [...departments, d];
      return { ok: true, department: { ...d, member_count: 0 } };
    }
    const one = p.match(new RegExp(`^/api/networks/${NET}/departments/([^/]+)$`));
    if (one) {
      const id = decodeURIComponent(one[1]);
      const b = body ? JSON.parse(body) : null;
      window.__deptCalls.push({ method: m, path: p, body: b });
      if (m === 'PATCH') {
        departments = departments.map(d => (d.id === id ? { ...d, ...b } : d));
        const d = departments.find(x => x.id === id);
        return { ok: true, department: { ...d, member_count: 0 } };
      }
      if (m === 'DELETE') { departments = departments.filter(d => d.id !== id); return { ok: true, deleted: id }; }
    }
    if (p === `/api/networks/${NET}/humans`) return { ok: true, humans: [{ user_id: 'u_me', username: 'me' }, { user_id: 'u_y', username: 'y' }] };
    if (p === '/api/requirements/people/directory') {
      return { ok: true, people: [], agents_without_owner: [{ node_id: 'n_1', alias: '示例甲' }], has_more: false, next_offset: null, agent_department_supported: true };
    }
    if (p === '/api/requirements/people') return { ok: true, people: members };
    return undefined;
  };
};

const openOrg = async (admin) => {
  const ctx = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(initScript, { theme: 'light' });
  await page.addInitScript(fixture, admin);
  await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
  await page.waitForFunction(() => !!window.__anetLayoutSweep);
  await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'settings' }));
  await page.waitForTimeout(1200);
  await page.getByText('组织与权限', { exact: true }).first().click();
  await page.locator('[data-testid="agent-org-dept-d_a"]').waitFor();
  return { ctx, page, errors };
};
// 真实右键事件(可取消);dispatchEvent 返回 false = 有人 preventDefault 了(即浏览器原生菜单被拦)。
const rightClick = async (page, sel) => {
  const prevented = await page.locator(sel).evaluate(el => {
    const r = el.getBoundingClientRect();
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: r.left + 40, clientY: r.top + r.height / 2 });
    return !el.dispatchEvent(ev);
  });
  await page.waitForTimeout(300);
  return prevented;
};
const menuItems = page => page.locator('[data-testid^="agent-org-dept-menu-"][role="menuitem"]').evaluateAll(els => els.map(e => e.getAttribute('data-testid').replace('agent-org-dept-menu-', '')));
const label = (page, id) => page.locator(`[data-testid="agent-org-dept-${id}-label"]`).innerText();

let code = 0;
try {
  // ── 管理员 ──
  {
    const { ctx, page, errors } = await openOrg(true);
    assert.equal(await page.locator('[data-testid="agent-org-departments-edit-hint"]').count(), 1, '管理员看到「右键可编辑」提示');

    // ① 右键部门
    assert.equal(await rightClick(page, '[data-testid="agent-org-dept-d_a"]'), true, '浏览器原生菜单应被拦');
    await page.locator('[data-testid="agent-org-dept-menu"]').waitFor();
    assert.deepEqual(await menuItems(page), ['createChild', 'rename', 'reparent', 'delete', 'createRoot']);
    await page.screenshot({ path: `${OUT}/1-menu.png` });

    // ② 重命名
    await page.locator('[data-testid="agent-org-dept-menu-rename"]').click();
    const nameBox = page.locator('[data-testid="agent-org-department-name"]');
    await nameBox.fill('研发中心');
    await page.locator('[data-testid="agent-org-department-save"]').click();
    await page.locator('[data-testid="agent-org-department-editor"]').waitFor({ state: 'detached' });
    assert.equal(await label(page, 'd_a'), '研发中心');
    let calls = await page.evaluate(() => window.__deptCalls);
    assert.deepEqual(calls.at(-1), { method: 'PATCH', path: '/api/networks/net-org/departments/d_a', body: { name: '研发中心' } });

    // ③ 新建子部门
    await rightClick(page, '[data-testid="agent-org-dept-d_a"]');
    await page.locator('[data-testid="agent-org-dept-menu-createChild"]').click();
    await page.locator('[data-testid="agent-org-department-name"]').fill('前端组');
    await page.locator('[data-testid="agent-org-department-save"]').click();
    await page.locator('[data-testid="agent-org-department-editor"]').waitFor({ state: 'detached' });
    calls = await page.evaluate(() => window.__deptCalls);
    assert.deepEqual(calls.at(-1).body, { name: '前端组', parent_id: 'd_a' });
    assert.equal(await page.getByText('前端组', { exact: true }).count() > 0, true, '新子部门出现在树里');

    // ④a 有成员的部门:删除被挡
    await rightClick(page, '[data-testid="agent-org-dept-d_b"]');
    await page.locator('[data-testid="agent-org-dept-menu-delete"]').click();
    await page.locator('[data-testid="agent-org-delete-blocked"]').waitFor();
    assert.match(await page.locator('[data-testid="agent-org-delete-blocked"]').innerText(), /1 个成员/);
    assert.equal(await page.locator('[data-testid="agent-org-delete-confirm"]').getAttribute('aria-disabled'), 'true');
    await page.screenshot({ path: `${OUT}/2-delete-blocked.png` });
    await page.keyboard.press('Escape');
    await page.locator('[data-testid="agent-org-delete-dialog"]').waitFor({ state: 'detached' });

    // ④b 空部门:删除
    await rightClick(page, '[data-testid="agent-org-dept-d_c"]');
    await page.locator('[data-testid="agent-org-dept-menu-delete"]').click();
    await page.locator('[data-testid="agent-org-delete-text"]').waitFor();
    await page.locator('[data-testid="agent-org-delete-confirm"]').click();
    await page.locator('[data-testid="agent-org-delete-dialog"]').waitFor({ state: 'detached' });
    calls = await page.evaluate(() => window.__deptCalls);
    assert.deepEqual(calls.at(-1), { method: 'DELETE', path: '/api/networks/net-org/departments/d_c', body: null });
    assert.equal(await page.locator('[data-testid="agent-org-dept-d_c"]').count(), 0, '删掉的部门不在树里');
    assert.match(await page.locator('[data-testid="agent-org-department-result"]').innerText(), /已删除「运营」/);

    // ⑤ 右键未归属 → 只有新建根部门
    await rightClick(page, '[data-testid="agent-org-dept-unassigned"]');
    await page.locator('[data-testid="agent-org-dept-menu"]').waitFor();
    assert.deepEqual(await menuItems(page), ['createRoot']);
    await page.locator('[data-testid="agent-org-dept-menu-scrim"]').click({ position: { x: 5, y: 5 } });
    await page.locator('[data-testid="agent-org-dept-menu"]').waitFor({ state: 'detached' });

    await page.screenshot({ path: `${OUT}/3-after.png` });
    assert.deepEqual(errors, [], `页面不应报错:${errors.slice(0, 2).join(' | ')}`);
    await ctx.close();
  }
  // ── 普通成员 ──
  {
    const { ctx, page, errors } = await openOrg(false);
    assert.equal(await rightClick(page, '[data-testid="agent-org-dept-d_a"]'), false, '没权限时不拦浏览器原生菜单');
    assert.equal(await page.locator('[data-testid="agent-org-dept-menu"]').count(), 0, '没权限时不出菜单');
    assert.equal(await page.locator('[data-testid="agent-org-departments-elsewhere"]').count(), 1, '只读说明仍在');
    assert.deepEqual(errors, []);
    await ctx.close();
  }
  console.log('ORG-DEPT-CONTEXT-MENU PASS');
} catch (e) {
  code = 1;
  console.error(e);
} finally {
  await browser.close().catch(() => {});
  setTimeout(() => process.exit(code), 50);
}
