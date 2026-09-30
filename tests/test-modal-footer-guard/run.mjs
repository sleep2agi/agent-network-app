// 弹窗「按钮行被长内容挤出屏幕」的几何守卫(2026-09-30 Vincent「新建用户的确认键呢」:26 个网络平铺成 chip,
// 「创建」掉到屏幕外,弹窗不能滚)。
// Not in CI: needs Playwright + Chromium and a web export. No hub: an in-page Tauri stub answers every request
// with placeholder data — 40 networks with long names (placeholders, not real network names).
//
//   WEB_DIR=<expo export dir> OUT=<png dir> PLAYWRIGHT_MODULE=<…/playwright/index.mjs> node tests/test-modal-footer-guard/run.mjs
//
// For 360×640 (Android UA, phone) and 1280×720 (desktop UA):
//   设置 → 用户管理 → 新建用户, fill the form, then
//   A  the confirm button (创建) and 取消 are fully inside the viewport, and inside the dialog card
//   B  same after opening the 网络 picker (the long list must not push the footer out either)
//   C  the dialog card itself is inside the viewport
// Exit 1 when any assertion fails. Run it against the pre-fix export first: it must go red.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { serveExport, findChromium, ANDROID_UA } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { WEB_DIR: WEB, OUT } = process.env;
if (!WEB || !OUT) throw new Error('need WEB_DIR OUT');
mkdirSync(OUT, { recursive: true });
const web = await serveExport(WEB);
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const tid = (id) => `[data-testid="${id}"]`;
const r1 = (n) => Math.round(n * 10) / 10;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
const record = (vp, what, checks, detail = {}) => {
  const ok = Object.values(checks).every(Boolean);
  if (!ok) failures++;
  console.log(JSON.stringify({ vp, what, ok, failed: Object.keys(checks).filter(k => !checks[k]).join(',') || '-', ...detail }));
};
const box = async (page, sel) => { const b = await page.locator(sel).first().boundingBox().catch(() => null); return b && { x: r1(b.x), y: r1(b.y), w: r1(b.width), h: r1(b.height), r: r1(b.x + b.width), b: r1(b.y + b.height) }; };
const inside = (b, vw, vh) => !!b && b.x >= -0.5 && b.y >= -0.5 && b.r <= vw + 0.5 && b.b <= vh + 0.5;
const within = (b, c) => !!b && !!c && b.x >= c.x - 0.5 && b.y >= c.y - 0.5 && b.r <= c.r + 0.5 && b.b <= c.b + 0.5;

// Runs in the page. Placeholder data only.
const initScript = () => {
  const HUB = 'http://mock-hub.invalid';
  const N = 40;
  const networks = Array.from({ length: N }, (_, i) => ({
    network_id: `net-${String(i).padStart(2, '0')}`,
    network_name: i === 0 ? 'default' : i % 3 === 0 ? `placeholder_upload_admin_17811549${String(i).padStart(5, '0')}_${100 + i}` : `示例网络-${i}`,
  }));
  const agents = Array.from({ length: N }, (_, i) => ({ node_id: `n-${i}`, alias: `示例-agent-${i}` }));
  const profile = { serverUrl: HUB, token: 'placeholder-token', username: 'tester', profileId: 'p-guard', displayName: 'tester', networkId: 'net-00' };
  const route = (url) => {
    const p = new URL(url).pathname;
    if (p === '/api/auth/me') return { ok: true, user: { user_id: 'u_tester', username: 'tester', role: 'admin' }, current_network: 'net-00', networks: networks.map((n, i) => ({ ...n, member_role: i === 0 ? 'owner' : 'member', agent_access: 'all' })) };
    if (p === '/api/networks') return { ok: true, networks };
    if (/^\/api\/networks\/[^/]+\/members$/.test(p)) return { ok: true, members: [{ user_id: 'u_tester', username: 'tester', role: 'owner', agent_access: 'all' }, { user_id: 'u_other', username: 'other', role: 'member', agent_access: 'granted', agent_grant_count: 0 }] };
    if (p === '/api/status') return { ok: true, sessions: [] };
    if (p === '/api/nodes') return { ok: true, nodes: agents, count: agents.length };
    if (/\/members\/[^/]+\/agent-grants$/.test(p)) return { ok: true, agent_access: 'granted', grants: [] };
    if (p === '/api/messages') return { ok: true, messages: [], unread: 0, pending_count: 0 };
    if (p.startsWith('/api/events') || p.startsWith('/events')) return null;
    return { ok: true };
  };
  let rid = 0; const reqs = new Map(); const bodies = new Map();
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
    transformCallback: (cb) => { const id = Math.floor(Math.random() * 1e9); window[`_${id}`] = cb; return id; },
    convertFileSrc: (p) => p,
    invoke: async (cmd, args) => {
      switch (cmd) {
        case 'load_active_desktop_profile': return JSON.stringify(profile);
        case 'save_desktop_profile': return args.sessionJson;
        case 'read_desktop_profile_file': return null;
        case 'get_theme_preference': return 'light';
        case 'plugin:event|listen': return 0;
        case 'plugin:http|fetch': { const id = ++rid; reqs.set(id, args.clientConfig); return id; }
        case 'plugin:http|fetch_send': {
          const c = reqs.get(args.rid);
          const body = route(c.url);
          const buf = new TextEncoder().encode(body === null ? '{"ok":false}' : JSON.stringify(body));
          const id = ++rid; bodies.set(id, { buf, sent: false });
          return { status: body === null ? 404 : 200, statusText: 'OK', url: c.url, headers: [['content-type', 'application/json']], rid: id };
        }
        case 'plugin:http|fetch_read_body': {
          const b = bodies.get(args.rid);
          if (!b.sent) { b.sent = true; return [...b.buf, 0]; }
          return [1];
        }
        default: return null;
      }
    },
  };
};

