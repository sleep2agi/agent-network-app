// 手机「按住 说话」浮层(admin 2026-11-24 改豆包式)—— 真应用(expo web 导出 + Tauri 桥桩)端到端 + 量尺寸。不进 CI:要 Playwright + Chromium。
//
//   WEB_DIR=<expo export 目录> OUT=<截图目录> [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] \
//   node tests/test-voice-hold-overlay/drive.mjs
//
// 没有 hub 进程、没有端口、不碰 HOME:hub 和极速版识别都由页内的 Tauri http 桩回答(占位数据,别名 示例-A)。
// 电平 / 流式中间结果由 ?voiceSim=1 的页面钩子喂(src/voice-sim.ts;网页上没有流式识别)。
// 390×844 + 安卓 UA + safeAreaSim 32/0/24/0 = 手机单栏,起始就是语音模式。亮 / 暗各跑一遍。
//
// 断言:
//   1 按住:全屏压暗、晴蓝气泡(电平条随喂的电平变化、秒数、流式文字)、✕ / 文 两个圈、弧形面板「松开 转文字」
//   2 几何:气泡水平居中 ≤1px;✕ / 文 关于中线对称 ≤1px(且同高);弧形面板满宽、贴底,面板内容在底部安全区之上
//   3 滑到 文:高亮 + 「松开 放进草稿」;滑到 ✕:变红放大 + 「松开手指，取消」;滞回(出圈 hitEnter+10 仍在区里)
//   4 松手结果:✕ = 丢弃(草稿不变);文 = 进草稿、不发送;中间 = 现状(进草稿、不发送)
//   5 气泡里的流式文字 ≤3 行,再多在气泡里滚到最新
//   6 太短 → 屏幕中间「说话时间太短」;识别报错 → 输入区提示;麦克风被拒 → 输入区提示,浮层收起
//   7 减弱动态效果:气泡不做缩放淡入 —— 从按下起记下气泡的每一个样式,没有任何中间值(只有挂上那一刻的 0/0.8 和
//     完整的 1/1),最后是完整大小(开着动画时 150ms 里有约 20 个中间值)
// 退出码 1 = 任何一条失败。
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { paintedText } from '../test-layout-sweep/harness.mjs';

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
const INSETS = { top: 32, right: 0, bottom: 24, left: 0 };

