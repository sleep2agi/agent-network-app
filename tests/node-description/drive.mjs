// admin 2026-11-15「每个节点的职责需要让其他节点也能看到;desc 里放介绍而不是 AGENTS.md」:节点页「职责介绍」。
//
// 渲染态 web export + 页内 Hub fixture。断言:
//   ① Hub 带 description → 节点页概览最上面一张「职责介绍」卡,整段原样(含换行)
//   ② 编辑 → 改字 → 保存:PUT /api/nodes/:id/attrs { base_attrs_revision, description },卡片显示新文字
//   ③ 空着时「用模板」填进四个问题;只填模板不写内容 → 存成 null(等于没写)
//   ④ 别人刚改过(409)→ 红字提示、读回最新的 attrs_revision,再保存一次就成
//   ⑤ 旧 Hub(node 上没有 description 键)→ 不画这张卡
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const web = await serveExport(process.env.WEB_DIR);
const OUT = process.env.OUT_DIR || '/tmp/node-description';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: findChromium(), args: ['--no-sandbox'] });

const fixture = ({ oldHub }) => {
  const NET = 'net-org';
  const now = new Date().toISOString();
  const node = { node_id: 'n_100', alias: '通信欧', owner_user_id: 'u_me', permission_mode: 'normal', department_id: 'd_a', lifecycle_state: 'active', viewer_can: { permission_mode: true }, attrs_revision: 3,
    ...(oldHub ? {} : { description: '负责 App 发版：派发构建、批签名、跑发版校验。\n\n什么事找我：发新版、TestFlight。\n不做：Hub 改动。' }) };
  window.__puts = [];
  window.__conflictOnce = false;
  window.__routeOverride = (u, body, method) => {
    const p = u.pathname;
    if (p === '/api/auth/me') return { ok: true, user: { user_id: 'u_me', username: 'admin', role: 'admin' }, current_network: NET, networks: [{ network_id: NET, network_name: '网络', member_role: 'owner' }] };
    if (p === '/api/dm/threads') return { ok: true, threads: [] };
    if (p === '/api/status') return { ok: true, sessions: [{ alias: '通信欧', status: 'idle', agent: 'claude-code', runtime: 'agent-node', node_id: 'n_100', updated_at: now }] };
    if (p === '/api/nodes/n_100/attrs' && method === 'PUT') {
      const b = JSON.parse(body || '{}');
      window.__puts.push(b);
      if (window.__conflictOnce) { window.__conflictOnce = false; node.attrs_revision += 1; return { __status: 409, ok: false, error: 'attrs_revision_conflict', current_attrs_revision: node.attrs_revision }; }
      if (b.base_attrs_revision !== node.attrs_revision) return { __status: 409, ok: false, error: 'attrs_revision_conflict', current_attrs_revision: node.attrs_revision };
      node.description = b.description ?? null; node.attrs_revision += 1;
      return { ok: true, node_id: 'n_100', alias: '通信欧', description: node.description, attrs_revision: node.attrs_revision };
    }
    if (p === '/api/nodes') return { ok: true, nodes: [{ ...node }] };
    if (p === `/api/networks/${NET}/departments`) return { ok: true, departments: [{ id: 'd_a', name: '发版组', parent_id: null, leader_user_id: null, sort: 0, viewer_can: { manage: true, create_child: true }, member_count: 0 }], members: [] };
    if (p === `/api/networks/${NET}/humans`) return { ok: true, humans: [{ user_id: 'u_me', username: 'admin' }] };
    if (p === '/api/requirements/people/directory') return { ok: true, people: [{ user_id: 'u_me', username: 'admin', agents: [{ node_id: 'n_100', alias: '通信欧', updated_at: now, lifecycle_state: 'active', department_id: 'd_a' }] }], agents_without_owner: [], has_more: false, next_offset: null, agent_department_supported: true };
    if (p === '/api/requirements/people') return { ok: true, people: [] };
    return undefined;
  };
};

