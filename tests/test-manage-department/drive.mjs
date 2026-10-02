// 「管理本部门」(board #485,RFC-040;Hub ≥ .91)—— 点真按钮、量真框。Placeholder data only, served in-page by the Tauri
// stub in tests/test-layout-sweep/harness.mjs plus a small in-page Hub below that answers like Hub .91 (viewer_can per
// department, 403 department_scope_denied outside the subtree). No hub process, no port, no HOME touched.
// Not in CI by itself: needs Playwright + Chromium and a web export.
//
//   WEB_DIR=<expo export dir> [OUT=<png dir>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] node tests/test-manage-department/drive.mjs
//
// 组织架构:研发(d_rd,别人负责)› 前端(d_fe,我负责)› 前端一组(d_fe1);研发 › 后端(d_be);销售(d_sales)。
// 我(tester)在前端,示例成员甲在前端一组(他有一个 Agent,报了降级),示例成员乙在后端。
//
// phone 390×844 (Android UA ⇒ touch), light + dark:
//   entry    设置列表最上面一组「管理本部门」→ 全屏,直接进「前端」(只负责一个部门);底栏只有「添加成员 | 添加子部门」
//            (自己负责的那个部门归上一级 ⇒ 没有「更多」);点一组 → 有「更多」
//   links    部门页底部「本部门任务」→ 两张卡;「本部门 Agent」→ 一个 Agent,降级原因写出来
//   move     点前端一组的人 →「调动到其他部门…」→ 后端、网络根灰掉不能点;选「前端」⇒ PUT { department_id: 'd_fe' }
//   not-head 不是负责人(managed_department_ids = [])/ 旧 Hub(没有这个字段):设置里没有这一组
// desktop 1440×900 (mouse), light + dark:
//   entry    侧栏「人员」上方一项「管理本部门」→ 居中大弹窗,左树右详情;研发 / 销售 / 网络根灰掉点不了
//   own      选中「前端」:没有「部门设置 / 移动到 / 删除」(归上一级),有「+ 新建子部门」;成员 / 任务 / Agent 三个页签
//   tabs     任务页签 = department_id 筛出来的两张卡;Agent 页签 = 一个 Agent(只读)
//   child    选「前端一组」:有「部门设置」
//   not-head 不是负责人:侧栏没有这一项
// Each step runs on its own, so a pre-change export shows every red. Exit 1 on any failure.
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium, ANDROID_UA } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
if (OUT) mkdirSync(OUT, { recursive: true });

