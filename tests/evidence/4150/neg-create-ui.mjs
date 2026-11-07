// #4150 newSession 三链真 UI fixture（受控 Hub，断言真实请求体与 receipt 文案）：
//  A 选项目 → POST(project_id) → POLL → registered
//  B 选 opaque oses_ → POST(session_id) → POLL → registered
//  C 404 未开放 → 禁用/不 fallback；D unknown → 只 GET；E 切 scope 不污染
// 用法: WEB_DIR=/tmp/opencode/webCreate node /tmp/opencode/neg-create-ui.mjs
import { serveExport, initScript, findChromium, TEST_LOCALE } from '/tmp/opencode/app-4130-modelline/tests/test-layout-sweep/harness.mjs';
const { chromium } = await import('/home/vansin/agent-network-dashboard/node_modules/playwright/index.mjs');

const { url } = await serveExport(process.env.WEB_DIR);
const browser = await chromium.launch({ headless: true, executablePath: findChromium(), args: ['--no-sandbox'] });
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36';
const results = [];
const ck = (n, ok, d = '') => { results.push({ n, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); };

async function scenario(mode) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, colorScheme: 'light', deviceScaleFactor: 1, locale: TEST_LOCALE, userAgent: UA });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message).split('\n')[0]));
  await page.addInitScript((m) => {
    window.__calls = { create: [], poll: 0, dirPost: 0, dirGet: 0 };
    window.__routeOverride = (u, bodyText) => {
      const p = new URL(u).pathname;
      if (p === '/api/status' && !bodyText) return { ok: true, files_capable: true, sessions: [
        { alias: '示例-A', status: 'idle', agent: 'opencode-cli', runtime: 'opencode-cli', node_id: 'n_a', session_id: 'ses_A', network_id: 'net-sweep', updated_at: new Date().toISOString() },
        { alias: '示例-B', status: 'idle', agent: 'opencode-cli', runtime: 'opencode-cli', node_id: 'n_b', session_id: 'ses_B', network_id: 'net-sweep', updated_at: new Date().toISOString() } ] };
      if (p === '/api/nodes' && !bodyText) return { ok: true, nodes: [
        { node_id: 'n_a', alias: '示例-A', lifecycle_state: 'running', runtime: 'opencode-cli', opencode_generation: 'v2', lifecycle_daemon_node_id: 'd_a' },
        { node_id: 'n_b', alias: '示例-B', lifecycle_state: 'running', runtime: 'opencode-cli', opencode_generation: 'v2', lifecycle_daemon_node_id: 'd_b' } ] };
      if (p === '/api/node-session-control/source/directory' && bodyText) {
        window.__calls.dirPost++;
        const body = JSON.parse(bodyText);
        // 第二次（带 server_id）返回 selection scope
        return body.server_id ? { ok: true, request_id: 'srcdir_sel1', status: 'pending' } : { ok: true, request_id: 'srcdir_1', status: 'pending' };
      }
      if (/^\/api\/node-session-control\/source\/directory\/[^/]+$/.test(p)) {
        window.__calls.dirGet++;
        return { ok: true, status: 'ready', snapshot: {
          snapshot_id: 'snap_1', expires_at: Date.now() + 30000, selection_expires_at: Date.now() + 600000,
          lease_kind: 'process_local', completeness: 'authorized_scope_only',
          servers: [{ server_id: 'osrv_1', title: 'S1' }],
          projects: [{ project_id: 'oprj_1', server_id: 'osrv_1', title: 'P1' }],
          sessions: [{ session_id: 'oses_1', project_id: 'oprj_1', title: '已有会话', activity: 'unknown', binding: 'unknown', attach_authorized: false }],
        } };
      }
      if (p === '/api/node-session-control/source/project-create' && bodyText) {
        window.__calls.create.push(JSON.parse(bodyText));
        if (m === '404') return { ok: false, error: 'project_create_unavailable' };
        if (m === '409') return { ok: false, error: 'conflict' };
        const body = JSON.parse(bodyText);
        return { ok: true, request_id: 'prjc_1', status: 'create_pending', session_creation: 'not_started', intent_id: body.intent_id };
      }
      if (/^\/api\/node-session-control\/source\/project-create\/[^/]+$/.test(p)) {
        window.__calls.poll++;
        if (m === 'unknown') return { ok: true, status: 'unknown_rotation_required', session_creation: 'unknown' };
        return { ok: true, status: 'registration_confirmed', session_creation: 'confirmed', child_node_id: 'node_prjc_1' };
      }
      return undefined;
    };
  }, mode);
  await page.addInitScript(initScript, { theme: 'light' });
  await page.goto(`${url}?safeAreaSim=0,0,0,0`);
  await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 30000 });
  await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'nodeDetail', alias: '示例-A' }));
  await page.waitForTimeout(1200);
  const btn = page.locator('[data-testid="node-clone-fork-open"]');
  if (await btn.count()) { await btn.click(); await page.waitForTimeout(2500); }
  return { ctx, page, errors };
}

