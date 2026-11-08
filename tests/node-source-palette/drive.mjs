// 节点来源浮层（新建会话 / 接入已有会话 / fork）+ 复制节点浮层 —— 真 React 挂载驱动。
//
// 用的是 tests/test-layout-sweep/harness.mjs 的页内 Tauri 桩：不连真 Hub / daemon / 账号，
// 全部是合成夹具。断言的是**界面看得见的形状 + 真实发出去的请求体**：
//   · 浮层：搜索框、按项目分组带会话计数、当前项 ✓ 唯一、空态 / 真实错误态分离；
//   · 搜索能按项目名 / 会话名 / 路径过滤（大小写不敏感），无命中是空态不是错误；
//   · 非法选择不能提交（灰掉的行点一下只给真实原因，不发请求）；
//   · 提交体字段逐字正确：新建 5 字段带 project_id、接入 5 字段带 oses_ session_id、
//     fork 6 字段且不改写 native ses_；
//   · 失败显示 Hub 的真实错误码，不静默 fallback；
//   · 桌面 1280×900 / 手机 390×844 都能滚动、不横向溢出、浮层内滚动不撑破页面。
//
// 用法：
//   WEB_DIR=<expo export dir> SHOT_DIR=<png dir> \
//   PLAYWRIGHT_MODULE=/home/vansin/agent-network-dashboard/node_modules/playwright/index.mjs \
//   CHROMIUM_PATH=/home/vansin/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome \
//   node tests/fork-palette/drive.mjs
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, ANDROID_UA, TEST_LOCALE } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const OUT = process.env.SHOT_DIR || '/tmp/opencode/fork-palette-shots';
mkdirSync(OUT, { recursive: true });
if (!process.env.WEB_DIR) throw new Error('need WEB_DIR (expo web export)');
const web = await serveExport(process.env.WEB_DIR);
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] });
let checks = 0;
const ck = (name, ok, extra = '') => { assert.ok(ok, `${name}${extra ? ` — ${extra}` : ''}`); checks++; console.log(`PASS ${name}${extra ? ` — ${extra}` : ''}`); };

const SCOPED = 'srcdir_00000000-0000-0000-0000-000000000003';
const SERVER = 'osrv_00000000-0000-0000-0000-000000000001';

