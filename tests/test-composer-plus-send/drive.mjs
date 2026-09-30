// ＋ 常驻、有东西可发时 发送 出现在 ＋ 右边(owner 2026-09-27 大 bug:有字时 ＋ 被 发送 顶掉,图文没法一起发)。
// 真应用(expo web 导出 + Tauri 桥桩)端到端 + 量尺寸。不进 CI:要 Playwright + Chromium。
//
//   WEB_DIR=<expo export 目录> OUT=<截图目录> [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] node tests/test-composer-plus-send/drive.mjs
//
// 没有 hub 进程、没有端口、不碰 HOME:hub 由页内 Tauri http 桩回答(占位别名 示例-A),发往 hub 的 POST 记进 window.__posts。
// 视口:390×844 手机单栏;1000×700 + 安卓 UA = 折叠屏展开的双栏(wide-layout.ts:安卓 ≥700 宽 = twoPane);
// 1200×850 无安卓 UA = 桌面(#438 自己的工具栏输入区,只验证没被波及)。键盘模式。
//
// 断言(手机 / 折叠屏,亮色):
//   1 空:只有 ＋,没有 发送
//   2 打字:＋ 还在,发送 出现在 ＋ 右边;发送 是动画出现的(宽度有中间值)
//   3 几何:＋ / 发送 与输入行同一中线(≤1px);输入框→＋ 间距 = ＋→发送 间距(≤1px);右内边距 = 左内边距(≤1px)
//   4 有字时点 ＋ → 相册 → 选一张图:文字还在,发送 还在
//   5 点 发送:先传图(/api/upload),再一条 /api/task,正文含这段文字、attachments 1 个;草稿清空,回到只有 ＋
//   6 只有图没有字:发送 出现
//   7 清空文字:发送 动画消失(不是立刻没)
// 退出码 1 = 任何一条失败。
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR, OUT = process.env.OUT;
if (!WEB || !OUT) throw new Error('need WEB_DIR OUT');
mkdirSync(OUT, { recursive: true });

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ttf': 'font/ttf', '.json': 'application/json', '.ico': 'image/x-icon' };
const web = createServer((req, res) => {
  let p = join(WEB, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!existsSync(p) || statSync(p).isDirectory()) p = join(WEB, 'index.html');
  res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' });
  res.end(readFileSync(p));
}).listen(0, '127.0.0.1');
await new Promise(r => web.once('listening', r));
const WEB_URL = `http://127.0.0.1:${web.address().port}/`;
const ALIAS = '示例-A';
// 1×1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