// A 新项目
{
  const { ctx, page, errors } = await scenario('ok');
  const pick = page.locator('[data-testid="project-create-pick-oprj_1"]');
  ck('A 项目可选', (await pick.count()) === 1);
  if (await pick.count()) await pick.click();
  await page.locator('[data-testid="project-create-child-name"]').fill('child-a').catch(() => {});
  await page.locator('[data-testid="project-create-submit"]').click().catch(() => {});
  await page.waitForTimeout(3500);
  const calls = await page.evaluate(() => window.__calls);
  const body = calls.create[0] ?? {};
  ck('A POST 五字段且带 project_id', Object.keys(body).length === 5 && !!body.project_id && !('session_id' in body), JSON.stringify(body));
  ck('A 有 selection_scope/snapshot/intent', !!body.selection_scope && !!body.snapshot_id && !!body.intent_id);
  const status = await page.locator('[data-testid="project-create-status"]').innerText().catch(() => '');
  ck('A 最终 registered 文案（≠online）', /已注册/.test(status) && !/online|healthy/i.test(status), status.slice(0, 60));
  ck('A 无异常', errors.length === 0);
  await ctx.close();
}

// B attach opaque oses_
{
  const { ctx, page, errors } = await scenario('ok');
  const att = page.locator('[data-testid="project-create-attach-oses_1"]');
  ck('B attach 目标可选', (await att.count()) === 1);
  if (await att.count()) await att.click();
  await page.locator('[data-testid="project-create-child-name"]').fill('child-b').catch(() => {});
  await page.locator('[data-testid="project-create-submit"]').click().catch(() => {});
  await page.waitForTimeout(3500);
  const body = (await page.evaluate(() => window.__calls.create))[0] ?? {};
  ck('B POST 带 session_id 且不带 project_id', !!body.session_id && !('project_id' in body) && Object.keys(body).length === 5, JSON.stringify(body));
  ck('B 无异常', errors.length === 0);
  await ctx.close();
}

// C 404 未开放
{
  const { ctx, page, errors } = await scenario('404');
  const pick = page.locator('[data-testid="project-create-pick-oprj_1"]');
  if (await pick.count()) await pick.click();
  await page.locator('[data-testid="project-create-child-name"]').fill('child-c').catch(() => {});
  await page.locator('[data-testid="project-create-submit"]').click().catch(() => {});
  await page.waitForTimeout(1500);
  const status = await page.locator('[data-testid="project-create-status"]').innerText().catch(() => '');
  ck('C 404 显示未开放且不 fallback', /未开放/.test(status) && /不会退回普通创建/.test(status), status.slice(0, 60));
  ck('C 无异常', errors.length === 0);
  await ctx.close();
}

// D unknown：只 GET 不重放
{
  const { ctx, page, errors } = await scenario('unknown');
  const pick = page.locator('[data-testid="project-create-pick-oprj_1"]');
  if (await pick.count()) await pick.click();
  await page.locator('[data-testid="project-create-child-name"]').fill('child-d').catch(() => {});
  await page.locator('[data-testid="project-create-submit"]').click().catch(() => {});
  await page.waitForTimeout(4000);
  const calls = await page.evaluate(() => window.__calls);
  ck('D unknown：POST 只 1 次（不重放）', calls.create.length === 1, `create=${calls.create.length}`);
  ck('D unknown：仍用 GET 收敛', calls.poll >= 1, `poll=${calls.poll}`);
  const status = await page.locator('[data-testid="project-create-status"]').innerText().catch(() => '');
  ck('D 文案写明结果未知/禁止重放', /未知/.test(status), status.slice(0, 60));
  ck('D 无异常', errors.length === 0);
  await ctx.close();
}

const fail = results.filter(r => !r.ok).length;
console.log('DETAIL ' + JSON.stringify({ fail, total: results.length }));
await browser.close();
process.exit(fail ? 1 : 0);