const fixture = ({ managed }) => {
  const NET = 'net-sweep';
  const humans = [
    { user_id: 'u_me', username: 'tester', display_name: null },
    { user_id: 'u_a', username: 'member_a', display_name: '示例成员甲' },
    { user_id: 'u_b', username: 'member_b', display_name: '示例成员乙' },
  ];
  const store = {
    departments: [
      { id: 'd_rd', name: '研发', parent_id: null, leader_user_id: null, sort: 0 },
      { id: 'd_fe', name: '前端', parent_id: 'd_rd', leader_user_id: 'u_me', sort: 0 },
      { id: 'd_fe1', name: '前端一组', parent_id: 'd_fe', leader_user_id: null, sort: 0 },
      { id: 'd_be', name: '后端', parent_id: 'd_rd', leader_user_id: null, sort: 1 },
      { id: 'd_sales', name: '销售', parent_id: null, leader_user_id: null, sort: 1 },
    ],
    members: { u_me: 'd_fe', u_a: 'd_fe1', u_b: 'd_be' },
  };
  const mine = new Set(managed === 'old' ? [] : managed);
  const strict = new Set([...mine].filter(id => { const d = store.departments.find(x => x.id === id); return d && d.parent_id && mine.has(d.parent_id); }));
  window.__orgCalls = [];
  const view = () => ({
    ok: true,
    departments: store.departments.map(d => ({ ...d, member_count: Object.values(store.members).filter(x => x === d.id).length, ...(managed === 'old' ? {} : { viewer_can: { manage: strict.has(d.id), create_child: mine.has(d.id) } }) })),
    members: Object.entries(store.members).map(([user_id, department_id]) => ({ user_id, department_id })),
  });
  const denied = { ok: false, error: 'department_scope_denied' };
  window.__routeOverride = (u, body, method) => {
    const p = u.pathname;
    if (p === '/api/auth/me') return { ok: true, user: { user_id: 'u_me', username: 'tester', role: 'user' }, current_network: NET, networks: [{ network_id: NET, network_name: '示例网络', member_role: 'member', agent_access: 'granted', task_access: 'scoped', ...(managed === 'old' ? {} : { managed_department_ids: [...mine] }) }] };
    if (p === `/api/networks/${NET}/humans`) return { ok: true, humans };
    if (p === '/api/dm/threads') return { ok: true, threads: [] };
    if (p === `/api/networks/${NET}/departments`) return method === 'GET' ? view() : denied;
    if (p === '/api/requirements' && u.searchParams.get('department_id')) {
      window.__orgCalls.push({ method, path: `${p}?department_id=${u.searchParams.get('department_id')}` });
      return { ok: true, requirements: [
        { id: 'r1', seq: 12, name: '示例任务:登录页改版', column: 'doing', priority: 'normal', owner: { kind: 'user', id: 'u_a' }, participants: [] },
        { id: 'r2', seq: 13, name: '示例任务:组件库升级', column: 'pool', priority: 'normal', owner: null, agent_owner: { kind: 'node', id: 'n_a' }, participants: [] },
      ], capabilities: [] };
    }
    let m = /^\/api\/networks\/[^/]+\/departments\/([^/]+)\/nodes$/.exec(p);
    if (m) return { ok: true, nodes: [{ node_id: 'n_a', alias: '示例-甲的助手', display_name: null, owner_user_id: 'u_a', status: 'idle', last_seen_at: null, health: null, degraded: [{ layer: 'app_server', label: '运行时', reason: '端口无响应' }] }] };
    m = /^\/api\/networks\/[^/]+\/departments\/([^/]+)$/.exec(p);
    if (m) { window.__orgCalls.push({ method, path: p, body: body ? JSON.parse(body) : null }); return strict.has(decodeURIComponent(m[1])) ? { ok: true, department: store.departments.find(d => d.id === decodeURIComponent(m[1])) } : denied; }
    m = /^\/api\/networks\/[^/]+\/members\/([^/]+)\/department$/.exec(p);
    if (m) {
      const b = JSON.parse(body || '{}');
      window.__orgCalls.push({ method, path: p, body: b });
      const uid = decodeURIComponent(m[1]);
      if (!mine.has(store.members[uid]) || !mine.has(b.department_id)) return denied;
      store.members[uid] = b.department_id;
      return { ok: true, user_id: uid, department_id: b.department_id };
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
const calls = (page) => page.evaluate(() => window.__orgCalls.slice());
const has = async (page, id) => (await page.locator(tid(id)).count()) > 0;
const disabled = async (page, id) => (await page.locator(tid(id)).first().getAttribute('aria-disabled')) === 'true';

const web = await serveExport(WEB);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });

// ── phone ──
for (const theme of ['light', 'dark']) {
  for (const managed of theme === 'light' ? [['d_fe', 'd_fe1'], [], 'old'] : [['d_fe', 'd_fe1']]) {
    const head = Array.isArray(managed) && managed.length > 0;
    const where = `phone/${theme}${head ? '' : managed === 'old' ? '/old-hub' : '/not-head'}`;
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: ANDROID_UA, hasTouch: true, colorScheme: theme, deviceScaleFactor: 2, locale: 'zh-CN' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e).split('\n')[0]));
    const shot = async (n) => { if (OUT) await page.screenshot({ path: `${OUT}/phone-${theme}-${n}.png` }); };
    const step = async (what, fn) => { try { await fn(); } catch (e) { record(where, what, { ran: false }, { error: String(e).split('\n')[0] }); await shot(`FAIL-${what}`); } };
    await page.addInitScript(initScript, { theme });
    await page.addInitScript(fixture, { managed });
    await page.addInitScript(() => { try { localStorage.setItem('anet.language.v1', 'zh'); } catch {} });
    await page.goto(`${web.url}?safeAreaSim=32,0,24,0`);
    await step('entry', async () => {
      await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 20000 });
      await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'settings' }));
      await page.locator(tid('settings-phone-list')).waitFor({ timeout: 10000 });
      await page.waitForTimeout(800);
      if (!head) {
        record(where, 'no entry for a non-head / on an old Hub', { absent: !(await has(page, 'settings-row-manageDepartment')) });
        return;
      }
      const row = await page.locator(tid('settings-row-manageDepartment')).boundingBox();
      const firstGroup = await page.locator(tid('settings-group-0')).boundingBox();
      await page.locator(tid('settings-row-manageDepartment')).tap();
      await page.locator(tid('org-phone')).waitFor({ timeout: 8000 });
      await page.waitForTimeout(400);
      const title = (await page.locator(tid('org-title')).innerText()).trim();
      await shot('1-own-department');
      record(where, 'settings row → straight into the one department I lead', {
        rowAboveGroups: !!row && !!firstGroup && row.y + row.height <= firstGroup.y + 0.5,
        title: title === '前端',
        addMember: await has(page, 'org-add-member'), addDept: await has(page, 'org-add-dept'),
        noMoreOnOwn: !(await has(page, 'org-more')),
        links: await has(page, 'org-head-tasks') && await has(page, 'org-head-agents'),
      }, { title });
    });
    if (!head) { record(where, 'page errors', { none: errors.length === 0 }, errors.length ? { errors: errors.slice(0, 3) } : {}); await ctx.close(); continue; }
    await step('child', async () => {
      await page.locator(tid('org-dept-d_fe1')).tap();
      await page.waitForTimeout(300);
      const title = (await page.locator(tid('org-title')).innerText()).trim();
      await shot('2-child');
      record(where, 'a sub-department I manage has 更多', { title: title === '前端一组', more: await has(page, 'org-more') }, { title });
    });
    await step('move', async () => {
      await page.locator(tid('org-member-member_a')).tap();
      await page.locator(tid('org-sheet')).waitFor({ timeout: 3000 });
      const noUnassign = !(await has(page, 'org-member-remove'));
      await page.locator(tid('org-member-move')).tap();
      await page.locator(tid('org-pick-move')).waitFor({ timeout: 3000 });
      const offBe = await disabled(page, 'org-pick-move-opt-d_be');
      const offRoot = await disabled(page, 'org-pick-move-opt-root');
      const offRd = await disabled(page, 'org-pick-move-opt-d_rd');
      const onFe = !(await disabled(page, 'org-pick-move-opt-d_fe'));
      await shot('3-move-picker');
      await page.locator(tid('org-pick-move-opt-d_fe')).tap();
      await page.waitForTimeout(600);
      const put = (await calls(page)).find(x => x.method === 'PUT');
      record(where, 'move only inside my subtree', { noUnassign, offBe, offRoot, offRd, onFe, body: !!put && JSON.stringify(put.body) === '{"department_id":"d_fe"}' && put.path.endsWith('/members/u_a/department') }, { put: put && JSON.stringify(put.body) });
    });
    await step('links', async () => {
      await page.locator(tid('org-back')).tap();
      await page.waitForTimeout(300);
      if ((await page.locator(tid('org-title')).innerText()).trim() !== '前端') { await page.locator(tid('org-back')).tap(); await page.waitForTimeout(300); }
      await page.locator(tid('org-head-tasks')).tap();
      await page.locator(tid('dept-tasks')).waitFor({ timeout: 5000 });
      const tasks = await page.locator('[data-testid^="dept-task-r"]').count();
      const taskCall = (await calls(page)).find(x => x.path.includes('department_id='));
      await shot('4-tasks');
      await page.locator(tid('org-back')).tap();
      await page.locator(tid('org-head-agents')).tap();
      await page.locator(tid('dept-agents')).waitFor({ timeout: 5000 });
      const agent = await has(page, 'dept-agent-n_a');
      const degraded = (await page.locator(tid('dept-agent-degraded-n_a-app_server')).innerText()).trim();
      await shot('5-agents');
      record(where, '本部门任务 / 本部门 Agent', { tasks: tasks === 2, filtered: !!taskCall && taskCall.path.endsWith('department_id=d_fe'), agent, degraded: degraded.includes('端口无响应') }, { tasks, degraded });
    });
    record(where, 'page errors', { none: errors.length === 0 }, errors.length ? { errors: errors.slice(0, 3) } : {});
    await ctx.close();
  }
}