const initScript = ({ theme }) => {
  const HUB = 'http://mock-hub.invalid';
  const iso = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();
  const profile = { serverUrl: HUB, token: 'placeholder-token', username: 'tester', profileId: 'p-plussend', displayName: 'tester', networkId: 'net-demo' };
  const creds = { appId: '', accessToken: 'placeholder-api-key-0000', endpoint: 'http://127.0.0.1:1/flash' };
  const sessions = [{ alias: '示例-A', status: 'idle', agent: 'claude-code', runtime: 'agent-node', node_id: 'n_demo_a', hostname: 'host-a', project_dir: '/work/demo-a', version: '0.0.0', updated_at: iso(1) }];
  try { localStorage.setItem('voice_composer_input_mode_v1', 'keyboard'); } catch {}
  window.__posts = [];
  let uploads = 0;
  const route = (url, method) => {
    const p = new URL(url).pathname;
    const ok = (body) => ({ status: 200, body });
    if (p === '/api/upload' && method === 'POST') { uploads++; return ok({ ok: true, file_id: `f_demo_${uploads}`, path: `/uploads/f_demo_${uploads}.png`, url: `/api/files/f_demo_${uploads}`, size: 68, mime: 'image/png' }); }
    if (p === '/api/task' && method === 'POST') return ok({ ok: true, task_id: `t_demo_${Date.now()}` });
    if (p === '/api/auth/me') return ok({ ok: true, user: { username: 'tester' }, current_network: 'net-demo', networks: [{ network_id: 'net-demo', name: 'demo' }] });
    if (p === '/api/status') return ok({ ok: true, sessions, files_capable: true });
    if (p === '/api/nodes') return ok({ ok: true, nodes: [], count: 0 });
    if (p === '/api/tasks') return ok({ ok: true, tasks: [] });
    if (p === '/api/messages') return ok({ ok: true, messages: [], unread: 0, pending_count: 0 });
    if (p === '/api/side-threads/capability') return ok({ ok: true, supported: false });
    if (p.startsWith('/api/events')) return { status: 404, body: { ok: false } };
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
        case 'load_voice_credentials': return JSON.stringify(creds);
        case 'read_desktop_profile_file': return null;
        case 'get_theme_preference': return theme;
        case 'plugin:event|listen': return 0;
        case 'plugin:http|fetch': { const id = ++rid; reqs.set(id, args.clientConfig); return id; }
        case 'plugin:http|fetch_send': {
          const c = reqs.get(args.rid);
          const method = c.method || 'GET';
          if (method === 'POST') {
            let body = '';
            try { body = c.data ? new TextDecoder().decode(new Uint8Array(c.data)) : ''; } catch {}
            window.__posts.push({ path: new URL(c.url).pathname, body });
          }
          const r = route(c.url, method);
          const buf = new TextEncoder().encode(JSON.stringify(r.body));
          const id = ++rid; bodies.set(id, { buf, sent: false });
          return { status: r.status, statusText: 'OK', url: c.url, headers: [['content-type', 'application/json']], rid: id };
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

const findExe = () => {
  const base = `${process.env.HOME}/.cache/ms-playwright`;
  for (const d of ['chromium-1234', 'chromium-1217', 'chromium-1208']) for (const p of [`${base}/${d}/chrome-linux64/chrome`, `${base}/${d}/chrome-linux/chrome`]) if (existsSync(p)) return p;
  return undefined;
};
const browser = await chromium.launch({ headless: true, executablePath: findExe() });
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel Fold) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

let failures = 0, total = 0;
const ck = (tag, name, cond, detail = '') => { total++; if (!cond) failures++; console.log(`${cond ? 'PASS' : 'FAIL'} [${tag}] ${name}${detail ? ` — ${detail}` : ''}`); };
const r1 = (n) => Math.round(n * 10) / 10;
const rows = [];
const shots = [];

const geom = (page, input) => page.evaluate((input) => {
  const q = (s) => document.querySelector(s);
  const b = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom, cy: r.y + r.height / 2 }; };
  const plus = q('[data-testid="composer-plus"]'), send = q('[data-testid="composer-send"]'), field = q(input), toggle = q('[data-testid="composer-mode-toggle"]');
  let row = plus?.parentElement; while (row && !(row.contains(field) && row.contains(plus))) row = row.parentElement;
  return { plus: b(plus), send: b(send), field: b(field), toggle: b(toggle), row: b(row), sendReveal: b(q('[data-testid="composer-send-reveal"]')) };
}, input);
// 在页面里逐帧记录 发送 外层宽度,300ms。
const sampleRevealWidths = (page) => page.evaluate(() => new Promise(resolve => {
  const out = []; const t0 = performance.now();
  const tick = () => { const el = document.querySelector('[data-testid="composer-send-reveal"]'); out.push(el ? Math.round(el.getBoundingClientRect().width * 10) / 10 : 0); if (performance.now() - t0 < 300) requestAnimationFrame(tick); else resolve(out); };
  requestAnimationFrame(tick);
}));

