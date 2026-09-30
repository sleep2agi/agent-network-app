// 成员编辑器重设计(#417)—— 真应用(expo web 导出 + Tauri 桥桩)里量几何、截图、断言保存发出的请求。
// 不进 CI:要 Playwright + Chromium。Hub 全是页内假数据(tests/test-layout-sweep/harness.mjs 的桩 + 这里的
// __routeOverride):成员 / 授权 / 分组 / 任务权限 / 项目。不起 hub、不占端口、不碰 HOME。名字全是占位。
//
//   WEB_DIR=<expo export 目录> [OUT=<截图目录>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] node tests/test-member-editor/drive.mjs
//
// 桌面 1440×900(设置窗口放大到 1440×900)· 浅色 + 深色:
//   frame     弹窗在窗口正中(左右 / 上下留白相等 ±1),底栏在窗口内
//   columns   左栏 340 宽;两栏内容左右内边距相等 ±1;清单底在底栏上面
//   text      弹窗里没有 < 1px 的字(zeroSizeText);分段控件每一段的字完整画出、没被截断
//   rows      清单里每行复选框到左边、开关到右边的距离相等 ±2;开关右边缘对齐 ±1
//   groups    按机器:组头三态 + 「已选 / 总数」;点部分选中的组头 → 全选
//   save      保存发出的 PUT body 与期望一致(改一个可对话 + 勾一个新的)
//   old hub   task-grants / agent-groups 都 404:没有任务权限区块、没有「分组」页签,弹窗照常
// 手机 390×844(安卓 UA、模拟安全区 32/24)· 浅色 + 深色:成员页 / 选择 Agent / 搜索 / 授权的项目
//   gutter    settings-kit 卡片左右 16±1;选择页的行贴边,圆圈左 16、开关右 16(±1)
//   header    返回箭头左边距 == 右上按钮右边距 ±1;标题在正中 ±1 且画出来
//   rows      选择页每行 ≥ 48
//   text      没有 < 1px 的字
//   save      顶栏「保存」发出的 PUT body 正确
// 任何一步没打开 = FAIL(不是 skip)。
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium, ANDROID_UA, paintedText, zeroSizeText, openStubWindow } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
if (OUT) mkdirSync(OUT, { recursive: true });