// ── desktop ──
for (const theme of ['light', 'dark']) {
  for (const managed of theme === 'light' ? [['d_fe', 'd_fe1'], []] : [['d_fe', 'd_fe1']]) {
    const head = managed.length > 0;
    const where = `desktop/${theme}${head ? '' : '/not-head'}`;
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme, deviceScaleFactor: 1, locale: 'zh-CN' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e).split('\n')[0]));
    await page.addInitScript(initScript, { theme });
    await page.addInitScript(fixture, { managed });
    await page.addInitScript(() => { try { localStorage.setItem('anet.language.v1', 'zh'); } catch {} });
    const step = async (what, fn) => { try { await fn(); } catch (e) { record(where, what, { ran: false }, { error: String(e).split('\n')[0] }); if (OUT) await page.screenshot({ path: `${OUT}/desktop-${theme}-FAIL-${what}.png` }); } };
    await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
    await step('entry', async () => {
      await page.locator(tid('desktop-rail')).waitFor({ timeout: 20000 });
      await page.locator(tid('people-section')).waitFor({ timeout: 15000 });
      await page.waitForTimeout(800);
      if (!head) { record(where, 'no sidebar entry for a non-head', { absent: !(await has(page, 'manage-dept-entry')) }); return; }
      const entry = await page.locator(tid('manage-dept-entry')).boundingBox();
      const people = await page.locator(tid('people-section')).boundingBox();
      if (OUT) await page.screenshot({ path: `${OUT}/desktop-${theme}-1-sidebar.png` });
      await page.locator(tid('manage-dept-entry')).click();
      await page.locator(tid('manage-dept-desktop')).waitFor({ timeout: 5000 });
      await page.locator(tid('org-desktop')).waitFor({ timeout: 8000 });
      await page.waitForTimeout(400);
      const name = (await page.locator(tid('org-detail-name')).innerText()).trim();
      record(where, 'sidebar entry above 人员 → dialog on my department, outside greyed', {
        aboveNotOverlapping: !!entry && !!people && entry.y + entry.height <= people.y + 0.5 && Math.abs(entry.x - people.x) <= 0.5,
        name: name === '前端',
        rdOff: await disabled(page, 'org-tree-d_rd'), salesOff: await disabled(page, 'org-tree-d_sales'), rootOff: await disabled(page, 'org-tree-root'),
        feOn: !(await disabled(page, 'org-tree-d_fe')), fe1On: !(await disabled(page, 'org-tree-d_fe1')),
      }, { name });
    });
    if (!head) { record(where, 'page errors', { none: errors.length === 0 }, errors.length ? { errors: errors.slice(0, 3) } : {}); await ctx.close(); continue; }
    await step('own', async () => {
      if (OUT) await page.screenshot({ path: `${OUT}/desktop-${theme}-2-own.png` });
      record(where, 'own department: no settings / move / delete; can add a sub-department; three tabs', {
        noEdit: !(await has(page, 'org-detail-edit')), noMove: !(await has(page, 'org-detail-move')), noDelete: !(await has(page, 'org-detail-delete')),
        noLeaderChange: !(await has(page, 'org-detail-leader-set')),
        addChild: await has(page, 'org-detail-add-dept'),
        tabs: await has(page, 'org-head-tab-members') && await has(page, 'org-head-tab-tasks') && await has(page, 'org-head-tab-agents'),
      });
    });
    await step('tabs', async () => {
      await page.locator(tid('org-head-tab-tasks')).click();
      await page.locator(tid('dept-tasks')).waitFor({ timeout: 5000 });
      const tasks = await page.locator('[data-testid^="dept-task-r"]').count();
      const col = (await page.locator(tid('dept-task-col-r1')).innerText()).trim();
      if (OUT) await page.screenshot({ path: `${OUT}/desktop-${theme}-3-tasks.png` });
      await page.locator(tid('org-head-tab-agents')).click();
      await page.locator(tid('dept-agents')).waitFor({ timeout: 5000 });
      const agent = await has(page, 'dept-agent-n_a');
      if (OUT) await page.screenshot({ path: `${OUT}/desktop-${theme}-4-agents.png` });
      await page.locator(tid('org-head-tab-members')).click();
      record(where, '任务 / Agent tabs', { tasks: tasks === 2, col: col === '进行中', agent }, { tasks, col });
    });
    await step('child', async () => {
      await page.locator(tid('org-tree-d_fe1')).click();
      await page.waitForTimeout(300);
      const name = (await page.locator(tid('org-detail-name')).innerText()).trim();
      const unassign = await page.locator('[data-testid^="org-desk-remove-"]').count();
      if (OUT) await page.screenshot({ path: `${OUT}/desktop-${theme}-5-child.png` });
      record(where, 'a sub-department I manage: 部门设置 shows, no 移出', { name: name === '前端一组', edit: await has(page, 'org-detail-edit'), move: await has(page, 'org-desk-move-member_a'), noUnassign: unassign === 0 }, { name });
    });
    record(where, 'page errors', { none: errors.length === 0 }, errors.length ? { errors: errors.slice(0, 3) } : {});
    await ctx.close();
  }
}
await browser.close();
web.close();
console.log(failures ? `\n${failures}/${rows} rows failed` : `\nall ${rows} rows passed`);
process.exit(failures || rows === 0 ? 1 : 0);
