// 组织架构 v1(board #419)—— 点真按钮、量真框。Placeholder data only, served in-page by the Tauri stub in
// tests/test-layout-sweep/harness.mjs plus a small in-page departments store below (no hub process, no port, no HOME touched).
// Not in CI by itself: needs Playwright + Chromium and a web export.
//
//   WEB_DIR=<expo export dir> [OUT=<png dir>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] node tests/test-org-chart/drive.mjs
//
// phone 390×844 (Android UA ⇒ touch), light + dark — 照 Vincent 2026-10-02 的企业微信截图:
//   open      设置 → 用户管理 →「成员与部门」→ 全屏页:顶栏标题「成员与部门」、搜索框、网络名、部门一行一个(›)、未分配的人;
//             底部「添加成员 | 添加子部门 | 更多」三等分、贴着屏幕底、在视口内
//   drill     点「军团基建」→ 标题换成部门名,列出这个部门的人
//   add-dept  「添加子部门」→ 表单:部门名称* / 上级部门(= 当前部门)/ 部门 ID / 部门负责人 →「完成」只发
//             POST { name, parent_id: 当前部门 } → 回到部门页,新部门在列表里
//   member    点一个人 →「调动到其他部门…」→ 选网络(根)⇒ PUT { department_id: null },他从这个部门里消失
//   delete    「更多」→「删除部门」:部门不空时灰掉并说原因
// desktop 1440×900(设置窗口,鼠标), light + dark:
//   tree      左边部门树(网络 + 部门),右边详情;点部门 → 详情标题是部门名
//   add       「+ 新建子部门」→ 弹窗 → 填名字 →「完成」⇒ POST { name, parent_id } → 树里出现
//   people    主窗口「人员」按部门分组:部门小标题(完整路径)在前,未分配最后
// Each step runs on its own, so a pre-change export shows every red. Exit 1 on any failure.
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium, ANDROID_UA, openStubWindow } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
if (OUT) mkdirSync(OUT, { recursive: true });

const fixture = () => {
  const NET = 'net-sweep';
  const members = [
    { user_id: 'u_me', username: 'tester', display_name: null, role: 'owner', agent_access: 'all' },
    { user_id: 'u_xiang', username: 'xiang', display_name: '项示例', role: 'member', agent_access: 'all' },
    { user_id: 'u_v', username: 'v', display_name: 'V', role: 'member', agent_access: 'all' },
    { user_id: 'u_mao', username: 'mao', display_name: '猫示例', role: 'member', agent_access: 'all' },
    { user_id: 'u_lin', username: 'lin', display_name: '林示例', role: 'admin', agent_access: 'all' },
  ];
  const store = {
    departments: [{ id: 'd_infra', name: '军团基建', parent_id: null, leader_user_id: 'u_lin', sort: 0 }],
    members: { u_me: null, u_xiang: null, u_v: null, u_mao: null, u_lin: 'd_infra' },
  };
  window.__orgCalls = [];
  const view = () => ({
    ok: true,
    departments: store.departments.map(d => ({ ...d, member_count: Object.values(store.members).filter(x => x === d.id).length })),
    members: Object.entries(store.members).map(([user_id, department_id]) => ({ user_id, department_id })),
  });
  window.__routeOverride = (u, body, method) => {
    const p = u.pathname;
    if (p === '/api/auth/me') return { ok: true, user: { user_id: 'u_me', username: 'tester', role: 'user' }, current_network: NET, networks: [{ network_id: NET, network_name: '示例网络', member_role: 'owner', agent_access: 'all' }] };
    if (p === `/api/networks/${NET}/members`) return { ok: true, members };
    if (p === `/api/networks/${NET}/humans`) return { ok: true, humans: members.map(({ user_id, username, display_name }) => ({ user_id, username, display_name })) };
    if (p === '/api/dm/threads') return { ok: true, threads: [] };
    if (p === `/api/networks/${NET}/departments`) {
      if (method === 'POST') {
        const b = JSON.parse(body || '{}');
        window.__orgCalls.push({ method, path: p, body: b });
        if (store.departments.some(d => (d.parent_id ?? null) === (b.parent_id ?? null) && d.name === b.name)) return { ok: false, error: 'department_name_taken' };
        const d = { id: b.id || `d_${store.departments.length}`, name: b.name, parent_id: b.parent_id ?? null, leader_user_id: b.leader_user_id ?? null, sort: store.departments.length };
        store.departments.push(d);
        return { ok: true, department: { ...d, member_count: 0 } };
      }
      return view();
    }
    let m = /^\/api\/networks\/[^/]+\/departments\/([^/]+)$/.exec(p);
    if (m) {
      const id = decodeURIComponent(m[1]);
      const b = body ? JSON.parse(body) : null;
      window.__orgCalls.push({ method, path: p, body: b });
      const d = store.departments.find(x => x.id === id);
      if (!d) return null;
      if (method === 'DELETE') { store.departments = store.departments.filter(x => x.id !== id); return { ok: true, deleted: id }; }
      Object.assign(d, b);
      return { ok: true, department: { ...d, member_count: 0 } };
    }
    m = /^\/api\/networks\/[^/]+\/members\/([^/]+)\/department$/.exec(p);
    if (m) {
      const b = JSON.parse(body || '{}');
      window.__orgCalls.push({ method, path: p, body: b });
      store.members[decodeURIComponent(m[1])] = b.department_id ?? null;
      return { ok: true, user_id: m[1], department_id: b.department_id ?? null };
    }
    return undefined;
  };
};

