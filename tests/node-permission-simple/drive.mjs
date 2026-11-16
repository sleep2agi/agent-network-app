// admin 2026-11-16「还是没有一个简单易用明了的权限方案」「交互体验要好」:节点权限「两个问题」。
//
// 渲染态 web export + 页内 Hub fixture。断言:
//   ① 默认:「成员」「所有人」选中;细项卡片收在「高级」里(默认看不到「可以发给」)
//   ② 点「部门管理」→ 就地出部门列表 → 点部门:一次 PUT grants = 三项 edit 同一部门;标题旁「已保存」
//   ③ 点「本部门」(收窄)→ 先出确认,不发请求;确认 → PUT inbox = [dept:d_a, user:admin]
//   ④ 点「只有主人」→ 确认 → PUT inbox = [user:admin];取消则不发
//   ⑤ 节点没部门 ⇒「本部门」灰掉并写原因
//   ⑥ 对不上任何一档的授权 ⇒ 显示「自定义」;改成「成员」先确认会替换
//   ⑦ 手机宽度不横向溢出;无页面错误
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const web = await serveExport(process.env.WEB_DIR);
const OUT = process.env.OUT_DIR || '/tmp/node-permission-simple';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: findChromium(), args: ['--no-sandbox'] });

const fixture = ({ noDept, customGrants }) => {
  const NET = 'net-org';
  const now = new Date().toISOString();
  const node = { node_id: 'n_100', alias: '通信欧', owner_user_id: 'u_me', permission_mode: 'normal', department_id: noDept ? null : 'd_a', lifecycle_state: 'active',
    viewer_can: { permission_mode: true }, attrs_revision: 1, inbox_allowlist: null, peer_allowlist: null, tool_allowlist: null };
  let grants = customGrants ? [{ capability: 'schedules', scope_kind: 'network', scope_id: '', level: 'read' }] : [];
  window.__puts = { grants: [], inbox: [], mode: [] };
  window.__routeOverride = (u, body, method) => {
    const p = u.pathname;
    if (p === '/health') return { ok: true, version: '0.9.0-preview.285', capabilities: ['node_permission_mode', 'node_inbox_allowlist', 'node_inbox_allowlist_dept', 'node_grants'] };
    if (p === '/api/auth/me') return { ok: true, user: { user_id: 'u_me', username: 'admin', role: 'admin' }, current_network: NET, networks: [{ network_id: NET, network_name: '网络', member_role: 'owner' }] };
    if (p === '/api/dm/threads') return { ok: true, threads: [] };
    if (p === '/api/status') return { ok: true, sessions: [{ alias: '通信欧', status: 'idle', agent: 'claude-code', runtime: 'agent-node', node_id: 'n_100', updated_at: now }] };
    if (p === '/api/nodes/n_100/grants' && method === 'PUT') { const b = JSON.parse(body || '{}'); window.__puts.grants.push(b.grants); grants = b.grants; return { ok: true, grants, capabilities: ['schedules', 'board', 'rules'] }; }
    if (p === '/api/nodes/n_100/grants') return { ok: true, grants, capabilities: ['schedules', 'board', 'rules'] };
    if (p === '/api/nodes/n_100/inbox-allowlist' && method === 'PUT') { const b = JSON.parse(body || '{}'); window.__puts.inbox.push(b.senders); node.inbox_allowlist = b.senders; return { ok: true, node_id: 'n_100', senders: b.senders }; }
    if (p === '/api/nodes/n_100/permission-mode' && method === 'PUT') { const b = JSON.parse(body || '{}'); window.__puts.mode.push(b.permission_mode ?? b.mode); return { ok: true, node_id: 'n_100', permission_mode: b.permission_mode ?? b.mode }; }
    if (p === '/api/nodes') return { ok: true, nodes: [{ ...node }] };
    if (p === `/api/networks/${NET}/departments`) return { ok: true, departments: [
      { id: 'd_a', name: 'ANet', parent_id: null, leader_user_id: null, sort: 0, viewer_can: { manage: true, create_child: true }, member_count: 0 },
      { id: 'd_b', name: 'TMWork', parent_id: null, leader_user_id: null, sort: 1, viewer_can: { manage: true, create_child: true }, member_count: 0 },
    ], members: [] };
    if (p === `/api/networks/${NET}/humans`) return { ok: true, humans: [{ user_id: 'u_me', username: 'admin' }] };
    if (p === '/api/requirements/people/directory') return { ok: true, people: [{ user_id: 'u_me', username: 'admin', agents: [{ node_id: 'n_100', alias: '通信欧', updated_at: now, lifecycle_state: 'active', department_id: noDept ? null : 'd_a' }] }], agents_without_owner: [], has_more: false, next_offset: null, agent_department_supported: true };
    if (p === '/api/requirements/people') return { ok: true, people: [] };
    return undefined;
  };
};