let pass = 0; const failures = [];
const ck = (name, ok, extra = '') => { if (ok) pass++; else failures.push(name); console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? ` (${extra})` : ''}`); };
const tid = (id) => `[data-testid="${id}"]`;
const r1 = (v) => Math.round(v * 10) / 10;
const near = (a, b, tol = 1) => a != null && b != null && Math.abs(a - b) <= tol;
const box = async (page, sel) => { const b = await page.locator(sel).first().boundingBox(); return b && { x: r1(b.x), y: r1(b.y), w: r1(b.width), h: r1(b.height), r: r1(b.x + b.width), b: r1(b.y + b.height) }; };

// ── 假 Hub:成员、节点、授权、分组、任务权限、项目。OLD=true ⇒ 没有分组 / 任务权限接口(404)。──
const fixture = ({ old }) => {
  const NET = 'net-sweep';
  const hosts = ['host-01', '打包机', '笔记本'];
  const A = [
    ['设计1号', 0, 'claude-code'], ['设计2号', 0, 'claude-code'], ['设计3号', 1, 'codex'], ['设计4号', 1, 'grok'],
    ['研发A', 0, 'codex'], ['研发B', 0, 'claude-code'], ['研发C', 2, 'opencode'], ['测试甲', 2, 'grok'],
    ['测试乙', 0, 'codex'], ['运维01', 1, 'claude-code'], ['文档助手', 2, 'opencode'], ['数据分析员', 0, 'grok'],
    ['研发D', 1, 'codex'], ['翻译官', 2, 'claude-code'],
  ];
  const nodes = A.map(([alias, h, runtime], i) => ({ node_id: `n_me_${i}`, alias, hostname: hosts[h], runtime, lifecycle_state: 'running', lifecycle_controllable: true, config_revision: 1, config_snapshot: {} }));
  const id = (alias) => nodes.find(n => n.alias === alias).node_id;
  const members = [
    { user_id: 'u_me', username: 'tester', display_name: null, role: 'owner', agent_access: 'all' },
    { user_id: 'u_lin', username: 'lin.design', display_name: '林小设', role: 'member', agent_access: 'granted', agent_grant_count: 4, agent_group_count: 0 },
    { user_id: 'u_zhou', username: 'zhou.dev', display_name: '周研发', role: 'viewer', agent_access: 'granted', agent_grant_count: 2 },
    { user_id: 'u_chen', username: 'chen.ops', display_name: '陈运维', role: 'admin', agent_access: 'all' },
  ];
  const grants = {
    u_lin: { agent_access: 'granted', grants: [['设计1号', true], ['研发A', true], ['研发B', false], ['测试甲', true]].map(([a, c]) => ({ node_id: id(a), alias: a, can_message: c })), group_grants: [] },
    u_zhou: { agent_access: 'granted', grants: [['研发A', false], ['研发C', false]].map(([a, c]) => ({ node_id: id(a), alias: a, can_message: c })), group_grants: [] },
  };
  const groups = [
    { group_id: 'g_front', name: '前端小组', node_ids: [id('设计1号'), id('设计2号'), id('研发A')], member_count: 3, granted_user_count: 1 },
    { group_id: 'g_night', name: '夜间值守', node_ids: [id('运维01')], member_count: 1, granted_user_count: 0 },
  ];
  const projects = [
    { id: 'p_web', name: '官网改版', color: '#3b82f6', sort: 1 }, { id: 'p_app', name: '安卓发布', color: '#10b981', sort: 2 },
    { id: 'p_dash', name: '数据看板', color: '#f59e0b', sort: 3 }, { id: 'p_tool', name: '内部工具', color: '#8b5cf6', sort: 4 },
  ];
  const taskGrants = { u_lin: { task_access: 'scoped', project_grants: [{ project_id: 'p_web', can_edit: true }, { project_id: 'p_app', can_edit: false }] }, u_zhou: { task_access: 'scoped', project_grants: [] } };
  window.__puts = [];
  window.__fixtureIds = Object.fromEntries(nodes.map(n => [n.alias, n.node_id]));
  window.__routeOverride = (u, body, method) => {
    const p = u.pathname;
    if (p === '/api/auth/me') return { ok: true, user: { user_id: 'u_me', username: 'tester', role: 'user' }, current_network: NET, networks: [{ network_id: NET, network_name: 'sweep', member_role: 'owner', agent_access: 'all' }] };
    if (p === '/api/nodes') return { ok: true, nodes, count: nodes.length };
    if (p === `/api/networks/${NET}/members`) return { ok: true, members };
    if (p === `/api/networks/${NET}/agent-groups`) return old ? null : { ok: true, groups };
    if (p === '/api/requirements/projects') return old ? null : { ok: true, projects };
    let m = /^\/api\/networks\/[^/]+\/members\/([^/]+)\/(agent-grants|task-grants)$/.exec(p);
    if (m) {
      const [, uid, kind] = m;
      if (method === 'PUT') { window.__puts.push({ kind, uid, body: JSON.parse(body || '{}') }); return { ok: true, ...(JSON.parse(body || '{}')) }; }
      if (kind === 'task-grants') return old ? null : { ok: true, ...(taskGrants[uid] ?? { task_access: 'all', project_grants: [] }) };
      return { ok: true, ...(grants[uid] ?? { agent_access: 'all', grants: [], group_grants: [] }) };
    }
    m = /^\/api\/networks\/[^/]+\/members\/([^/]+)$/.exec(p);
    if (m && method === 'PUT') { window.__puts.push({ kind: 'role', uid: m[1], body: JSON.parse(body || '{}') }); return { ok: true }; }
    return undefined;
  };
};

const web = await serveExport(WEB);
const browser = await chromium.launch({ executablePath: findChromium() });

// 分段控件每一段的字:画出来、没被截断(scrollWidth ≤ clientWidth + 1)。
const segTextsOk = (page, ids) => page.evaluate((ids) => ids.map(id => {
  const el = document.querySelector(`[data-testid="${id}"]`);
  if (!el) return { id, ok: false, why: 'missing' };
  const b = el.getBoundingClientRect();
  return { id, ok: b.width >= 8 && b.height >= 8 && el.scrollWidth <= el.clientWidth + 1, w: Math.round(b.width), sw: el.scrollWidth, cw: el.clientWidth };
}), ids);

// ─────────────────────────────── 桌面 ───────────────────────────────
async function openDesktop(theme, { old = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  const scripts = [[initScript, { theme }], [fixture, { old }]];
  for (const [fn, arg] of scripts) await page.addInitScript(fn, arg);
  await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
  await page.locator(tid('desktop-rail')).waitFor({ timeout: 20000 });
  await page.getByRole('tab', { name: '设置', exact: true }).click();
  const win = await openStubWindow(page, 'settings', scripts);
  if (!win) throw new Error('settings window did not open');
  win.on('pageerror', e => errors.push(String(e).split('\n')[0]));
  await win.setViewportSize({ width: 1440, height: 900 });
  await win.getByRole('button', { name: '设置分类 用户管理' }).click({ timeout: 20000 });
  await win.locator(tid('user-row-lin.design')).click({ timeout: 10000 });
  await win.locator(tid('grants-dialog')).waitFor({ timeout: 10000 });
  await win.locator(tid('grant-toggle-设计1号')).waitFor({ timeout: 10000 });
  await win.waitForTimeout(500);
  return { ctx, win, errors };
}

for (const theme of ['light', 'dark']) {
  let d;
  try { d = await openDesktop(theme); } catch (e) { ck(`desktop ${theme}: 打开成员弹窗`, false, String(e.message).split('\n')[0]); continue; }
  const { ctx, win, errors } = d;
  const V = { w: 1440, h: 900 };
  const card = await box(win, tid('grants-dialog'));
  ck(`desktop ${theme} frame: 弹窗水平居中(左右留白相等 ±1)`, near(card.x, V.w - card.r), `${card.x} / ${r1(V.w - card.r)}`);
  ck(`desktop ${theme} frame: 弹窗垂直居中(上下留白相等 ±1)`, near(card.y, V.h - card.b), `${card.y} / ${r1(V.h - card.b)}`);
  ck(`desktop ${theme} frame: 宽 880、高 760(窗口放得下时)`, near(card.w, 880) && near(card.h, 760), `${card.w}×${card.h}`);
  const L = await box(win, tid('member-col-left'));
  const R = await box(win, tid('member-col-right'));
  ck(`desktop ${theme} columns: 左栏 340 宽,右栏占满剩下的`, near(L.w, 340) && near(R.x, L.r) && near(R.r, card.r, 1.5), `L ${L.w} · R ${R.x}..${R.r} · card ${card.r}`);
  const roleSeg = await box(win, tid('member-role'));
  const taskSeg = await box(win, tid('task-access-mode'));
  const modeSeg = await box(win, tid('grants-mode'));
  const search = await box(win, tid('grants-search'));
  const list = await box(win, tid('grants-list'));
  ck(`desktop ${theme} columns: 左栏内容左右内边距相等 ±1`, near(roleSeg.x - L.x, L.r - roleSeg.r) && near(taskSeg.x, roleSeg.x) && near(taskSeg.r, roleSeg.r), `${r1(roleSeg.x - L.x)} / ${r1(L.r - roleSeg.r)}`);
  ck(`desktop ${theme} columns: 右栏内容左右内边距相等 ±1`, near(modeSeg.x - R.x, R.r - modeSeg.r) && near(list.x, modeSeg.x) && near(list.r, modeSeg.r), `${r1(modeSeg.x - R.x)} / ${r1(R.r - modeSeg.r)}`);
  ck(`desktop ${theme} columns: 两栏内边距相同`, near(roleSeg.x - L.x, modeSeg.x - R.x), `${r1(roleSeg.x - L.x)} / ${r1(modeSeg.x - R.x)}`);
  const allLink = await box(win, tid('grants-select-visible'));
  const tabs = await box(win, tid('grants-group-by'));
  const clear = await box(win, tid('grants-clear'));
  ck(`desktop ${theme} columns: 「全选」「清空」右边缘 == 清单右边缘 ±1,页签不压「全选」`, near(allLink.r, list.r) && near(clear.r, list.r) && tabs.r < allLink.x, `全选 ${allLink.x}..${allLink.r} 清空 ..${clear.r} list ..${list.r} tabs ..${tabs.r}`);
  const names = await win.evaluate(() => [...document.querySelectorAll('[data-testid^="grant-toggle-"]')].map(el => { const t = [...el.querySelectorAll('div[dir]')].pop(); return t ? t.scrollWidth <= t.clientWidth + 1 : false; }));
  ck(`desktop ${theme} text: 清单里的名字 + 机器 · 类型没被截断`, names.length >= 8 && names.every(Boolean), `${names.filter(x => !x).length} truncated of ${names.length}`);
  const footer = await box(win, tid('grants-dialog-footer'));
  const save = await box(win, tid('grants-confirm'));
  const remove = await box(win, tid('member-remove-open'));
  ck(`desktop ${theme} frame: 清单底在底栏上面,底栏在弹窗里`, list.b <= footer.y + 0.5 && footer.b <= card.b + 0.5 && save.b <= card.b, `list ${list.b} footer ${footer.y}..${footer.b} card ${card.b}`);
  ck(`desktop ${theme} frame: 「移出网络」与「保存」到弹窗两边的距离相等 ±1`, near(remove.x - card.x, card.r - save.r), `${r1(remove.x - card.x)} / ${r1(card.r - save.r)}`);
  const zs = await zeroSizeText(win, tid('grants-dialog'));
  ck(`desktop ${theme} text: 弹窗里没有 < 1px 的字`, zs.length === 0, zs.slice(0, 5).join('; '));
  const segs = await segTextsOk(win, ['member-role-member-text', 'member-role-viewer-text', 'member-role-admin-text', 'task-access-mode-all-text', 'task-access-mode-scoped-text', 'grants-mode-all-text', 'grants-mode-granted-text', 'grants-group-by-none-text', 'grants-group-by-host-text', 'grants-group-by-runtime-text', 'grants-group-by-groups-text']);
  ck(`desktop ${theme} text: 分段控件每一段的字完整(11 段)`, segs.every(s => s.ok), segs.filter(s => !s.ok).map(s => `${s.id} ${s.w} ${s.sw}/${s.cw}`).join('; '));
  // 行:复选框到左边、开关到右边距离相等;开关右边缘对齐
  const rows = await win.evaluate(() => [...document.querySelectorAll('[data-testid^="grant-row-"]')].map(r => {
    const b = r.getBoundingClientRect(); const cb = r.querySelector('[data-testid^="grant-toggle-"] > div')?.getBoundingClientRect();
    const sw = r.querySelector('[role="switch"], input[type="checkbox"]')?.parentElement?.getBoundingClientRect();
    return { id: r.getAttribute('data-testid'), left: cb ? cb.left - b.left : null, right: sw ? b.right - sw.right : null, sr: sw ? sw.right : null, h: b.height };
  }));
  const withSw = rows.filter(r => r.right !== null);
  ck(`desktop ${theme} rows: 已选行的开关右边缘对齐 ±1(${withSw.length} 行)`, withSw.length >= 3 && Math.max(...withSw.map(r => r.sr)) - Math.min(...withSw.map(r => r.sr)) <= 1, withSw.map(r => r1(r.sr)).join(','));
  ck(`desktop ${theme} rows: 复选框到行左 == 开关到行右 ±2`, withSw.every(r => near(r.left, r.right, 2)), withSw.map(r => `${r1(r.left)}/${r1(r.right)}`).join(' '));
  ck(`desktop ${theme} rows: 行高 ≥ 44`, rows.length >= 8 && rows.every(r => r.h >= 43.5), `${rows.length} rows, min ${r1(Math.min(...rows.map(r => r.h)))}`);
  ck(`desktop ${theme}: 已选 4 个 chip`, (await win.locator('[data-testid^="grant-chip-remove-"]').count()) === 4);
  if (OUT) await win.screenshot({ path: `${OUT}/desktop-${theme}.png` });

  // 按机器:组头三态
  await win.locator(tid('grants-group-by-host')).click();
  await win.waitForTimeout(250);
  const hostCount = await win.locator(tid('grant-group-host-01-count')).innerText().catch(() => '');
  const hostState = await win.locator(tid('grant-group-host-01')).getAttribute('aria-checked').catch(() => null);
  ck(`desktop ${theme} groups: host-01 组头 3 / 6、部分选中`, hostCount === '3 / 6' && hostState === 'mixed', `${hostCount} ${hostState}`);
  if (OUT && theme === 'light') await win.screenshot({ path: `${OUT}/desktop-byhost-${theme}.png` });
  await win.locator(tid('grant-group-host-01')).click();
  await win.waitForTimeout(200);
  const after = await win.locator(tid('grant-group-host-01-count')).innerText().catch(() => '');
  ck(`desktop ${theme} groups: 点部分选中的组头 → 全选 6 / 6`, after === '6 / 6' && (await win.locator(tid('grant-group-host-01')).getAttribute('aria-checked')) === 'true', after);
  await win.locator(tid('grant-group-host-01')).click();
  await win.waitForTimeout(200);
  ck(`desktop ${theme} groups: 再点 → 这组全取消 0 / 6`, (await win.locator(tid('grant-group-host-01-count')).innerText()) === '0 / 6');
  // 分组页签:Hub 分组
  await win.locator(tid('grants-group-by-groups')).click();
  await win.waitForTimeout(200);
  ck(`desktop ${theme}: 分组页签列出 Hub 的分组`, (await win.locator(tid('grant-agroup-前端小组')).count()) === 1);
  await win.locator(tid('grants-group-by-none')).click();
  // 搜索
  await win.locator(tid('grants-search')).fill('研发');
  await win.waitForTimeout(250);
  const shown = await win.locator('[data-testid^="grant-row-"]').count();
  ck(`desktop ${theme}: 搜「研发」剩 4 行,全选文案带个数`, shown === 4 && (await win.locator(tid('grants-select-visible')).innerText()).includes('4'), `${shown}`);
  if (OUT && theme === 'light') await win.screenshot({ path: `${OUT}/desktop-search-${theme}.png` });
  await win.locator(tid('grants-search-clear')).click();
  await win.waitForTimeout(150);
  // 移出网络:要确认
  await win.locator(tid('member-remove-open')).click();
  ck(`desktop ${theme}: 点「移出网络」换成确认条(不直接移出)`, (await win.locator(tid('member-remove-box')).count()) === 1 && (await win.evaluate(() => window.__puts.length)) === 0);
  if (OUT && theme === 'light') await win.screenshot({ path: `${OUT}/desktop-remove-confirm-${theme}.png` });
  await win.locator(tid('member-remove-cancel')).click();

  if (theme === 'light') {
    // 保存:此刻 host-01 那组被全选又全取消 ⇒ 设计1号 / 研发A / 研发B 没了;再勾回研发A、研发B(新勾默认可对话,再把研发B 的关掉)、勾上前端小组
    await win.locator(tid('grant-toggle-研发A')).click();
    await win.locator(tid('grant-toggle-研发B')).click();
    await win.locator(tid('grant-can-message-研发B')).click();
    await win.locator(tid('grants-group-by-groups')).click();
    await win.locator(tid('grant-agroup-前端小组')).click();
    await win.locator(tid('task-project-数据看板')).click();
    await win.waitForTimeout(200);
    await win.locator(tid('grants-confirm')).click();
    await win.locator(tid('grants-dialog')).waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
    const puts = await win.evaluate(() => window.__puts);
    const ids = await win.evaluate(() => window.__fixtureIds);
    const ag = puts.find(x => x.kind === 'agent-grants')?.body;
    const tg = puts.find(x => x.kind === 'task-grants')?.body;
    const want = [[ids['研发A'], true], [ids['研发B'], false], [ids['测试甲'], true]].sort((a, b) => a[0].localeCompare(b[0])).map(([node_id, can_message]) => ({ node_id, can_message }));
    ck('desktop save: PUT agent-grants = 仅指定 + 研发A / 研发B(只看)/ 测试甲 + 前端小组', !!ag && ag.agent_access === 'granted' && JSON.stringify(ag.grants) === JSON.stringify(want) && JSON.stringify(ag.group_grants) === JSON.stringify([{ group_id: 'g_front', can_message: true }]), JSON.stringify(ag));
    ck('desktop save: PUT task-grants = scoped + 官网改版(可编辑)/ 安卓发布 / 数据看板', !!tg && tg.task_access === 'scoped' && JSON.stringify(tg.project_grants) === JSON.stringify([{ project_id: 'p_app', can_edit: false }, { project_id: 'p_dash', can_edit: false }, { project_id: 'p_web', can_edit: true }]), JSON.stringify(tg));
    ck('desktop save: 顺序 任务 → 授权,没有改角色', JSON.stringify(puts.map(x => x.kind)) === JSON.stringify(['task-grants', 'agent-grants']), puts.map(x => x.kind).join(','));
  }
  ck(`desktop ${theme}: 没有页面错误`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// 旧 Hub:没有任务权限 / 分组接口
{
  let d;
  try { d = await openDesktop('light', { old: true }); } catch (e) { ck('desktop old hub: 打开成员弹窗', false, String(e.message).split('\n')[0]); }
  if (d) {
    const { ctx, win } = d;
    await win.waitForTimeout(500);
    ck('desktop old hub: 没有任务权限区块', (await win.locator(tid('task-access')).count()) === 0);
    ck('desktop old hub: 没有「分组」页签(三格)', (await win.locator(tid('grants-group-by-groups')).count()) === 0 && (await win.locator(tid('grants-group-by-host')).count()) === 1);
    const single = await box(win, tid('member-col-single'));
    const card = await box(win, tid('grants-dialog'));
    const role = await box(win, tid('member-role'));
    const list = await box(win, tid('grants-list'));
    ck('desktop old hub: 单栏 560 宽,角色在上、授权清单在下,同一左右边距', !!single && near(card.w, 560) && (await win.locator(tid('member-cols')).count()) === 0 && role.b < list.y && near(role.x, list.x) && near(role.r, list.r) && near(role.x - card.x, card.r - role.r), `card ${card.w} role ${role.x}..${role.r} list ${list.x}..${list.r}`);
    ck('desktop old hub: 弹窗居中', near(card.x, 1440 - card.r) && near(card.y, 900 - card.b), `${card.x}/${r1(1440 - card.r)} ${card.y}/${r1(900 - card.b)}`);
    const zs = await zeroSizeText(win, tid('grants-dialog'));
    ck('desktop old hub: 没有 < 1px 的字', zs.length === 0, zs.slice(0, 3).join('; '));
    if (OUT) await win.screenshot({ path: `${OUT}/desktop-old-hub-light.png` });
    await ctx.close();
  }
}

// ─────────────────────────────── 手机 ───────────────────────────────
const phoneMeasure = () => {
  const W = window.innerWidth;
  const vis = (el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
  const cards = [...document.querySelectorAll('[data-testid="settings-kit-card"]')].filter(vis).map(c => { const b = c.getBoundingClientRect(); return [b.left, W - b.right]; });
  const back = document.querySelector('[data-testid="settings-back"] svg, [data-testid="settings-back"] [dir], [data-testid="settings-back"] > *')?.getBoundingClientRect();
  const title = document.querySelector('[data-testid="settings-subpage-title"]')?.getBoundingClientRect();
  return { W, cards, backLeft: back ? back.left : null, titleCx: title ? title.left + title.width / 2 : null };
};

for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: ANDROID_UA, colorScheme: theme, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).split('\n')[0]));
  await page.addInitScript(initScript, { theme });
  await page.addInitScript(fixture, { old: false });
  await page.goto(`${web.url}?safeAreaSim=32,0,24,0`);
  try {
    await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 20000 });
    await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'settings' }));
    await page.locator(tid('settings-row-users')).click({ timeout: 10000 });
    await page.locator(tid('user-row-lin.design')).click({ timeout: 10000 });
    await page.locator(tid('member-page')).waitFor({ timeout: 10000 });
    await page.locator(tid('member-picked-agents')).waitFor({ timeout: 10000 });
    await page.locator(tid('task-access')).waitFor({ timeout: 10000 });
  } catch (e) { ck(`phone ${theme}: 打开成员页`, false, String(e.message).split('\n')[0]); await ctx.close(); continue; }
  await page.waitForTimeout(600);
  const checkPage = async (name, { kitCards = true } = {}) => {
    const m = await page.evaluate(phoneMeasure);
    const act = await box(page, '[data-testid="settings-subpage-header"] [role="button"]:last-child');
    const titleP = await paintedText(page, tid('settings-subpage-title'));
    if (kitCards) ck(`phone ${theme} ${name} gutter: 卡片左右 16±1`, m.cards.length > 0 && m.cards.every(([l, r]) => near(l, 16) && near(r, 16)), JSON.stringify(m.cards.map(c => c.map(r1))));
    ck(`phone ${theme} ${name} header: 返回箭头左边距 == 右上按钮右边距 ±1`, !!act && near(m.backLeft, m.W - act.r), `${r1(m.backLeft)} / ${act ? r1(m.W - act.r) : '-'}`);
    ck(`phone ${theme} ${name} header: 标题正中 ±1 且画出来`, near(m.titleCx, m.W / 2) && !!titleP?.painted && titleP.w >= 16, `${r1(m.titleCx)} · ${titleP?.text}`);
    const zs = await zeroSizeText(page);
    ck(`phone ${theme} ${name} text: 没有 < 1px 的字`, zs.length === 0, zs.slice(0, 5).join('; '));
  };
  await checkPage('member');
  ck(`phone ${theme}: 顶栏「保存」一开始不可点`, (await page.locator(tid('grants-confirm')).getAttribute('aria-disabled')) === 'true');
  const stack = await box(page, tid('member-picked-stack'));
  const pickedRow = await box(page, tid('member-picked-agents'));
  ck(`phone ${theme}: 已选 Agent 行带头像叠放、在行内`, !!stack && stack.x > pickedRow.x + 80 && stack.r < pickedRow.r, stack && `${stack.x}..${stack.r} in ${pickedRow.x}..${pickedRow.r}`);
  if (OUT) await page.screenshot({ path: `${OUT}/phone-member-${theme}.png` });
  await page.locator(tid('settings-scroll')).evaluate(el => el.scrollTo(0, 10000));
  await page.waitForTimeout(300);
  if (OUT) await page.screenshot({ path: `${OUT}/phone-member-scrolled-${theme}.png` });

  // 选择 Agent
  await page.locator(tid('member-picked-agents')).click();
  await page.locator(tid('member-pick-page')).waitFor({ timeout: 5000 });
  await page.waitForTimeout(400);
  await checkPage('pick', { kitCards: false });
  ck(`phone ${theme} pick: 标题「选择 Agent」、右上「完成(4)」`, (await page.locator(tid('settings-subpage-title')).innerText()) === '选择 Agent' && (await page.locator(tid('member-pick-done')).innerText()) === '完成(4)');
  const prow = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="grant-row-"]')].map(r => {
    const b = r.getBoundingClientRect(); const circ = r.querySelector('[data-testid^="grant-toggle-"] > div')?.getBoundingClientRect();
    const sw = r.querySelector('[role="switch"], input[type="checkbox"]')?.parentElement?.getBoundingClientRect();
    return { l: b.left, r: window.innerWidth - b.right, h: b.height, cl: circ ? circ.left : null, sr: sw ? window.innerWidth - sw.right : null };
  }));
  ck(`phone ${theme} pick rows: 行贴边(0 / 0),圆圈左 16 ±1`, prow.length >= 10 && prow.every(x => near(x.l, 0) && near(x.r, 0) && near(x.cl, 16)), `${prow.length} rows`);
  const sws = prow.filter(x => x.sr !== null);
  ck(`phone ${theme} pick rows: 开关右 16 ±1(${sws.length} 个)`, sws.length >= 3 && sws.every(x => near(x.sr, 16)), sws.map(x => r1(x.sr)).join(','));
  ck(`phone ${theme} pick rows: 行高 ≥ 48`, prow.every(x => x.h >= 48), `min ${r1(Math.min(...prow.map(x => x.h)))}`);
  const segs = await segTextsOk(page, ['grants-group-by-none-text', 'grants-group-by-host-text', 'grants-group-by-runtime-text', 'grants-group-by-groups-text']);
  ck(`phone ${theme} pick text: 页签四段字完整`, segs.every(s => s.ok), segs.filter(s => !s.ok).map(s => s.id).join(','));
  if (OUT) await page.screenshot({ path: `${OUT}/phone-pick-agents-${theme}.png` });
  await page.locator(tid('grants-search')).fill('研发');
  await page.waitForTimeout(250);
  ck(`phone ${theme} pick: 搜「研发」剩 4 行`, (await page.locator('[data-testid^="grant-row-"]').count()) === 4);
  if (OUT) await page.screenshot({ path: `${OUT}/phone-pick-agents-search-${theme}.png` });
  await page.locator(tid('grants-search-clear')).click();
  await page.locator(tid('grants-group-by-host')).click();
  await page.waitForTimeout(200);
  ck(`phone ${theme} pick: 按机器组头 3 / 6、部分选中`, (await page.locator(tid('grant-group-host-01-count')).innerText()) === '3 / 6' && (await page.locator(tid('grant-group-host-01')).getAttribute('aria-checked')) === 'mixed');
  if (OUT && theme === 'light') await page.screenshot({ path: `${OUT}/phone-pick-byhost-${theme}.png` });
  await page.locator(tid('grants-group-by-none')).click();
  // 勾一个新的、移掉一个 chip
  await page.locator(tid('grant-toggle-设计2号')).click();
  await page.locator(tid('grant-chip-remove-测试甲')).click();
  await page.waitForTimeout(200);
  ck(`phone ${theme} pick: 勾一个、移一个 → 完成(4)`, (await page.locator(tid('member-pick-done')).innerText()) === '完成(4)');
  await page.locator(tid('member-pick-done')).click();
  await page.locator(tid('member-page')).waitFor({ timeout: 5000 });
  ck(`phone ${theme}: 完成 → 回到成员页,标题「成员」`, (await page.locator(tid('settings-subpage-title')).innerText()) === '成员');

  // 授权的项目
  await page.locator(tid('task-access-projects-row')).click();
  await page.locator(tid('member-projects-page')).waitFor({ timeout: 5000 });
  await page.waitForTimeout(300);
  await checkPage('projects');
  if (OUT) await page.screenshot({ path: `${OUT}/phone-projects-${theme}.png` });
  await page.locator(tid('task-project-内部工具')).click();
  await page.locator(tid('settings-back')).click();
  await page.locator(tid('member-page')).waitFor({ timeout: 5000 });
  ck(`phone ${theme}: 返回键先退回成员页(不是退出成员)`, (await page.locator(tid('member-page')).count()) === 1);

  if (theme === 'light') {
    await page.locator(tid('grants-confirm')).click();
    await page.locator(tid('member-page')).waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
    const puts = await page.evaluate(() => window.__puts);
    const ids = await page.evaluate(() => window.__fixtureIds);
    const ag = puts.find(x => x.kind === 'agent-grants')?.body;
    const tg = puts.find(x => x.kind === 'task-grants')?.body;
    const want = [[ids['设计1号'], true], [ids['研发A'], true], [ids['研发B'], false], [ids['设计2号'], true]].sort((a, b) => a[0].localeCompare(b[0])).map(([node_id, can_message]) => ({ node_id, can_message }));
    ck('phone save: PUT agent-grants = 设计1号 / 研发A / 研发B(只看)/ 设计2号,group_grants 不变', !!ag && JSON.stringify(ag.grants) === JSON.stringify(want) && JSON.stringify(ag.group_grants) === '[]', JSON.stringify(ag));
    ck('phone save: PUT task-grants 加了内部工具', !!tg && tg.project_grants.some(g => g.project_id === 'p_tool' && g.can_edit === false) && tg.project_grants.length === 3, JSON.stringify(tg));
  }
  ck(`phone ${theme}: 没有页面错误`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

await browser.close(); web.close();
console.log(`\n${pass}/${pass + failures.length} passed`);
if (failures.length) { console.log('FAILED:\n  ' + failures.join('\n  ')); process.exit(1); }