// 合成夹具：一个 source 节点（示例-A / ses_A）、同项目另一个受管会话（ses_B）、另一个项目的 ses_C；
// 只读目录里有两个项目（oprj_1 Alpha / oprj_2 Beta）和三个 opaque oses_ 会话。
// 页面内执行：常量必须随参数传进去（addInitScript 不共享外部作用域）。
const fixture = (arg) => {
  const { mode, scoped: SCOPED, server: SERVER } = arg;
  window.__fp = { mode, calls: { project: [], fork: [], directory: 0, directorySelect: 0 } };
  const mcpOk = () => ({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] } });
  window.__routeOverride = (u, bodyText, method) => {
    const p = new URL(u).pathname;
    const body = bodyText ? JSON.parse(bodyText) : null;
    if (p === '/api/status') {
      return {
        ok: true,
        sessions: [
          { alias: '示例-A', status: 'idle', agent: 'opencode-cli', runtime: 'opencode-cli', node_id: 'n_a', session_id: 'ses_A', network_id: 'net-sweep', project_dir: '/work/demo-a', updated_at: new Date().toISOString() },
          { alias: '示例-B', status: 'idle', agent: 'opencode-cli', runtime: 'opencode-cli', node_id: 'n_b', session_id: 'ses_B', network_id: 'net-sweep', project_dir: '/work/demo-a', updated_at: new Date().toISOString() },
          { alias: '示例-C', status: 'idle', agent: 'opencode-cli', runtime: 'opencode-cli', node_id: 'n_c', session_id: 'ses_C', network_id: 'net-sweep', project_dir: '/work/demo-c', updated_at: new Date().toISOString() },
        ],
      };
    }
    if (p === '/api/nodes') {
      return {
        ok: true,
        nodes: ['a', 'b', 'c'].map(x => ({ node_id: `n_${x}`, alias: `示例-${x.toUpperCase()}`, lifecycle_state: 'running', runtime: 'opencode-cli', opencode_generation: 'v2', lifecycle_daemon_node_id: 'd_a' })),
      };
    }
    if (p === '/api/node-session-control/source/directory' && method !== 'GET') {
      if (body.daemon_node_id !== 'd_a' || body.source_node_id !== 'n_a') throw new Error('wrong_source_or_daemon');
      window.__fp.calls.directory += 1;
      if (mode === 'directory-closed') return { ok: false, error: 'source_directory_unavailable' };
      if (body && body.server_id) {
        window.__fp.calls.directorySelect += 1;
        return { ok: true, request_id: SCOPED, status: 'pending' };
      }
      return { ok: true, request_id: 'srcdir_00000000-0000-0000-0000-000000000002', status: 'pending' };
    }
    if (/^\/api\/node-session-control\/source\/directory\/[^/]+$/.test(p)) {
      return {
        ok: true, status: 'ready', snapshot: {
          snapshot_id: p.endsWith(SCOPED) ? 'snap_selected' : 'snap_initial',
          expires_at: Date.now() + 60000,
          ...(mode === 'old-snapshot' ? {} : { selection_expires_at: Date.now() + 600000 }),
          lease_kind: 'process_local', completeness: 'authorized_scope_only',
          servers: [{ server_id: SERVER, title: 'S1' }],
          projects: [
            { project_id: 'oprj_1', server_id: SERVER, title: 'Alpha' },
            { project_id: 'oprj_2', server_id: SERVER, title: 'Beta' },
          ],
          sessions: [
            { session_id: 'oses_1', project_id: 'oprj_1', title: 'Alpha-已有-a', activity: 'unknown', binding: 'unknown', attach_authorized: false },
            { session_id: 'oses_2', project_id: 'oprj_1', title: 'Alpha-已有-b', activity: 'running', binding: 'unknown', attach_authorized: false },
            { session_id: 'oses_3', project_id: 'oprj_2', title: 'Beta-已有', activity: 'unknown', binding: 'unknown', attach_authorized: false },
          ],
        },
      };
    }
    if (p === '/api/node-session-control/source/project-create' && method !== 'GET') {
      window.__fp.calls.project.push(body);
      if (mode === 'project-404') return { ok: false, error: 'project_create_unavailable' };
      return { ok: true, request_id: 'prjc_1', status: 'create_pending', session_creation: 'not_started' };
    }
    if (/^\/api\/node-session-control\/source\/project-create\/[^/]+$/.test(p)) {
      if (mode === 'project-unknown') return { ok: true, status: 'unknown_rotation_required', session_creation: 'unknown' };
      return { ok: true, status: 'registration_confirmed', session_creation: 'confirmed', child_node_id: 'node_prjc_1' };
    }
    if (p === '/api/node-session-control/source' && method === 'POST') {
      window.__fp.calls.fork.push(body);
      if (mode === 'fork-500') return { ok: false, error: 'HTTP 500' };
      return { ok: true, request_id: 'fork_fixture', status: 'registration_confirmed', session_id: body.session_id, mode: body.mode, child_name: body.child_name };
    }
    if (p === '/mcp') return mcpOk();
    return undefined;
  };
};

async function mount(viewport, mode = 'ok') {
  const ctx = await browser.newContext({
    locale: TEST_LOCALE,
    colorScheme: 'light',
    viewport,
    ...(viewport.width < 600 ? { userAgent: ANDROID_UA, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(initScript, { theme: 'light' });
  await page.addInitScript(fixture, { mode, scoped: SCOPED, server: SERVER });
  await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
  await page.waitForFunction(() => !!window.__anetLayoutSweep);
  await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'nodeDetail', alias: '示例-A' }));
  await page.getByTestId('node-clone-fork-open').waitFor();
  await page.getByTestId('node-clone-fork-open').click();
  await page.getByTestId('source-fork-frame').waitFor();
  // 目录轮询 1500ms + 一次自动选 Server；gate 关闭时等真实错误态而不是项目行。
  const settled = mode === 'directory-closed'
    ? '[data-testid="source-directory-failed"]'
    : '[data-testid="project-create-pick-oprj_1"]';
  await page.waitForFunction(sel => !!document.querySelector(sel), settled, { timeout: 15000 });
  if (mode !== 'directory-closed') await page.waitForFunction(() =>
    document.querySelector('[data-testid="source-palette-source"]')?.textContent?.includes('snap_selected'), null, { timeout: 15000 });
  return { ctx, page, errors };
}

const text = (page, id) => page.locator(`[data-testid="${id}"]`).innerText();
const count = (page, sel) => page.locator(sel).count();
const checks$ = (page) => count(page, '[data-testid$="-check"]');

// 浮层几何：卡片在视口内、列表真在卡片内部滚、页面没有横向溢出。
const geometry = (page) => page.evaluate(() => {
  const card = document.querySelector('[data-testid="source-fork-frame"]');
  const list = document.querySelector('[data-testid="source-palette-list"]');
  const confirm = document.querySelector('[data-testid="source-palette-confirm"]');
  const box = el => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
  };
  const doc = document.documentElement;
  return {
    card: box(card),
    overlay: box(document.querySelector('[data-testid="source-fork-frame-backdrop"]')),
    list: list ? { ...box(list), scrollH: list.scrollHeight, clientH: list.clientHeight } : null,
    confirm: box(confirm),
    overflowX: doc.scrollWidth - doc.clientWidth,
    window: { w: window.innerWidth, h: window.innerHeight },
  };
});