const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
async function run(vp, viewport, ua) {
  // C needs the ua to decide phone vs desktop
  const ctx = await browser.newContext({ viewport, userAgent: ua, deviceScaleFactor: 2, locale: 'zh-CN' });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGEERROR', e.message.split('\n')[0]));
  await page.addInitScript(() => { try { localStorage.setItem('theme_mode_v1', 'light'); localStorage.setItem('anet.language.v1', 'zh'); } catch {} });
  await page.addInitScript(initScript);
  await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
  // Same hook the layout sweep uses (App.tsx, web + ?safeAreaSim only): the desktop shell has no 设置 tab.
  await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 30000 });
  await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'settings' }));
  await page.locator(tid('settings-phone-list') + ',' + tid('settings-pane') + ',' + tid('settings-back')).first().waitFor({ timeout: 8000 });
  for (let i = 0; i < 3 && await page.locator(tid('settings-back')).isVisible().catch(() => false); i++) { await page.locator(tid('settings-back')).click(); await sleep(200); }
  if (await page.locator(tid('settings-row-users')).isVisible().catch(() => false)) await page.locator(tid('settings-row-users')).click();
  else await page.locator(tid('settings-sidebar')).getByText('用户管理', { exact: true }).click();
  await page.locator(tid('user-management-new')).click({ timeout: 10000 });
  await page.locator(tid('new-user-dialog')).waitFor({ timeout: 8000 });
  await page.locator(tid('new-user-username')).fill('guard_user');
  await page.locator(tid('new-user-password')).fill('guard-password-1');
  await sleep(400);

  const measure = async (label) => {
    const card = await box(page, tid('new-user-dialog'));
    const confirm = await box(page, tid('new-user-confirm'));
    const cancel = await box(page, tid('new-user-cancel'));
    await page.screenshot({ path: join(OUT, `${vp}-${label}.png`) });
    record(vp, `${label}: confirm (创建) fully inside the viewport`, { confirm: inside(confirm, viewport.width, viewport.height) }, { confirm, viewport });
    record(vp, `${label}: 取消 fully inside the viewport`, { cancel: inside(cancel, viewport.width, viewport.height) }, { cancel });
    record(vp, `${label}: buttons inside the dialog card, card inside the viewport`, { confirmInCard: within(confirm, card), card: inside(card, viewport.width, viewport.height) }, { card });
    return { card, confirm, cancel };
  };
  const a = await measure('A-form');
  // B: open the network picker (new build) — the old build has no picker, its chips are always shown.
  const picker = page.locator(tid('new-user-network'));
  if ((await picker.getAttribute('role').catch(() => null)) === 'button') {
    await picker.click();
    await sleep(300);
    const b = await measure('B-picker-open');
    const list = await box(page, tid('new-user-network-list'));
    record(vp, 'B: picker list is compact (≤ 220 px) and inside the card', { compact: !!list && list.h <= 220.5, inCard: within(list, b.card) }, { list });
    await page.locator(tid('new-user-network-search')).fill('default');
    await sleep(200);
    const rows = await page.locator('[data-testid^="new-user-network-net-"]').count();
    record(vp, 'B: search narrows the list', { one: rows === 1 }, { rows });
  }
  const chipCount = await page.locator('[data-testid^="new-user-network-net-"]').count();
  // C: the member dialog (desktop only — the phone opens a settings page, not a modal) with 40 agents.
  if (!ua.includes('Android') && await page.locator(tid('user-row-other')).count()) {
    await page.locator(tid('new-user-dialog-close')).click().catch(() => {});
    await page.locator(tid('new-user-dialog')).waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
    await page.locator(tid('user-row-other')).click();
    await page.locator(tid('grants-dialog')).waitFor({ timeout: 8000 });
    await page.locator(tid('grants-mode-granted')).click().catch(() => {});
    await sleep(500);
    const card = await box(page, tid('grants-dialog'));
    const save = await box(page, tid('grants-confirm'));
    const remove = await box(page, tid('member-remove-open'));
    await page.screenshot({ path: join(OUT, `${vp}-C-member-40-agents.png`) });
    record(vp, 'C: member dialog with 40 agents — 保存 and 移出网络 inside the viewport and the card', { save: inside(save, viewport.width, viewport.height) && within(save, card), remove: !remove || inside(remove, viewport.width, viewport.height), card: inside(card, viewport.width, viewport.height) }, { card, save, remove });
  }
  console.log(JSON.stringify({ vp, measures: { A: a }, networkOptionsRendered: chipCount }));
  await ctx.close();
}

await run('phone-360x640', { width: 360, height: 640 }, ANDROID_UA);
await run('desktop-1280x720', { width: 1280, height: 720 }, MAC_UA);
await browser.close();
web.close();
console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