// 页内:hub + 极速版识别的桩。window.__flash = { text, fail } 决定下一次识别的回答;发往 hub 的 POST 记进 window.__posts。
const initScript = ({ theme, denyMic }) => {
  const HUB = 'http://mock-hub.invalid';
  const FLASH = 'http://127.0.0.1:1/flash';
  const now = Date.now();
  const iso = (minAgo) => new Date(now - minAgo * 60000).toISOString();
  const profile = { serverUrl: HUB, token: 'placeholder-token', username: 'tester', profileId: 'p-holdoverlay', displayName: 'tester', networkId: 'net-demo' };
  const creds = { appId: '', accessToken: 'placeholder-api-key-0000', endpoint: FLASH };
  const sessions = [{ alias: '示例-A', status: 'idle', agent: 'claude-code', runtime: 'agent-node', node_id: 'n_demo_a', hostname: 'host-a', project_dir: '/work/demo-a', version: '0.0.0', updated_at: iso(1) }];
  try { localStorage.setItem('voice_composer_input_mode_v1', 'voice'); } catch {}
  window.__flash = { text: '', fail: false };
  window.__posts = [];
  if (denyMic) {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
  }
  const route = (url) => {
    const u = new URL(url);
    const p = u.pathname;
    if (u.host === '127.0.0.1:1') {
      if (window.__flash.fail) return { status: 429, headers: [], body: {} };
      return { status: 200, headers: [['X-Api-Status-Code', '20000000']], body: { result: { text: window.__flash.text } } };
    }
    const ok = (body) => ({ status: 200, headers: [['content-type', 'application/json']], body });
    if (p === '/api/auth/me') return ok({ ok: true, user: { username: 'tester' }, current_network: 'net-demo', networks: [{ network_id: 'net-demo', name: 'demo' }] });
    if (p === '/api/status') return ok({ ok: true, sessions, files_capable: true });
    if (p === '/api/nodes') return ok({ ok: true, nodes: [], count: 0 });
    if (p === '/api/tasks') return ok({ ok: true, tasks: [] });
    if (p === '/api/messages') return ok({ ok: true, messages: [], unread: 0, pending_count: 0 });
    if (p === '/api/side-threads/capability') return ok({ ok: true, supported: false });
    if (p.startsWith('/api/events')) return { status: 404, headers: [], body: { ok: false } };
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
          if (c.method === 'POST' && !String(c.url).startsWith(FLASH)) {
            try { window.__posts.push({ url: c.url, body: c.data ? new TextDecoder().decode(new Uint8Array(c.data)) : '' }); } catch {}
          }
          const r = route(c.url);
          const buf = new TextEncoder().encode(JSON.stringify(r.body));
          const id = ++rid; bodies.set(id, { buf, sent: false });
          return { status: r.status, statusText: 'OK', url: c.url, headers: r.headers, rid: id };
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
const browser = await chromium.launch({ headless: true, executablePath: findExe(), args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

let failures = 0;
let total = 0;
const ck = (tag, name, cond, detail = '') => {
  total++;
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'} [${tag}] ${name}${detail ? ` — ${detail}` : ''}`);
};
const r1 = (n) => Math.round(n * 10) / 10;
const rows = [];
const shots = [];
// 文字对 ≠ 看得见:title-blank 那次 textContent 一直对,元素却被 flex 0 1 0% + overflow:hidden 压成 0px 宽。
// 文字判据旁边再量同一个元素画出来的框(被 overflow 祖先裁剪后 ≥ 8px 宽)。
const painted = (page, id, text) => paintedText(page, `[data-testid="${id}"]`, text);
const seen = (p) => !!p?.painted && p.w >= 8;
const pd = (p) => p ? `${r1(p.w)}×${r1(p.h)}${p.painted ? '' : ' UNPAINTED'}` : 'not rendered';

const open = async (scheme, extra = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme, userAgent: ANDROID_UA, permissions: ['microphone'], deviceScaleFactor: 2, ...extra.context });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGEERROR', e.message.split('\n')[0]));
  await page.addInitScript(initScript, { theme: scheme, denyMic: !!extra.denyMic });
  await page.goto(`${WEB_URL}?safeAreaSim=${INSETS.top},${INSETS.right},${INSETS.bottom},${INSETS.left}&voiceSim=1`);
  await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 20000 });
  await page.evaluate((a) => window.__anetLayoutSweep.setScreen({ name: 'chat', alias: a }), ALIAS);
  await page.locator('[data-testid="voice-hold-bar"]').waitFor({ timeout: 15000 });
  await page.waitForTimeout(300);
  return { ctx, page };
};
const box = (page, id) => page.evaluate((id) => {
  const el = document.querySelector(`[data-testid="${id}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
}, id);
const zone = (page) => page.evaluate(() => document.querySelector('[data-testid="voice-overlay"]')?.getAttribute('data-zone') ?? null);
const label = (page) => page.evaluate(() => document.querySelector('[data-testid="voice-hold-label"]')?.textContent ?? null);
const bg = (page, sel) => page.evaluate((sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).backgroundColor : null; }, sel);
// 录音中持续喂电平(正弦 + 抖动,和说话的起伏差不多)。
const startLevels = (page) => page.evaluate(() => {
  let k = 0;
  window.__levelTimer = setInterval(() => { k++; window.__anetVoiceSim.level(0.08 + 0.5 * Math.abs(Math.sin(k / 2.3)) * (0.6 + 0.4 * Math.sin(k * 1.7))); }, 100);
});
const stopLevels = (page) => page.evaluate(() => clearInterval(window.__levelTimer));
const barHeights = (page) => page.evaluate(() => [...document.querySelectorAll('[data-testid="voice-hold-bars"] > div')].map(d => Math.round(d.getBoundingClientRect().height * 10) / 10));
const press = async (page) => {
  const b = await box(page, 'voice-hold-bar');
  await page.mouse.move(b.cx, b.cy);
  await page.mouse.down();
  await page.waitForSelector('[data-testid="voice-overlay"]', { timeout: 5000 });
  return b;
};
// 分步滑过去(真手指是连续的 move 事件)。
const slide = async (page, from, to, steps = 12) => {
  for (let i = 1; i <= steps; i++) await page.mouse.move(from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps);
  await page.waitForTimeout(250);
};
const releaseAndSettle = async (page) => {
  await page.mouse.up();
  await page.waitForFunction(() => !document.querySelector('[data-testid="voice-overlay"]'), null, { timeout: 10000 });
  await page.waitForTimeout(400);
};
const draft = (page) => page.evaluate(() => document.querySelector('[data-testid="voice-draft-card-text"]')?.value ?? null);
const notice = (page) => page.evaluate(() => document.querySelector('[data-testid="composer-notice"]')?.textContent ?? null);
const sendPosts = (page) => page.evaluate(() => window.__posts.filter(p => /\/api\/(send|tasks?|messages)\b/.test(new URL(p.url).pathname)).length);

// admin 2026-11-24「学豆包」:不压暗、底部蓝色光晕 + 细波形 + 一行「松手发送，上移取消」;流式文字是右侧蓝色气泡;
// 输入框为空时中间松手 = 直接发出去;输入框已有字 = 插进草稿;上移过线 = 取消(变红)。
const hubPosts = (page) => page.evaluate(() => window.__posts.filter(p => { try { return /\/api\/(send|tasks?|messages)\b/.test(new URL(p.url).pathname); } catch { return false; } }).map(p => p.body));
for (const scheme of ['light', 'dark']) {
  const tag = `phone-390x844-${scheme}`;
  const { ctx, page } = await open(scheme);
  const shot = async (name) => { const f = `${OUT}/holdoverlay-${tag}-${name}.png`; await page.screenshot({ path: f }); shots.push(f); };
  await shot('0-idle');

  // ── 1 按住:光晕 + 波形 + 文案 + 流式气泡,不压暗 ──
  await startLevels(page);
  await press(page);
  await page.evaluate(() => window.__anetVoiceSim.partial('帮我创建一个定时任务，每早整理行业新闻'));
  await page.waitForTimeout(1300);
  const wrapBg = await bg(page, '[data-testid="voice-overlay"]');
  ck(tag, '不压暗聊天(浮层根透明)', !wrapBg || wrapBg === 'rgba(0, 0, 0, 0)', wrapBg);
  ck(tag, '底部有光晕', !!(await box(page, 'voice-hold-glow')));
  ck(tag, '文案「松手发送，上移取消」(输入框为空)', (await label(page)) === '松手发送，上移取消', await label(page));
  const hA = await barHeights(page); await page.waitForTimeout(350); const hB = await barHeights(page);
  ck(tag, '41 根细波形随电平跳动', hA.length === 41 && hA.join() !== hB.join(), `${hA.length} bars`);
  const imP = await painted(page, 'voice-interim');
  ck(tag, '流式文字在蓝色气泡里', seen(imP), pd(imP));
  const bub = await box(page, 'voice-hold-bubble');
  ck(tag, '气泡靠右(像自己发的消息)', !!bub && bub.r > 390 - 40, bub && `right ${r1(bub.r)}`);
  ck(tag, '不再有 ✕ / 文 两个圈', !(await box(page, 'voice-hold-cancel')) && !(await box(page, 'voice-hold-totext')));
  await shot('1-holding');

  // ── 2 上移取消 ──
  const bar = await box(page, 'voice-hold-bar');
  await slide(page, { x: bar.cx, y: bar.cy }, { x: bar.cx, y: bar.cy - 260 });
  ck(tag, '上移过线 → 取消区、文案「松开手指，取消」', (await zone(page)) === 'cancel' && (await label(page)) === '松开手指，取消', `${await zone(page)} / ${await label(page)}`);
  await shot('2-cancel');
  const before = (await hubPosts(page)).length;
  await releaseAndSettle(page);
  ck(tag, '取消区松手:什么都不发', (await hubPosts(page)).length === before);

  // ── 3 中间松手 = 直接发送 ──
  await page.evaluate(() => { window.__flash = { text: '帮我建个每早八点的定时任务', fail: false }; });
  await press(page);
  await page.waitForTimeout(1200);
  await releaseAndSettle(page);
  await page.waitForTimeout(800);
  const posts = await hubPosts(page);
  ck(tag, '输入框为空、中间松手 → 识别完直接发出去', posts.some(b => b.includes('帮我建个每早八点的定时任务')), `${posts.length} posts`);
  ck(tag, '发送后输入框仍为空(没塞进草稿)', !((await draft(page)) ?? '').trim(), JSON.stringify(await draft(page)));
  await shot('3-sent');

  // ── 4 输入框已有字 → 插进草稿,不发送 ──
  // 输入框先有字:切到键盘模式写半句,再切回语音模式(语音模式下草稿卡片只在有字时出现)。
  await page.locator('[data-testid="composer-mode-toggle"]').click();
  await page.locator('textarea').first().fill('先写一半，');
  await page.locator('[data-testid="composer-mode-toggle"]').click();
  await page.locator('[data-testid="voice-hold-bar"]').waitFor({ timeout: 5000 });
  await page.waitForTimeout(300);
  if (((await draft(page)) ?? '').trim()) {
    await page.evaluate(() => { window.__flash = { text: '再补一句', fail: false }; });
    const n0 = (await hubPosts(page)).length;
    await press(page);
    ck(tag, '已有字时文案「松手转文字，上移取消」', (await label(page)) === '松手转文字，上移取消', await label(page));
    await page.waitForTimeout(1200);
    await releaseAndSettle(page);
    ck(tag, '已有字时松手 → 进草稿、不发送', ((await draft(page)) ?? '').includes('再补一句') && (await hubPosts(page)).length === n0, JSON.stringify(await draft(page)));
  } else ck(tag, '能往草稿卡片写字(前置)', false, 'draft card not editable');

  // ── 5 太短 ──
  await page.locator('[data-testid="composer-mode-toggle"]').click(); await page.locator('textarea').first().fill(''); await page.locator('[data-testid="composer-mode-toggle"]').click(); await page.waitForTimeout(300);
  await press(page);
  await page.mouse.up();
  await page.waitForSelector('[data-testid="voice-hold-toast"]', { timeout: 3000 }).then(() => ck(tag, '太短 → 「说话时间太短」', true), () => ck(tag, '太短 → 「说话时间太短」', false));
  await stopLevels(page);
  await ctx.close();
}
await browser.close(); web.close();
console.log(`\nscreenshots:\n${shots.join('\n')}`);
console.log(`\n${total - failures}/${total} passed`);
process.exit(failures ? 1 : 0);