const CASES = [
  { tag: 'phone-390x844', viewport: { width: 390, height: 844 }, ua: ANDROID_UA, sim: '32,0,24,0' },
  { tag: 'foldable-1000x700', viewport: { width: 1000, height: 700 }, ua: ANDROID_UA, sim: '32,0,24,0' },
];
for (const c of CASES) {
  const tag = c.tag;
  const ctx = await browser.newContext({ viewport: c.viewport, colorScheme: 'light', userAgent: c.ua, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGEERROR', e.message.split('\n')[0]));
  await page.addInitScript(initScript, { theme: 'light' });
  await page.goto(`${WEB_URL}?safeAreaSim=${c.sim}`);
  await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 20000 });
  await page.evaluate((a) => window.__anetLayoutSweep.setScreen({ name: 'chat', alias: a }), ALIAS);
  const inputSel = `textarea[placeholder="Message ${ALIAS}…"]`;
  const input = page.locator(inputSel);
  await input.waitFor({ timeout: 15000 });
  await page.waitForTimeout(400);
  const shot = async (name) => { const f = `${OUT}/plussend-${tag}-${name}.png`; await page.screenshot({ path: f }); shots.push(f); };
  const has = async (id) => (await page.locator(`[data-testid="${id}"]`).count()) > 0;

  // 1 空
  ck(tag, '空:只有 ＋,没有 发送', await has('composer-plus') && !(await has('composer-send')));
  await shot('1-empty');

  // 2 打字 + 动画
  await input.click();
  const sampling = sampleRevealWidths(page);
  await page.keyboard.type('看下这张图');
  const widths = await sampling;
  await page.waitForTimeout(300);
  const g = await geom(page, inputSel);
  const full = g.sendReveal?.w ?? 0;
  const mids = widths.filter(w => w > 0.5 && w < full - 0.5);
  ck(tag, '打字后:＋ 还在,发送 在 ＋ 右边', g.plus && g.send && g.send.x >= g.plus.r, `plus.r=${g.plus && r1(g.plus.r)} send.x=${g.send && r1(g.send.x)}`);
  ck(tag, '发送 是动画出现的(宽度逐帧有中间值)', mids.length >= 2 && full > 40, `full=${r1(full)} mids=${mids.slice(0, 5).join(',')}…(${mids.length})`);
  {
    const dPlus = g.plus.cy - g.field.cy, dSend = g.send.cy - g.field.cy;
    const gapFP = g.plus.x - g.field.r, gapPS = g.send.x - g.plus.r;
    const padL = (g.toggle ?? g.field).x - g.row.x, padR = g.row.r - g.send.r;
    rows.push({ tag, state: 'text', fieldR: r1(g.field.r), plusX: r1(g.plus.x), plusR: r1(g.plus.r), sendX: r1(g.send.x), sendR: r1(g.send.r), dCyPlus: r1(dPlus), dCySend: r1(dSend), gapFieldPlus: r1(gapFP), gapPlusSend: r1(gapPS), padL: r1(padL), padR: r1(padR) });
    ck(tag, '＋ / 发送 与输入框同一中线(≤1px)', Math.abs(dPlus) <= 1 && Math.abs(dSend) <= 1, `${r1(dPlus)}/${r1(dSend)}`);
    ck(tag, '输入框→＋ 间距 = ＋→发送 间距(≤1px)', Math.abs(gapFP - gapPS) <= 1, `${r1(gapFP)}/${r1(gapPS)}`);
    ck(tag, '右内边距 = 左内边距(≤1px)', Math.abs(padL - padR) <= 1, `${r1(padL)}/${r1(padR)}`);
    ck(tag, '＋ 与 发送 同高', Math.abs(g.plus.h - g.send.h) <= 1, `${r1(g.plus.h)}/${r1(g.send.h)}`);
    // 正控:间距判据喂一个右移 2px 的 发送 必须报红。
    const shifted = await page.evaluate(() => { const el = document.querySelector('[data-testid="composer-send"]'); el.style.marginRight = '-2px'; const x = el.getBoundingClientRect().x; el.style.marginRight = ''; return x; });
    ck(tag, '正控:发送 右移 2px 时间距判据会报红', Math.abs(gapFP - (shifted - g.plus.r)) > 1, `gap=${r1(shifted - g.plus.r)}`);
  }
  await shot('2-text');

  // 4 有字时 ＋ → 相册 → 选图
  await page.locator('[data-testid="composer-plus"]').click();
  await page.getByText('相册', { exact: true }).first().waitFor({ timeout: 3000 });
  await shot('3-plus-panel-with-text');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 5000 }), page.getByText('相册', { exact: true }).first().click()]);
  await chooser.setFiles({ name: 'demo.png', mimeType: 'image/png', buffer: PNG });
  await page.waitForTimeout(800);
  ck(tag, '选图后:文字还在', (await input.inputValue()) === '看下这张图', await input.inputValue());
  ck(tag, '选图后:＋ 和 发送 都在', await has('composer-plus') && await has('composer-send'));
  const imgs = await page.evaluate(() => document.querySelectorAll('img').length);
  await shot('4-text-and-image');

  // 5 发送
  await page.evaluate(() => { window.__posts = []; });
  await page.locator('[data-testid="composer-send"]').click();
  await page.waitForFunction(() => window.__posts.some(p => p.path === '/api/task'), null, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);
  const posts = await page.evaluate(() => window.__posts);
  const uploads = posts.filter(p => p.path === '/api/upload');
  const tasks = posts.filter(p => p.path === '/api/task');
  let body = null; try { body = JSON.parse(tasks[0]?.body || 'null'); } catch {}
  const order = posts.map(p => p.path).filter(p => p === '/api/upload' || p === '/api/task').join(' → ');
  ck(tag, '发送:先传图,再一条消息(图文同一条)', uploads.length === 1 && tasks.length === 1 && order === '/api/upload → /api/task', order);
  ck(tag, '那条消息:正文含文字、attachments 1 个', !!body && typeof body.task === 'string' && body.task.startsWith('看下这张图') && Array.isArray(body.attachments) && body.attachments.length === 1, body ? `task=${JSON.stringify(body.task).slice(0, 60)} attachments=${body.attachments?.length}` : 'no body');
  ck(tag, '发送后:草稿清空,只剩 ＋', (await input.inputValue()) === '' && await has('composer-plus'), `imgs before send=${imgs}`);
  await page.waitForTimeout(400);
  ck(tag, '发送后 发送 收起', !(await has('composer-send')));

  // 6 只有图
  await page.locator('[data-testid="composer-plus"]').click();
  const [ch2] = await Promise.all([page.waitForEvent('filechooser', { timeout: 5000 }), page.getByText('相册', { exact: true }).first().click()]);
  await ch2.setFiles({ name: 'only.png', mimeType: 'image/png', buffer: PNG });
  await page.waitForTimeout(800);
  ck(tag, '只有图没有字:＋ 和 发送 都在', (await input.inputValue()) === '' && await has('composer-plus') && await has('composer-send'));
  await shot('5-image-only');
  await page.locator('[data-testid="composer-send"]').click();
  await page.waitForTimeout(800);

  // 7 清空文字 → 发送 动画消失
  await input.click();
  await page.keyboard.type('x');
  await page.waitForTimeout(400);
  const outSampling = sampleRevealWidths(page);
  await page.keyboard.press('Backspace');
  const outWidths = await outSampling;
  await page.waitForTimeout(300);
  const outMids = outWidths.filter(w => w > 0.5 && w < full - 0.5);
  ck(tag, '清空文字:发送 动画收起(逐帧有中间值),最后只剩 ＋', outMids.length >= 2 && !(await has('composer-send')) && await has('composer-plus'), `mids=${outMids.length}`);
  await ctx.close();
}