const results = [];
const record = (name, ok, detail) => { results.push(ok); console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ' ' + JSON.stringify(detail)}`); };

const open = async (oldHub, theme = 'light') => {
  const ctx = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1240, height: 900 }, colorScheme: theme });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(initScript, { theme });
  await page.addInitScript(fixture, { oldHub });
  await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
  await page.locator('[data-testid="desktop-rail"]').waitFor({ timeout: 20000 });
  await page.getByRole('tab', { name: '组织', exact: true }).click();
  await page.locator('[data-testid="agent-org-dept-d_a"]').click();
  await page.locator('[data-testid="agent-org-agent-n_100"]').click();
  await page.locator('[data-testid="org-agent-detail"]').waitFor();
  await page.getByText('概览', { exact: true }).first().click();
  await page.waitForTimeout(600);
  return { ctx, page, errors };
};

{
  const { ctx, page, errors } = await open(false);
  await page.locator('[data-testid="node-description"]').waitFor();
  await page.screenshot({ path: `${OUT}/desc-view.png` });
  const text = await page.locator('[data-testid="node-description-text"]').innerText();
  record('① 概览最上面「职责介绍」,整段原样(含换行)', text.includes('负责 App 发版') && text.includes('\n') && text.includes('不做：Hub 改动'), text);

  await page.locator('[data-testid="node-description-edit"]').click();
  await page.locator('[data-testid="node-description-input"]').fill('负责 App 发版与 TestFlight。\n什么事找我：发新版。');
  await page.screenshot({ path: `${OUT}/desc-edit.png` });
  await page.locator('[data-testid="node-description-save"]').click();
  await page.waitForTimeout(500);
  let puts = await page.evaluate(() => window.__puts);
  record('② 保存:PUT attrs 带 base_attrs_revision 和 description', puts.length === 1 && puts[0].base_attrs_revision === 3 && puts[0].description === '负责 App 发版与 TestFlight。\n什么事找我：发新版。', puts);
  record('② 卡片显示新文字 + 「已保存」', (await page.locator('[data-testid="node-description-text"]').innerText()).includes('TestFlight') && (await page.locator('[data-testid="node-description-note"]').innerText()).includes('已保存'), null);

  // ④ 冲突:下一次 PUT 回 409,读回最新后再保存成功
  await page.evaluate(() => { window.__conflictOnce = true; });
  await page.locator('[data-testid="node-description-edit"]').click();
  await page.locator('[data-testid="node-description-input"]').fill('负责发版。');
  await page.locator('[data-testid="node-description-save"]').click();
  await page.waitForTimeout(800);
  record('④ 409 → 红字「别人刚改过」', (await page.locator('[data-testid="node-description-note"]').innerText()).includes('别人刚改过'), null);
  await page.waitForTimeout(800);
  await page.locator('[data-testid="node-description-save"]').click();
  await page.waitForTimeout(600);
  puts = await page.evaluate(() => window.__puts);
  record('④ 读回最新 revision 后再保存成功', puts.length === 3 && puts[2].base_attrs_revision === 5 && (await page.locator('[data-testid="node-description-text"]').innerText()) === '负责发版。', puts.map(x => x.base_attrs_revision));

  // ③ 清空 → 用模板 → 不写内容就保存 = null
  await page.locator('[data-testid="node-description-edit"]').click();
  await page.locator('[data-testid="node-description-input"]').fill('');
  await page.locator('[data-testid="node-description-template"]').click();
  const tpl = await page.locator('[data-testid="node-description-input"]').inputValue();
  record('③ 「用模板」填进四个问题', tpl.includes('负责：') && tpl.includes('什么事找我：') && tpl.includes('不做：'), tpl);
  await page.locator('[data-testid="node-description-save"]').click();
  await page.waitForTimeout(500);
  puts = await page.evaluate(() => window.__puts);
  record('③ 只填模板不写内容 → 存成 null,显示「还没写」', puts.at(-1).description === null && await page.locator('[data-testid="node-description-empty"]').count() === 1, puts.at(-1));
  record('无页面报错', errors.length === 0, errors);
  await ctx.close();
}
{
  const { ctx, page, errors } = await open(false, 'dark');
  await page.locator('[data-testid="node-description"]').waitFor();
  await page.screenshot({ path: `${OUT}/desc-dark.png` });
  record('暗色无页面报错', errors.length === 0, errors);
  await ctx.close();
}
{
  const { ctx, page, errors } = await open(true);
  record('⑤ 旧 Hub(没有 description 键)→ 不画这张卡', await page.locator('[data-testid="node-description"]').count() === 0, null);
  record('旧 Hub 无页面报错', errors.length === 0, errors);
  await ctx.close();
}
await browser.close();
web.close?.();
const p = results.filter(Boolean).length, t = results.length;
console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
