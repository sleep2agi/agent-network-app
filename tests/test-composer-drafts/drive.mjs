// #632 会话草稿(微信同款):输入框里没发出去的字,离开会话 / 切会话 / 刷新(= 重启)后还在;
// 会话列表里有草稿的会话显示红色「[草稿]」+ 开头几个字;发成功清掉;私信发失败不清。
// 真应用(expo web 导出 + 页内 Tauri http 桩)端到端。没有 hub 进程、没有端口、不碰 HOME;别名全是占位(示例-A / 示例-B / demo-peer)。
//
//   WEB_DIR=<expo export 目录> OUT=<截图目录> [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] node tests/test-composer-drafts/drive.mjs
//
// 桌面 1440×900(侧栏 + 会话,主窗口复用同一个 ChatScreen 切会话)和手机 390×844(列表 ⇄ 会话):
//   1  A 里打字 → 切到 B:B 的输入框是空的(不串)
//   2  列表:A 行显示红色「[草稿]」+ 草稿开头,代替最后一条预览
//   3  回到 A:字还在
//   4  刷新页面(= 重启 app):列表仍显示 [草稿],进 A 字还在
//   5  打字后 300ms 内立刻刷新(去抖还没到点):pagehide 落盘,字还在
//   6  发送(成功):输入框清空、列表不再显示 [草稿]、刷新后进 A 也是空的
//   7  私信发失败:输入框清空(气泡标未送达),离开再回来字还在,列表显示 [草稿]
//   8  清空输入框 = 删草稿
//   9  选了还没发的图:切走再回来还在(不串到别的会话;只在本次运行内,刷新 / 重启不保留)
// 退出码 1 = 任何一条失败。改动前的导出跑它必须红。
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
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const A = '示例-A', B = '示例-B', PEER = 'demo-peer';
const TEXT_A = '还没写完的草稿：明天上午十点前把部署清单发我';
const TEXT_DM = '私信草稿：发不出去也别丢';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

let failures = 0, total = 0;
const ck = (tag, name, cond, detail = '') => { total++; if (!cond) failures++; console.log(`${cond ? 'PASS' : 'FAIL'} [${tag}] ${name}${detail ? ` — ${detail}` : ''}`); };