// 桌面(#438 工具栏输入区):只验证没被波及
{
  const tag = 'desktop-1200x850';
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 850 }, colorScheme: 'light' });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGEERROR', e.message.split('\n')[0]));
  await page.addInitScript(initScript, { theme: 'light' });
  // 没有 safeAreaSim(它会把布局当安卓 → 双栏),所以不走 __anetLayoutSweep,直接点会话列表。
  await page.goto(WEB_URL);
  await page.getByText(ALIAS, { exact: true }).first().click({ timeout: 20000 });
  const input = page.locator(`textarea[placeholder="Message ${ALIAS}…"]`);
  await input.waitFor({ timeout: 15000 });
  await input.click();
  await page.keyboard.type('桌面');
  await page.waitForTimeout(300);
  // 「发送」文字在 ≠ 看得见(title-blank:flex 0 1 0% + overflow:hidden 把字压成 0px 宽,textContent 照旧):
  // 同一批元素再量画出来的宽 = 框 ∩ 每个 overflow 不是 visible 的祖先。
  const s = await page.evaluate(() => {
    const clippedW = (el) => {
      const b = el.getBoundingClientRect(); let w = b.width, h = b.height;
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
        const r = a.getBoundingClientRect();
        w = Math.min(w, Math.max(0, Math.min(b.right, r.right) - Math.max(b.left, r.left)));
        h = Math.min(h, Math.max(0, Math.min(b.bottom, r.bottom) - Math.max(b.top, r.top)));
      }
      return h >= 1 ? Math.round(w * 10) / 10 : 0;
    };
    const labels = [...document.querySelectorAll('div,span')].filter(e => e.childElementCount === 0 && e.textContent === '发送');
    return { mobileSlot: document.querySelectorAll('[data-testid="composer-right-slot"]').length, send: labels.length, sendPaintedW: labels.map(clippedW) };
  });
  ck(tag, '桌面:没有手机右格(＋/发送 组件),工具栏 发送 还在', s.mobileSlot === 0 && s.send >= 1 && s.sendPaintedW.some(w => w >= 8), JSON.stringify(s));
  await page.evaluate(() => { window.__posts = []; });
  await page.getByText('发送', { exact: true }).last().click();
  await page.waitForTimeout(600);
  const tasks = await page.evaluate(() => window.__posts.filter(p => p.path === '/api/task').length);
  ck(tag, '桌面:工具栏 发送 照常发出', tasks === 1, `tasks=${tasks}`);
  const f = `${OUT}/plussend-${tag}.png`; await page.screenshot({ path: f }); shots.push(f);
  await ctx.close();
}
await browser.close(); web.close();

const cols = ['tag', 'state', 'fieldR', 'plusX', 'plusR', 'sendX', 'sendR', 'dCyPlus', 'dCySend', 'gapFieldPlus', 'gapPlusSend', 'padL', 'padR'];
console.log(`\n| ${cols.join(' | ')} |\n|${cols.map(() => '---').join('|')}|`);
for (const r of rows) console.log(`| ${cols.map(c => r[c]).join(' | ')} |`);
console.log(`\nscreenshots:\n${shots.join('\n')}`);
console.log(`\n${total - failures}/${total} passed`);
process.exit(failures ? 1 : 0);
