// 管理员 2026-11-14「这个组织架构怎么 UI/UX 好一点」:侧栏「分组 · 部门」的分组标题。
//
// 渲染态 web export + 页内 Hub fixture(不起 hub、不碰生产)。断言:
//   ① 分组按组织树排:父部门「TMAI」在它的子部门前面(哪怕父部门全离线),「未归属」最后
//   ② 父部门在列表里时,子部门标题只写自己的名字(不再重复「TMAI /」),并缩进(细竖线代替发光条)
//   ③ 父部门不在列表里(没有直属 agent)时,子部门标题保留灰色前缀「B 站 / 」
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const web = await serveExport(process.env.WEB_DIR);
const OUT = process.env.OUT_DIR || '/tmp/sidebar-dept-tree';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: findChromium(), args: ['--no-sandbox'] });

const fixture = () => {
  const NET = 'net-tree';
  const departments = [
    { id: 'd_tm', name: 'TMAI', parent_id: null, leader_user_id: null, sort: 0 },
    { id: 'd_work', name: 'TMWork', parent_id: 'd_tm', leader_user_id: null, sort: 0 },
    { id: 'd_kb', name: 'TM知识库', parent_id: 'd_tm', leader_user_id: null, sort: 1 },
    { id: 'd_anet', name: 'ANet', parent_id: null, leader_user_id: null, sort: 1 },
    { id: 'd_b', name: 'B 站', parent_id: null, leader_user_id: null, sort: 2 },
    { id: 'd_bops', name: '运营', parent_id: 'd_b', leader_user_id: null, sort: 0 },
  ];
  const nodes = [
    ['TM总监', 'd_tm', 'offline'], ['TMWork前端', 'd_work', 'idle'], ['TMWork后端', 'd_work', 'idle'], ['TMWork测试', 'd_work', 'offline'],
    ['知识库整理', 'd_kb', 'idle'], ['ANet负责人', 'd_anet', 'idle'], ['ANet文档', 'd_anet', 'offline'],
    ['B站运营甲', 'd_bops', 'idle'], ['散户一号', null, 'idle'], ['散户二号', null, 'offline'],
  ];
  window.__routeOverride = (u) => {
    const p = u.pathname;
    if (p === '/api/auth/me') return { ok: true, user: { user_id: 'u_me', username: 'tester', role: 'admin' }, current_network: NET, networks: [{ id: NET, network_id: NET, name: '网络', member_role: 'owner' }] };
    if (p === '/api/dm/threads') return { ok: true, threads: [] };
    if (p === '/api/status') return { ok: true, sessions: nodes.map(([alias, , status]) => ({ alias, node_id: `n_${alias}`, network_id: NET, runtime: 'opencode-cli', status })) };
    if (p === '/api/nodes') return { ok: true, nodes: nodes.map(([alias, department_id]) => ({ alias, node_id: `n_${alias}`, network_id: NET, runtime: 'opencode-cli', department_id })) };
    if (p === `/api/networks/${NET}/departments`) return { ok: true, departments: departments.map(d => ({ ...d, member_count: 0 })), members: [] };
    return undefined;
  };
};

const ctx = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1280, height: 860 } });
const page = await ctx.newPage();
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.addInitScript(initScript, { theme: 'light' });
await page.addInitScript(fixture);
await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
await page.waitForFunction(() => !!window.__anetLayoutSweep);
await page.waitForSelector('[data-testid="agent-group-TMAI / TMWork"]', { timeout: 20000 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/sidebar-dept-tree.png` });

const order = await page.$$eval('[data-testid^="agent-group-title-"]', els => els.map(e => e.getAttribute('data-testid').slice('agent-group-title-'.length)));
const text = async (k) => (await page.locator(`[data-testid="agent-group-title-${k}"]`).innerText()).trim();
const has = async (id) => (await page.locator(`[data-testid="${id}"]`).count()) > 0;

const results = [];
const record = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ' ' + JSON.stringify(detail)}`); };
const want = ['TMAI', 'TMAI / TMWork', 'TMAI / TM知识库', 'ANet', 'B 站 / 运营', '未归属'];
record('① tree order: TMAI (all offline) before its children, 未归属 last', JSON.stringify(order) === JSON.stringify(want), order);
record('② child under shown parent: leaf only + branch line, no glow',
  (await text('TMAI / TMWork')) === 'TMWork' && await has('agent-group-branch-TMAI / TMWork') && !(await has('agent-group-glow-TMAI / TMWork')),
  await text('TMAI / TMWork'));
record('③ parent not in list: keeps 「B 站 / 」 prefix, top-level glow kept',
  (await text('B 站 / 运营')) === 'B 站 / 运营' && await has('agent-group-glow-B 站 / 运营'), await text('B 站 / 运营'));
record('no page errors', errors.length === 0, errors);

await browser.close();
await web.close?.();
const failed = results.filter(r => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed`);
assert.equal(failed.length, 0);