const tid = (id) => `[data-testid="${id}"]`;
let failures = 0, rows = 0;
const record = (where, what, checks, extra = {}) => {
  const ok = Object.values(checks).every(Boolean);
  rows++; if (!ok) failures++;
  console.log(JSON.stringify({ where, what, ok, failed: Object.keys(checks).filter(k => !checks[k]).join(',') || '-', ...extra }));
};
const r1 = (v) => Math.round(v * 10) / 10;
const calls = (page) => page.evaluate(() => window.__orgCalls.slice());

const web = await serveExport(WEB);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });

// ── phone ──
for (const theme of ['light', 'dark']) {
  const where = `phone/${theme}`;
  const V = { w: 390, h: 844 };
  const ctx = await browser.newContext({ viewport: { width: V.w, height: V.h }, userAgent: ANDROID_UA, hasTouch: true, colorScheme: theme, deviceScaleFactor: 2, locale: 'zh-CN' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).split('\n')[0]));
  const shot = async (n) => { if (OUT) await page.screenshot({ path: `${OUT}/phone-${theme}-${n}.png` }); };
  const step = async (what, fn) => { try { await fn(); } catch (e) { record(where, what, { ran: false }, { error: String(e).split('\n')[0] }); await shot(`FAIL-${what}`); } };
  await page.addInitScript(initScript, { theme });
  await page.addInitScript(fixture);
  await page.addInitScript(() => { try { localStorage.setItem('anet.language.v1', 'zh'); } catch {} });
  await page.goto(`${web.url}?safeAreaSim=32,0,24,0`);
  await step('open', async () => {
    await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 20000 });
    await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'settings' }));
    await page.locator(tid('settings-row-users')).click({ timeout: 10000 });
    await page.locator(tid('org-open')).tap({ timeout: 10000 });
    await page.locator(tid('org-phone')).waitFor({ timeout: 5000 });
    await page.waitForTimeout(400);
    const title = (await page.locator(tid('org-title')).innerText()).trim();
    const crumb = (await page.locator(tid('org-crumb')).innerText()).trim();
    const bar = await page.locator(tid('org-bottom-bar')).boundingBox();
    const btns = await Promise.all(['org-add-member', 'org-add-dept', 'org-more'].map(id => page.locator(tid(id)).boundingBox()));
    const dept = await page.locator(tid('org-dept-d_infra')).boundingBox();
    const unassigned = await page.locator('[data-testid^="org-member-"]').count();
    await shot('1-root');
    record(where, 'open: 成员与部门 like the screenshot', {
      title: title === '成员与部门', crumb: crumb === '示例网络', deptRow: !!dept,
      unassignedPeople: unassigned === 4,
      // 条贴着屏幕底(安全区垫在条里),三个按钮在安全区上面、一样宽、同一行。
      barAtBottom: !!bar && Math.abs(bar.y + bar.height - V.h) <= 1 && btns.every(b => b && Math.abs(b.y + b.height - (V.h - 24)) <= 1),
      threeEqual: btns.every(Boolean) && Math.max(...btns.map(b => b.width)) - Math.min(...btns.map(b => b.width)) <= 0.5 && Math.abs(btns[0].y - btns[2].y) <= 0.5,
      inView: !!bar && bar.x >= 0 && bar.x + bar.width <= V.w + 0.5,
    }, { title, crumb, bar: bar && `${r1(bar.y)}+${r1(bar.height)}`, widths: btns.map(b => b && r1(b.width)).join('/'), btnBottom: btns[0] && r1(btns[0].y + btns[0].height), unassigned });
  });
  await step('drill', async () => {
    await page.locator(tid('org-dept-d_infra')).tap();
    await page.waitForTimeout(300);
    const title = (await page.locator(tid('org-title')).innerText()).trim();
    const lin = await page.locator(tid('org-member-lin')).count();
    await shot('2-dept');
    record(where, 'drill into a department', { title: title === '军团基建', member: lin === 1 }, { title });
  });
  await step('add-dept', async () => {
    await page.locator(tid('org-add-dept')).tap();
    await page.locator(tid('org-dept-form')).waitFor({ timeout: 3000 });
    const parent = (await page.locator(tid('org-dept-parent')).innerText()).replace(/\s+/g, ' ');
    const fields = await Promise.all(['org-dept-name', 'org-dept-parent', 'org-dept-id', 'org-dept-leader'].map(id => page.locator(tid(id)).count()));
    await page.locator(tid('org-dept-name')).fill('示例子部门');
    await shot('3-add-dept-form');
    await page.locator(tid('org-dept-save')).tap();
    await page.waitForTimeout(600);
    const c = await calls(page);
    const post = c.find(x => x.method === 'POST');
    const back = (await page.locator(tid('org-title')).innerText()).trim();
    const newRow = await page.locator('[data-testid^="org-dept-d_"]').count();
    await shot('4-after-add');
    record(where, 'add sub-department (form → POST, back on the department)', {
      fields: fields.every(n => n === 1), parentIsCurrent: parent.includes('军团基建'),
      body: !!post && JSON.stringify(post.body) === JSON.stringify({ name: '示例子部门', parent_id: 'd_infra' }),
      backOnDept: back === '军团基建', listed: newRow >= 1,
    }, { parent, body: post && JSON.stringify(post.body) });
  });
  await step('member', async () => {
    await page.locator(tid('org-member-lin')).tap();
    await page.locator(tid('org-sheet')).waitFor({ timeout: 3000 });
    await shot('5-member-sheet');
    await page.locator(tid('org-member-move')).tap();
    await page.locator(tid('org-pick-move')).waitFor({ timeout: 3000 });
    await page.locator(tid('org-pick-move-opt-root')).tap();
    await page.waitForTimeout(600);
    const put = (await calls(page)).find(x => x.method === 'PUT');
    const still = await page.locator(tid('org-member-lin')).count();
    record(where, 'move a member to the network root (unassign)', { body: !!put && JSON.stringify(put.body) === '{"department_id":null}' && put.path.endsWith('/members/u_lin/department'), gone: still === 0 }, { put: put && JSON.stringify(put) });
  });
  await step('delete', async () => {
    await page.locator(tid('org-more')).tap();
    await page.locator(tid('org-sheet')).waitFor({ timeout: 3000 });
    const reason = (await page.locator(tid('org-more-delete-reason')).count()) ? (await page.locator(tid('org-more-delete-reason')).innerText()).trim() : '';
    const disabled = await page.locator(tid('org-more-delete')).getAttribute('aria-disabled');
    await shot('6-more-sheet');
    await page.locator(tid('org-sheet-cancel')).tap();
    record(where, 'delete is blocked while the department has a sub-department', { disabled: disabled === 'true', reason: reason.includes('1 个子部门') }, { reason });
  });
  record(where, 'page errors', { none: errors.length === 0 }, errors.length ? { errors: errors.slice(0, 3) } : {});
  await ctx.close();
}