try {
  // ── A 桌面：列表 / 分组计数 / 当前项 ✓ 唯一 ────────────────────────────────
  const { ctx, page, errors } = await mount({ width: 1280, height: 900 });
    ck('desktop: palette has a search box', await count(page, '[data-testid="source-palette-search"]') === 1);
  ck('desktop: fork section lists managed ses_ rows', await count(page, '[data-testid^="source-palette-row-ses_"]:not([data-testid$="-check"])') === 3);
  ck('desktop: directory projects and opaque sessions are listed', await count(page, '[data-testid^="project-create-pick-oprj_"]') === 2 && await count(page, '[data-testid^="project-create-attach-oses_"]') === 3);
  const alphaCount = await text(page, 'source-palette-group-dir:oprj_1-count');
  const betaCount = await text(page, 'source-palette-group-dir:oprj_2-count');
  const pathCount = await text(page, 'source-palette-group-fork:/work/demo-a-count');
  ck('desktop: project groups carry their session count', alphaCount.trim() === '2' && betaCount.trim() === '1', `Alpha=${alphaCount} Beta=${betaCount}`);
  ck('desktop: fork group counts the sessions under that project path', pathCount.trim() === '2', pathCount);
  ck('desktop: exactly one checkmark, on the preset managed session', await checks$(page) === 1 && await count(page, '[data-testid="source-palette-row-ses_A-check"]') === 1);
  ck('desktop: confirm area names the fork mode, not a generic create', (await text(page, 'source-palette-mode')).includes('fork_independent'));
  const g1 = await geometry(page);
  ck('desktop: floating card is centred in its pane and fits the viewport', !!g1.card && !!g1.overlay
    && g1.card.x >= 0 && g1.card.right <= g1.window.w
    && Math.abs((g1.card.left - g1.overlay.left) - (g1.overlay.right - g1.card.right)) <= 2,
    JSON.stringify({ card: g1.card, overlay: g1.overlay }));
  ck('desktop: the list is the only scroller (card inner scroll)', g1.list.scrollH > g1.list.clientH && g1.list.clientH <= 430);
  ck('desktop: confirm area sits below the list inside the card', g1.confirm.top >= g1.list.bottom - 1 && g1.confirm.bottom <= g1.card.bottom + 1);
  ck('desktop: no horizontal overflow', g1.overflowX === 0, `overflowX=${g1.overflowX}`);
  await page.screenshot({ path: `${OUT}/desktop-list.png` });
  ck('desktop: no page errors', errors.length === 0, errors.join(' | '));

  // ── B 搜索过滤（项目名 / 会话名 / 路径，大小写不敏感）+ 无命中空态 ──────────
  await page.getByTestId('source-palette-search').fill('aLPha');
  ck('search by project name keeps that project and hides the other', await count(page, '[data-testid="project-create-attach-oses_1"]') === 1 && await count(page, '[data-testid="project-create-attach-oses_3"]') === 0);
  await page.screenshot({ path: `${OUT}/desktop-search.png` });
  await page.getByTestId('source-palette-search').fill('demo-c');
  ck('search by path keeps only that fork session', await count(page, '[data-testid^="source-palette-row-ses_"]:not([data-testid$="-check"])') === 1 && await count(page, '[data-testid="source-palette-row-ses_C"]') === 1);
  await page.getByTestId('source-palette-search').fill('oses_2');
  ck('search by opaque session id works', await count(page, '[data-testid="project-create-attach-oses_2"]') === 1 && await count(page, '[data-testid^="source-palette-row-ses_"]:not([data-testid$="-check"])') === 0);
  await page.getByTestId('source-palette-search').fill('zzz-no-such');
  ck('no match is an empty state, not an error', await count(page, '[data-testid="source-palette-no-match"]') === 1 && await count(page, '[data-testid="source-palette-error"]') === 0);
  await page.getByTestId('source-palette-search').fill('');
  ck('clearing the query restores the full list', await count(page, '[data-testid^="source-palette-row-ses_"]:not([data-testid$="-check"])') === 3);

  // ── C 选中已有会话（attach）→ 提交体 5 字段带 oses_ session_id ─────────────
  await page.getByTestId('project-create-attach-oses_2').click();
  ck('selecting an opaque session switches the confirm to attach', (await text(page, 'source-palette-mode')).includes('接入已有会话'));
  ck('attach confirm shows the exact row identity', (await text(page, 'source-palette-selected')).includes('oses_2'));
  ck('the checkmark moved (still exactly one)', await checks$(page) === 1 && await count(page, '[data-testid="project-create-attach-oses_2-check"]') === 1);
  await page.screenshot({ path: `${OUT}/desktop-selected.png` });
  await page.getByTestId('project-create-child-name').fill('attach-child');
  await page.getByTestId('project-create-submit').click();
  await page.waitForFunction(() => window.__fp.calls.project.length === 1);
  const attachBody = (await page.evaluate(() => window.__fp.calls.project))[0];
  ck('attach POST is exactly 5 fields, no project_id', Object.keys(attachBody).length === 5 && !('project_id' in attachBody), Object.keys(attachBody).join(','));
  ck('attach POST carries the opaque session_id and no project_id', attachBody.session_id === 'oses_2' && !('project_id' in attachBody) && attachBody.child_name === 'attach-child');
   ck('attach POST uses the selected request AND its new snapshot, not the first directory read', attachBody.selection_scope === SCOPED && attachBody.snapshot_id === 'snap_selected');
  await page.waitForFunction(() => (document.querySelector('[data-testid="project-create-status"]')?.textContent || '').includes('已注册'));
  ck('registration回执 is not painted as online/healthy', !/online|healthy|TUI ready/i.test(await text(page, 'project-create-status')));

  // ── D 新会话（project_id）→ 互斥字段 project_id / 无 session_id ────────────
  await page.getByTestId('project-create-pick-oprj_2').click();
  ck('selecting a project switches to 新会话 mode', (await text(page, 'source-palette-mode')).includes('新会话'));
  await page.getByTestId('project-create-child-name').fill('project-child');
  await page.getByTestId('project-create-submit').click();
  await page.waitForFunction(() => window.__fp.calls.project.length === 2);
  const projectBody = (await page.evaluate(() => window.__fp.calls.project))[1];
  ck('new-session POST is exactly 5 fields with project_id', Object.keys(projectBody).length === 5 && projectBody.project_id === 'oprj_2' && !('session_id' in projectBody), Object.keys(projectBody).join(','));
   ck('new-session POST never carries fork fields', !('mode' in projectBody) && !('network_id' in projectBody) && !('source_node_id' in projectBody));
   await page.getByTestId('source-palette-busy').waitFor({ state: 'detached' });

  // ── E fork：六字段，不改写 native ses_ ───────────────────────────────────
  await page.getByTestId('source-palette-row-ses_B').click();
  ck('selecting a managed session switches to fork mode', (await text(page, 'source-palette-mode')).includes('fork_independent'));
  await page.getByTestId('source-fork-child-name').fill('fork-child');
  await page.getByTestId('source-fork-submit').click();
  await page.waitForFunction(() => window.__fp.calls.fork.length === 1);
  const forkBody = (await page.evaluate(() => window.__fp.calls.fork))[0];
  ck('fork POST is exactly the 6 contract fields', Object.keys(forkBody).sort().join(',') === 'child_name,intent_id,mode,network_id,session_id,source_node_id');
   ck('fork POST keeps the native ses_ and mode', forkBody.session_id === 'ses_B' && forkBody.mode === 'fork_independent' && forkBody.child_name === 'fork-child');
   ck('fork POST pairs native ses_B with its actual source node', forkBody.source_node_id === 'n_b');
  ck('fork POST never carries directory/project fields', !('project_id' in forkBody) && !('selection_scope' in forkBody) && !('snapshot_id' in forkBody));
  ck('fork receipt is shown as a registration回执, not liveness', (await text(page, 'source-fork-status')).includes('注册回执'));
  ck('desktop: still no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();

  // ── F 失败：真实错误码，不静默 fallback ─────────────────────────────────
  {
    const { ctx: c2, page: p2, errors: e2 } = await mount({ width: 1280, height: 900 }, 'project-404');
    await p2.getByTestId('project-create-pick-oprj_1').click();
    await p2.getByTestId('project-create-child-name').fill('closed-child');
    await p2.getByTestId('project-create-submit').click();
    await p2.waitForFunction(() => window.__fp.calls.project.length === 1);
    const msg = await text(p2, 'source-palette-action-error');
    ck('404 gate shows 未开放 and never falls back to a normal create', msg.includes('未开放') && msg.includes('不会退回普通创建'), msg);
    ck('404 gate posts exactly once (no retry storm)', (await p2.evaluate(() => window.__fp.calls.project.length)) === 1);
    await p2.screenshot({ path: `${OUT}/desktop-error.png` });
    ck('404 gate: no page errors', e2.length === 0, e2.join(' | '));
    await c2.close();
  }

  // ── G fork 失败显示 Hub 原文 ────────────────────────────────────────────
  {
    const { ctx: c3, page: p3 } = await mount({ width: 1280, height: 900 }, 'fork-500');
    await p3.getByTestId('source-fork-child-name').fill('fork-fail');
    await p3.getByTestId('source-fork-submit').click();
    await p3.waitForFunction(() => window.__fp.calls.fork.length === 1);
    const msg = await text(p3, 'source-fork-message');
    ck('fork failure surfaces the real Hub error, not a fake success', msg.includes('HTTP 500'), msg);
    ck('fork failure leaves no receipt text claiming a status', (await count(p3, '[data-testid="source-fork-status"]')) === 0);
    await c3.close();
  }

  // ── H 目录 gate 关闭：只读目录不可用，fork 仍然可用（不 fallback 普通创建）──
  {
    const { ctx: c4, page: p4, errors: e4 } = await mount({ width: 1280, height: 900 }, 'directory-closed');
    const dirMsg = await text(p4, 'source-directory-failed');
    ck('closed directory shows the real gate reason', dirMsg.includes('未开放') && dirMsg.includes('不会退回普通创建'), dirMsg);
    ck('closed directory still lists the managed fork source from /api/status', await count(p4, '[data-testid="source-palette-row-ses_A"]') === 1);
    await p4.getByTestId('source-fork-child-name').fill('fork-while-closed');
    await p4.getByTestId('source-fork-submit').click();
    await p4.waitForFunction(() => window.__fp.calls.fork.length === 1);
    const b = (await p4.evaluate(() => window.__fp.calls.fork))[0];
    ck('fork works while the directory gate is closed (contract: no fallback create)', b.session_id === 'ses_A' && b.mode === 'fork_independent' && (await p4.evaluate(() => window.__fp.calls.project.length)) === 0);
    ck('closed directory: no page errors', e4.length === 0, e4.join(' | '));
    await p4.screenshot({ path: `${OUT}/desktop-directory-closed.png` });
    await c4.close();
  }

  // ── I 旧快照：目录行全灰且不可提交（真实原因，不发请求）──────────────────
  {
    const { ctx: c5, page: p5 } = await mount({ width: 1280, height: 900 }, 'old-snapshot');
    await p5.getByTestId('project-create-pick-oprj_1').click();
    const why = await text(p5, 'source-fork-message');
    ck('old snapshot disables new session with selection_expires_at reason', why.includes('selection_expires_at'), why);
    ck('old snapshot keeps the fork source selectable', (await count(p5, '[data-testid="source-fork-submit"]')) === 0 || (await text(p5, 'source-palette-selected')).includes('ses_'));
    ck('old snapshot never posts a project-create body', (await p5.evaluate(() => window.__fp.calls.project.length)) === 0);
    await c5.close();
  }

  // ── J 手机 390×844：列表/搜索/确认都在屏内，只在浮层里滚 ────────────────
  {
    const { ctx: c6, page: p6, errors: e6 } = await mount({ width: 390, height: 844 });
    const g = await geometry(p6);
    ck('phone: card fits 390×844 without horizontal overflow', g.card.x >= 0 && g.card.right <= 390 && g.overflowX === 0, JSON.stringify({ x: g.card.x, right: g.card.right, overflowX: g.overflowX }));
    ck('phone: card sits at the top so the keyboard cannot cover the confirm input', g.card.top <= 90, `top=${g.card.top}`);
    ck('phone: list scrolls inside the card, confirm stays visible', g.list.scrollH > g.list.clientH && g.confirm.bottom <= g.card.bottom + 1 && g.confirm.bottom <= 844);
    ck('phone: exactly one checkmark', await checks$(p6) === 1);
    await p6.screenshot({ path: `${OUT}/phone-list.png` });
    await p6.getByTestId('source-palette-search').fill('beta');
    ck('phone: search filters the list in place', await count(p6, '[data-testid="project-create-attach-oses_3"]') === 1 && await count(p6, '[data-testid="source-palette-row-ses_A"]') === 0);
    await p6.screenshot({ path: `${OUT}/phone-search.png` });
    await p6.getByTestId('source-palette-search').fill('');
    await p6.getByTestId('project-create-pick-oprj_1').click();
    await p6.getByTestId('project-create-child-name').fill('phone-child');
    const g2 = await geometry(p6);
    ck('phone: confirm input and submit remain inside the viewport after selection', g2.confirm.bottom <= 844 && (await count(p6, '[data-testid="project-create-submit"]')) === 1);
    await p6.screenshot({ path: `${OUT}/phone-selected.png` });
    ck('phone: no page errors', e6.length === 0, e6.join(' | '));
    await c6.close();
  }

  // ── K 键盘：↓/↑ 移动 + Enter 选中 + Esc 关闭 ─────────────────────────────
  {
    const { ctx, page } = await mount({ width: 1280, height: 900 }, 'project-unknown');
    await page.getByTestId('project-create-pick-oprj_1').click();
    await page.getByTestId('project-create-child-name').fill('unknown-child');
    await page.getByTestId('project-create-submit').click();
    await page.getByTestId('project-create-status').waitFor();
    ck('unknown: UI retains the unknown outcome', (await text(page, 'project-create-status')).includes('结果未知'));
    // RN Web 的 Pressable 是 div：禁用态落在 aria-disabled/tabindex 上，不是 <button disabled>。
    const submitEl = page.getByTestId('project-create-submit');
    await page.waitForFunction(() => document.querySelector('[data-testid="project-create-submit"]')?.getAttribute('aria-disabled') === 'true');
    ck('unknown: submit stays disabled, not a fresh intent', (await submitEl.getAttribute('aria-disabled')) === 'true' && (await submitEl.getAttribute('tabindex')) !== '0');
    await page.getByTestId('project-create-pick-oprj_2').click();
    ck('unknown: choosing another project cannot replay the uncertain request', (await text(page, 'source-palette-selected')).includes('oprj_1') && (await page.evaluate(() => window.__fp.calls.project.length)) === 1);
    await ctx.close();
  }
  {
    const { ctx, page } = await mount({ width: 390, height: 844 }, 'project-404');
    await page.getByTestId('project-create-pick-oprj_1').click();
    await page.getByTestId('project-create-child-name').fill('phone-error');
    await page.getByTestId('project-create-submit').click();
    await page.getByTestId('source-palette-action-error').waitFor();
    ck('phone: actual error code is visible', (await text(page, 'source-palette-action-error')).includes('project_create_unavailable'));
    const errorGeometry = await geometry(page);
    ck('phone: error state keeps the entire card and confirm in viewport', errorGeometry.card.top >= 0 && errorGeometry.card.bottom <= 844 && errorGeometry.confirm.bottom <= errorGeometry.card.bottom + 1, JSON.stringify(errorGeometry));
    await page.screenshot({ path: `${OUT}/phone-error.png` });
    await ctx.close();
  }
  // New-node entry mounts the SAME production palette, not just runtime search.
  {
    const { ctx, page } = await mount({ width: 1280, height: 900 });
    await page.getByTestId('source-fork-frame-close').click();
    await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'wizard', daemon: {
      daemon_node_id: 'd_a', alias: 'fixture', hostname: 'fixture', online: true,
      runtimes_supported: ['opencode-cli'], can_create_nodes: true,
    } }));
    await page.getByTestId('create-source-open').click();
    await page.getByTestId('create-source-n_a').click();
    await page.getByTestId('project-create-pick-oprj_1').waitFor();
    await page.getByTestId('project-create-pick-oprj_1').click();
    await page.getByTestId('project-create-child-name').fill('wizard-project');
    await page.getByTestId('project-create-submit').click();
    await page.waitForFunction(() => window.__fp.calls.project.length === 1);
    ck('new-node entry creates from selected project via the five-field contract', (await page.evaluate(() => window.__fp.calls.project[0])).project_id === 'oprj_1');
    await ctx.close();
  }
  {
    const { ctx: c7, page: p7 } = await mount({ width: 1280, height: 900 });
    await p7.getByTestId('source-palette-search').click();
    await p7.keyboard.press('ArrowDown');
    await p7.keyboard.press('Enter');
    const selected = await text(p7, 'source-palette-selected');
    ck('keyboard: ↓ then Enter moves the selection off the default row', selected.includes('ses_B'), selected);
    await p7.keyboard.press('Escape');
    ck('keyboard: Esc closes the overlay', (await count(p7, '[data-testid="source-fork-frame"]')) === 0);
    await c7.close();
  }

  // ── L 复制节点：同一套浮层 + 卡片内紧凑确认区 ───────────────────────────
  {
    const ctx = await browser.newContext({ locale: TEST_LOCALE, colorScheme: 'light', viewport: { width: 1280, height: 900 } });
    const p8 = await ctx.newPage();
    const errs = [];
    p8.on('pageerror', e => errs.push(String(e)));
    await p8.addInitScript(initScript, { theme: 'light' });
    await p8.addInitScript(fixture, { mode: 'ok', scoped: SCOPED, server: SERVER });
    await p8.goto(`${web.url}?safeAreaDim=0&safeAreaSim=0,0,0,0`);
    await p8.waitForFunction(() => !!window.__anetLayoutSweep);
    await p8.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'nodeDetail', alias: '示例-A' }));
    await p8.getByTestId('node-clone-open').waitFor();
    await p8.getByTestId('node-clone-open').click();
    await p8.getByTestId('clone-node-dialog').waitFor();
    ck('clone: same floating palette shell, not a step-by-step dialog', (await count(p8, '[data-testid="clone-node-dialog"]')) === 1 && (await count(p8, '[data-testid="clone-node-dialog-backdrop"]')) === 1);
    ck('clone: source row shows the current source with a single checkmark', (await count(p8, '[data-testid="clone-node-source-row"]')) === 1);
    ck('clone: compact confirm keeps name / workdir / copy-session controls', await count(p8, '[data-testid="clone-node-name"]') === 1 && await count(p8, '[data-testid="clone-node-workdir-new_empty"]') === 1 && await count(p8, '[data-testid="clone-node-copy-session"]') === 1);
    const before = await p8.getByTestId('clone-node-name').inputValue();
    ck('clone: name is prefilled from the source and stays editable', before.length > 0);
    await p8.getByTestId('clone-node-name').fill('planner-copy-9');
    const gclone = await p8.evaluate(() => {
      const card = document.querySelector('[data-testid="clone-node-dialog"]').getBoundingClientRect();
      return { card, overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    ck('clone: card fits the viewport with no horizontal overflow', gclone.card.right <= 1280 && gclone.card.x >= 0 && gclone.overflowX === 0);
    await p8.screenshot({ path: `${OUT}/desktop-clone.png` });
    await p8.getByTestId('clone-node-submit').click();
    await p8.getByTestId('clone-node-error').waitFor();
    const cloneErr = await p8.getByTestId('clone-node-error').innerText();
    ck('clone: a Hub without the tool reports the real unconfirmed error, never a fake success', cloneErr.includes('没有确认') || cloneErr.includes('演示'), cloneErr);
    ck('clone: no page errors', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }

  console.log(`\n${checks}/${checks} checks passed`);
} finally {
  await browser.close();
  web.close();
}