const initScript = ({ theme }) => {
  const HUB = 'http://mock-hub.invalid';
  const iso = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();
  const profile = { serverUrl: HUB, token: 'placeholder-token', username: 'tester', profileId: 'p-drafts', displayName: 'tester', networkId: 'net-drafts' };
  const sessions = [
    { alias: '示例-A', status: 'idle', agent: 'claude-code', runtime: 'agent-node', node_id: 'n_demo_a', task: '上一条任务预览 A', updated_at: iso(1) },
    { alias: '示例-B', status: 'idle', agent: 'claude-code', runtime: 'agent-node', node_id: 'n_demo_b', task: '上一条任务预览 B', updated_at: iso(2) },
  ];
  const humans = [{ user_id: 'u_tester', username: 'tester' }, { user_id: 'u_peer', username: 'demo-peer' }];
  try { localStorage.setItem('voice_composer_input_mode_v1', 'keyboard'); localStorage.setItem('anet.language.v1', 'zh'); localStorage.setItem('theme_mode_v1', theme); } catch {}
  window.__posts = [];
  const decode = (data) => { try { return data ? new TextDecoder().decode(new Uint8Array(data)) : ''; } catch { return ''; } };
  const route = (url, method) => {
    const p = new URL(url).pathname;
    const ok = (body) => ({ status: 200, body });
    if (p === '/api/task' && method === 'POST') return ok({ ok: true, task_id: `t_demo_${Date.now()}` });
    if (p === '/api/dm' && method === 'POST') return { status: 500, body: { ok: false, error: 'stub: dm send fails' } };
    if (p === '/api/auth/me') return ok({ ok: true, user: { user_id: 'u_tester', username: 'tester', role: 'user' }, current_network: 'net-drafts', networks: [{ network_id: 'net-drafts', name: 'demo', member_role: 'member', agent_access: 'all' }] });
    if (p === '/api/networks/net-drafts/humans') return ok({ ok: true, humans });
    if (p === '/api/dm/threads') return ok({ ok: true, threads: [] });
    if (p === '/api/dm') return ok({ ok: true, messages: [] });
    if (p === '/api/status') return ok({ ok: true, sessions, files_capable: true });
    if (p === '/api/nodes') return ok({ ok: true, nodes: sessions.map(s => ({ node_id: s.node_id, alias: s.alias })), count: sessions.length });
    if (p === '/api/tasks') return ok({ ok: true, tasks: [] });
    if (p === '/api/messages') return ok({ ok: true, messages: [], unread: 0, pending_count: 0 });
    if (p === '/api/side-threads/capability') return ok({ ok: true, supported: false });
    if (p.startsWith('/api/events') || p.startsWith('/events')) return { status: 404, body: { ok: false } };
    return ok({ ok: true });
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
        case 'get_theme_preference': return theme;
        case 'plugin:event|listen': return 0;
        case 'plugin:http|fetch': { const id = ++rid; reqs.set(id, args.clientConfig); return id; }
        case 'plugin:http|fetch_send': {
          const c = reqs.get(args.rid);
          const method = String(c.method || 'GET').toUpperCase();
          if (method === 'POST') window.__posts.push({ path: new URL(c.url).pathname, body: decode(c.data) });
          const r = route(c.url, method);
          const buf = new TextEncoder().encode(JSON.stringify(r.body));
          const id = ++rid; bodies.set(id, { buf, sent: false });
          return { status: r.status, statusText: r.status === 200 ? 'OK' : 'ERR', url: c.url, headers: [['content-type', 'application/json']], rid: id };
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
const SHOTS = [];

async function run(tag, viewport, ua, phone) {
  const ctx = await browser.newContext({ viewport, userAgent: ua, deviceScaleFactor: 2, locale: 'zh-CN', colorScheme: 'light' });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGEERROR', e.message.split('\n')[0]));
  await page.addInitScript(initScript, { theme: 'light' });
  const shot = async (name) => { const f = join(OUT, `drafts-${tag}-${name}.png`); await page.screenshot({ path: f }); SHOTS.push(f); };
  const composer = (alias) => page.locator(`textarea[placeholder*="${alias}"]`).first();
  const waitList = () => page.locator(tid(`agent-row-${A}`)).first().waitFor({ timeout: 30000 });
  const open = async (alias) => {
    await page.locator(tid(`agent-row-${alias}`)).first().click();
    await composer(alias).waitFor({ timeout: 15000 });
    await sleep(400);
  };
  const back = async () => {
    if (!phone) return;
    await page.locator(`${tid('chat-header-back')}, ${tid('dm-header-back')}`).first().click();
    await waitList();
    await sleep(500);
  };
  // 发送:桌面 = Enter(默认发送键);手机 = 输入行里的「发送」按钮(手机上 Enter 是换行)。
  const send = async (input) => {
    if (phone) await page.locator(tid('composer-send')).first().click();
    else { await input.click(); await page.keyboard.press('Enter'); }
  };
  const draftLine = async (id) => {
    const loc = page.locator(tid(id)).first();
    if (!(await loc.count())) return null;
    return loc.evaluate(el => {
      const tag = el.firstElementChild;
      return { text: el.textContent, tagText: tag?.textContent ?? '', tagColor: tag ? getComputedStyle(tag).color : '' };
    });
  };
  const isRed = (rgb) => { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb || ''); return !!m && +m[1] > 150 && +m[2] < 110 && +m[3] < 110; };

  await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
  await waitList();
  await sleep(1200);

  // 1 A 打字 → 切到 B
  await open(A);
  await composer(A).click();
  await page.keyboard.type(TEXT_A);
  await sleep(100);
  await back();
  await open(B);
  ck(tag, '1 切到 B:B 的输入框是空的(草稿不串会话)', (await composer(B).inputValue()) === '', JSON.stringify(await composer(B).inputValue()));
  await back();

  // 2 列表 [草稿]
  await sleep(500);
  const line = await draftLine(`draft-preview-${A}`);
  ck(tag, '2 列表:A 行显示「[草稿]」+ 草稿开头', !!line && line.tagText === '[草稿]' && line.text.includes(TEXT_A.slice(0, 8)), JSON.stringify(line));
  ck(tag, '2 「[草稿]」是红色', !!line && isRed(line.tagColor), line?.tagColor ?? '');
  ck(tag, '2 A 行不再显示最后一条预览', (await page.locator(tid(`agent-row-${A}`)).first().innerText()).includes('上一条任务预览 A') === false);
  ck(tag, '2 B 行没有草稿', !(await draftLine(`draft-preview-${B}`)));
  await shot('1-list-draft');

  // 3 回到 A
  await open(A);
  ck(tag, '3 回到 A:字还在', (await composer(A).inputValue()) === TEXT_A, JSON.stringify(await composer(A).inputValue()));
  await shot('2-restored-composer');

  // 4 刷新 = 重启
  await page.reload();
  await waitList();
  await sleep(1200);
  if (!phone) await open(B); // 桌面刷新后可能直接回到上次的会话:先站到 B,A 行才是「不在开着的」那一行
  if (!phone) await sleep(300);
  const afterReload = await draftLine(`draft-preview-${A}`);
  ck(tag, '4 刷新后列表仍显示 [草稿]', !!afterReload && afterReload.tagText === '[草稿]', JSON.stringify(afterReload));
  if (phone) await shot('3-list-after-reload');
  await open(A);
  ck(tag, '4 刷新后进 A:字还在', (await composer(A).inputValue()) === TEXT_A, JSON.stringify(await composer(A).inputValue()));

  // 5 打字后立刻刷新(去抖 300ms 还没到点)
  await composer(A).click();
  await page.keyboard.press('End');
  await page.keyboard.type('X');
  await page.reload();
  await waitList();
  await sleep(1200);
  await open(A);
  ck(tag, '5 打字后立刻刷新:最后一个字也在(pagehide 落盘)', (await composer(A).inputValue()) === `${TEXT_A}X`, JSON.stringify(await composer(A).inputValue()));

  // 6 发送成功 → 清
  await page.evaluate(() => { window.__posts = []; });
  await send(composer(A));
  await page.waitForFunction(() => window.__posts.some(p => p.path === '/api/task'), null, { timeout: 10000 }).catch(() => {});
  await sleep(800);
  ck(tag, '6 发送:/api/task 带着这段字', await page.evaluate((t) => window.__posts.some(p => p.path === '/api/task' && p.body.includes(t)), TEXT_A.slice(0, 8)));
  ck(tag, '6 发送后输入框清空', (await composer(A).inputValue()) === '');
  await back();
  if (!phone) await open(B);
  ck(tag, '6 发送后列表不再显示 [草稿]', !(await draftLine(`draft-preview-${A}`)));
  await page.reload();
  await waitList();
  await sleep(1200);
  await open(A);
  ck(tag, '6 发送后刷新再进 A:输入框是空的', (await composer(A).inputValue()) === '');
  await back();

  // 7 私信发失败 → 不清
  const person = page.locator(tid(`person-row-${PEER}`)).first();
  const hasPerson = await person.waitFor({ timeout: 10000 }).then(() => true, () => false);
  ck(tag, '7 人员行在(私信用例的前提)', hasPerson);
  if (hasPerson) {
    const dmInput = page.locator(`textarea[placeholder*="${PEER}"]`).first();
    await person.click();
    await dmInput.waitFor({ timeout: 15000 });
    await dmInput.click();
    await page.keyboard.type(TEXT_DM);
    await page.evaluate(() => { window.__posts = []; });
    await send(dmInput);
    await page.waitForFunction(() => window.__posts.some(p => p.path === '/api/dm'), null, { timeout: 10000 }).catch(() => {});
    await sleep(1000);
    ck(tag, '7 私信发送:请求发出(桩回 500)', await page.evaluate(() => window.__posts.some(p => p.path === '/api/dm')));
    ck(tag, '7 发失败:输入框照常清空(气泡标未送达)', (await dmInput.inputValue()) === '', JSON.stringify(await dmInput.inputValue()));
    if (phone) { await back(); } else { await open(B); }
    const dmLine = await draftLine(`draft-preview-person-${PEER}`);
    ck(tag, '7 发失败离开后:列表显示 [草稿]', !!dmLine && dmLine.tagText === '[草稿]' && dmLine.text.includes(TEXT_DM.slice(0, 5)), JSON.stringify(dmLine));
    await person.click();
    await dmInput.waitFor({ timeout: 15000 });
    await sleep(400);
    ck(tag, '7 发失败离开再回来:字还在', (await dmInput.inputValue()) === TEXT_DM, JSON.stringify(await dmInput.inputValue()));

    // 8 清空 = 删
    await dmInput.fill('');
    await sleep(500);
    if (phone) { await back(); } else { await open(B); }
    ck(tag, '8 清空输入框后列表不再显示 [草稿]', !(await draftLine(`draft-preview-person-${PEER}`)));
  }

  // 9 选了还没发的图:切走再回来还在(本次运行内;重启不保留,PR 里写明)
  await open(A);
  const chooserP = page.waitForEvent('filechooser', { timeout: 8000 });
  await page.locator(tid(phone ? 'composer-plus' : 'composer-desktop-plus')).first().click(); // 桌面 ＋ = 系统文件选择器
  if (phone) await page.getByText('相册', { exact: true }).first().click({ timeout: 5000 }).catch(() => {});
  const chooser = await chooserP.catch(() => null);
  ck(tag, '9 打开了选图器(前提)', !!chooser);
  if (chooser) {
    await chooser.setFiles({ name: 'demo.png', mimeType: 'image/png', buffer: PNG });
    await page.locator(tid('composer-draft-thumb')).first().waitFor({ timeout: 8000 }).catch(() => {});
    const before = await page.locator(tid('composer-draft-thumb')).count();
    await back();
    await open(B);
    const inB = await page.locator(tid('composer-draft-thumb')).count();
    await back();
    await open(A);
    await sleep(300);
    const after = await page.locator(tid('composer-draft-thumb')).count();
    ck(tag, '9 图不串到 B,回到 A 图还在', before === 1 && inB === 0 && after === 1, `before=${before} inB=${inB} after=${after}`);
  }
  await ctx.close();
}

await run('desktop-1440x900', { width: 1440, height: 900 }, MAC_UA, false);
await run('phone-390x844', { width: 390, height: 844 }, ANDROID_UA, true);
await browser.close();
web.close();
console.log(`\nscreenshots:\n${SHOTS.join('\n')}`);
console.log(`\n${total - failures}/${total} passed`);
process.exit(failures ? 1 : 0);