// ── desktop ──
for (const theme of ['light', 'dark']) {
  const where = `desktop/${theme}`;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme, deviceScaleFactor: 1, locale: 'zh-CN' });
  const page = await ctx.newPage();
  const errors = [];
  const scripts = [[initScript, { theme }], [fixture, undefined], [() => { try { localStorage.setItem('anet.language.v1', 'zh'); } catch {} }, undefined]];
  for (const [fn, arg] of scripts) await page.addInitScript(fn, arg);
  const step = async (what, fn) => { try { await fn(); } catch (e) { record(where, what, { ran: false }, { error: String(e).split('\n')[0] }); } };
  await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
  let win = null;
  await step('people', async () => {
    await page.locator(tid('desktop-rail')).waitFor({ timeout: 20000 });
    await page.locator(tid('people-section')).waitFor({ timeout: 15000 });
    await page.waitForTimeout(800);
    const titles = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="people-dept-title-"]')].map(e => e.textContent.trim()));
    if (OUT) await page.screenshot({ path: `${OUT}/desktop-${theme}-people-by-dept.png` });
    record(where, '人员 grouped by department', { grouped: titles.length === 2 && titles[0] === '军团基建' && titles[1] === '未分配部门' }, { titles: titles.join('|') });
  });
  await step('tree', async () => {
    await page.getByRole('tab', { name: '设置', exact: true }).click();
    win = await openStubWindow(page, 'settings', scripts);
    if (!win) throw new Error('settings window did not open');
    win.on('pageerror', e => errors.push(String(e).split('\n')[0]));
    await win.setViewportSize({ width: 1440, height: 900 });
    await win.getByRole('button', { name: '设置分类 用户管理' }).click({ timeout: 20000 });
    await win.locator(tid('org-desktop')).scrollIntoViewIfNeeded({ timeout: 10000 });
    await win.locator(tid('org-tree-d_infra')).click();
    await win.waitForTimeout(300);
    const name = (await win.locator(tid('org-detail-name')).innerText()).trim();
    const tree = await win.locator(tid('org-tree')).boundingBox(), detail = await win.locator(tid('org-detail')).boundingBox();
    // 和上面成员那张设置卡片同左右边(同一种 SettingsGroup 卡片)。
    const cards = await win.evaluate(() => [...document.querySelectorAll('[data-testid="settings-kit-card"]')].map(e => { const r = e.getBoundingClientRect(); return { x: r.x, r: r.right, org: !!e.querySelector('[data-testid="org-desktop"]') }; }));
    const orgCard = cards.find(c => c.org), membersCard = cards.find(c => !c.org);
    if (OUT) await win.screenshot({ path: `${OUT}/desktop-${theme}-org.png` });
    record(where, 'left tree + right detail', {
      name: name === '军团基建', sideBySide: !!tree && !!detail && tree.x + tree.width <= detail.x + 1 && Math.abs(tree.y - detail.y) <= 1,
      alignedWithCards: !!orgCard && !!membersCard && Math.abs(orgCard.x - membersCard.x) <= 0.5 && Math.abs(orgCard.r - membersCard.r) <= 0.5,
    }, { name, orgCard: orgCard && `${r1(orgCard.x)}..${r1(orgCard.r)}`, membersCard: membersCard && `${r1(membersCard.x)}..${r1(membersCard.r)}` });
  });
  await step('add', async () => {
    if (!win) throw new Error('no settings window');
    await win.locator(tid('org-detail-add-dept')).click();
    await win.locator(tid('org-dept-dialog')).waitFor({ timeout: 3000 });
    await win.locator(tid('org-dept-name')).fill('示例桌面部门');
    if (OUT) await win.screenshot({ path: `${OUT}/desktop-${theme}-add-dialog.png` });
    await win.locator(tid('org-dept-save')).click();
    await win.waitForTimeout(600);
    const post = (await calls(win)).find(x => x.method === 'POST');
    const inTree = await win.locator('[data-testid^="org-tree-d_"]').count();
    record(where, 'new sub-department from the detail (dialog → POST → tree)', { body: !!post && JSON.stringify(post.body) === JSON.stringify({ name: '示例桌面部门', parent_id: 'd_infra' }), inTree: inTree >= 2, closed: (await win.locator(tid('org-dept-dialog')).count()) === 0 }, { body: post && JSON.stringify(post.body) });
  });
  record(where, 'page errors', { none: errors.length === 0 }, errors.length ? { errors: errors.slice(0, 3) } : {});
  await ctx.close();
}
await browser.close();
web.close();
console.log(failures ? `\n${failures}/${rows} rows failed` : `\nall ${rows} rows passed`);
process.exit(failures || rows === 0 ? 1 : 0);