const results = [];
const record = (name, ok, detail) => { results.push(ok); console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ' ' + JSON.stringify(detail)}`); };
const tid = s => `[data-testid="${s}"]`;
const checked = async (page, id) => (await page.locator(tid(id)).getAttribute('aria-checked')) === 'true';

const open = async (opts, viewport = { width: 1240, height: 900 }) => {
  const ctx = await browser.newContext({ locale: 'zh-CN', viewport, colorScheme: 'light' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(initScript, { theme: 'light' });
  await page.addInitScript(fixture, opts);
  await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
  if (viewport.width < 600) {
    await page.locator(tid('mobile-tab-org')).click();
    await page.locator(tid(opts.noDept ? 'agent-org-dept-unassigned' : 'agent-org-dept-d_a')).first().click().catch(async () => { await page.getByText(opts.noDept ? '未归属' : 'ANet', { exact: true }).first().click(); });
  } else {
    await page.getByRole('tab', { name: '组织', exact: true }).click();
    await page.locator(tid(opts.noDept ? 'agent-org-dept-unassigned' : 'agent-org-dept-d_a')).click();
  }
  await page.locator(tid('agent-org-agent-n_100')).click();
  await page.locator(tid('node-perm-simple')).waitFor();
  await page.waitForTimeout(800);
  return { ctx, page, errors };
};

{
  const { ctx, page, errors } = await open({});
  await page.screenshot({ path: `${OUT}/1-default.png`, fullPage: false });
  record('① 默认「成员」「所有人」选中', await checked(page, 'node-perm-role-member') && await checked(page, 'node-perm-reach-all'), null);
  record('① 细项收在「高级」里(默认看不到「可以发给」卡)', (await page.locator(tid('node-peer-allowlist-card')).count()) === 0 && await page.locator(tid('node-perm-advanced-toggle')).isVisible(), null);

  await page.locator(tid('node-perm-role-dept')).click();
  await page.locator(tid('node-perm-role-dept-picker')).waitFor();
  const before = await page.evaluate(() => window.__puts.grants.length);
  await page.locator(tid('node-perm-role-dept-d_a')).click();
  await page.locator(tid('node-perm-simple-role-title-saved')).waitFor();
  const g = await page.evaluate(() => window.__puts.grants);
  record('② 部门管理:选部门前不发请求;选后一次 PUT 三项 edit 同部门', before === 0 && g.length === 1 && g[0].length === 3 && g[0].every(x => x.scope_kind === 'department' && x.scope_id === 'd_a' && x.level === 'edit'), g);
  record('② 部门管理选中并标出部门名', await checked(page, 'node-perm-role-dept') && (await page.locator(tid('node-perm-role-dept')).innerText()).includes('ANet'), null);
  await page.screenshot({ path: `${OUT}/2-dept.png` });

  await page.locator(tid('node-perm-reach-dept')).click();
  await page.locator(tid('node-perm-simple-confirm')).waitFor();
  const noPutYet = await page.evaluate(() => window.__puts.inbox.length === 0);
  await page.screenshot({ path: `${OUT}/3-confirm.png` });
  await page.locator(tid('node-perm-simple-confirm-ok')).click();
  await page.locator(tid('node-perm-simple-reach-title-saved')).waitFor();
  const inbox1 = await page.evaluate(() => window.__puts.inbox);
  record('③ 收窄先确认不发;确认后 inbox = [dept:d_a, user:admin]', noPutYet && JSON.stringify(inbox1) === JSON.stringify([['dept:d_a', 'user:admin']]), inbox1);

  await page.locator(tid('node-perm-reach-owner')).click();
  await page.locator(tid('node-perm-simple-confirm-cancel')).click();
  const afterCancel = await page.evaluate(() => window.__puts.inbox.length);
  await page.locator(tid('node-perm-reach-owner')).click();
  await page.locator(tid('node-perm-simple-confirm-ok')).click();
  await page.waitForTimeout(500);
  const inbox2 = await page.evaluate(() => window.__puts.inbox);
  record('④ 取消不发;确认后 inbox = [user:admin],「只有主人」选中', afterCancel === 1 && JSON.stringify(inbox2[1]) === JSON.stringify(['user:admin']) && await checked(page, 'node-perm-reach-owner'), inbox2);
  record('⑦ 无页面错误(桌面)', errors.length === 0, errors);
  await ctx.close();
}
{
  const { ctx, page } = await open({ noDept: true });
  const dis = await page.locator(tid('node-perm-reach-dept')).getAttribute('aria-disabled');
  record('⑤ 节点没部门:「本部门」灰掉并写原因', dis === 'true' && (await page.locator(tid('node-perm-reach-dept')).innerText()).includes('还没归属部门'), dis);
  await ctx.close();
}
{
  const { ctx, page } = await open({ customGrants: true });
  record('⑥ 对不上任何一档 ⇒ 显示「自定义」', await page.locator(tid('node-perm-role-custom')).isVisible(), null);
  await page.locator(tid('node-perm-role-member')).click();
  await page.locator(tid('node-perm-simple-confirm')).waitFor();
  const msg = await page.locator(tid('node-perm-simple-confirm')).innerText();
  await page.locator(tid('node-perm-simple-confirm-ok')).click();
  await page.waitForTimeout(500);
  const g = await page.evaluate(() => window.__puts.grants);
  record('⑥ 改成「成员」先说会替换,确认后授权清空', msg.includes('替换') && g.length === 1 && g[0].length === 0, { msg, g });
  await ctx.close();
}
{
  const { ctx, page, errors } = await open({}, { width: 390, height: 844 });
  await page.screenshot({ path: `${OUT}/7-phone.png` });
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  record('⑦ 手机不横向溢出、无页面错误', over <= 1 && errors.length === 0, { over, errors });
  await ctx.close();
}
await browser.close();
web.close?.();
const passed = results.filter(Boolean).length;
console.log(`${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
