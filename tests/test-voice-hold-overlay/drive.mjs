// 手机「按住 说话」微信式浮层 —— 真应用(expo web 导出 + Tauri 桥桩)端到端 + 量尺寸。不进 CI:要 Playwright + Chromium。
//
//   WEB_DIR=<expo export 目录> OUT=<截图目录> [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] \
//   node tests/test-voice-hold-overlay/drive.mjs
//
// 没有 hub 进程、没有端口、不碰 HOME:hub 和极速版识别都由页内的 Tauri http 桩回答(占位数据,别名 示例-A)。
// 电平 / 流式中间结果由 ?voiceSim=1 的页面钩子喂(src/voice-sim.ts;网页上没有流式识别)。
// 390×844 + 安卓 UA + safeAreaSim 32/0/24/0 = 手机单栏,起始就是语音模式。亮 / 暗各跑一遍。
//
// 断言:
//   1 按住:全屏压暗、绿色气泡(电平条随喂的电平变化、秒数、流式文字)、✕ / 文 两个圈、弧形面板「松开 转文字」
//   2 几何:气泡水平居中 ≤1px;✕ / 文 关于中线对称 ≤1px(且同高);弧形面板满宽、贴底,面板内容在底部安全区之上
//   3 滑到 文:高亮 + 「松开 放进草稿」;滑到 ✕:变红放大 + 「松开手指，取消」;滞回(出圈 hitEnter+10 仍在区里)
//   4 松手结果:✕ = 丢弃(草稿不变);文 = 进草稿、不发送;中间 = 现状(进草稿、不发送)
//   5 气泡里的流式文字 ≤3 行,再多在气泡里滚到最新
//   6 太短 → 屏幕中间「说话时间太短」;识别报错 → 输入区提示;麦克风被拒 → 输入区提示,浮层收起
//   7 减弱动态效果:气泡一出现就是完整大小(不缩放)
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

for (const scheme of ['light', 'dark']) {
  const tag = `phone-390x844-${scheme}`;
  const { ctx, page } = await open(scheme);
  const shot = async (name) => { const f = `${OUT}/holdoverlay-${tag}-${name}.png`; await page.screenshot({ path: f }); shots.push(f); };

  // ── 1 按住:中间区 ──
  await startLevels(page);
  const bar = await press(page);
  await page.evaluate(() => window.__anetVoiceSim.partial('帮我看一下昨天的构建'));
  await page.waitForTimeout(1300);
  const hA = await barHeights(page);
  await page.waitForTimeout(350);
  const hB = await barHeights(page);
  ck(tag, '电平条随输入电平变化(两次采样不同、高低不齐)', hA.length === 21 && hA.join() !== hB.join() && Math.max(...hB) - Math.min(...hB) > 3, `${hA.length} bars, range ${r1(Math.min(...hB))}–${r1(Math.max(...hB))}`);
  const elP = await painted(page, 'voice-elapsed');
  ck(tag, '秒数在走(≥ 00:01)', /^00:0[1-9]$/.test(await page.evaluate(() => document.querySelector('[data-testid="voice-elapsed"]')?.textContent ?? '')) && seen(elP), `painted ${pd(elP)}`);
  const imP = await painted(page, 'voice-interim');
  ck(tag, '气泡里显示流式文字', (await page.evaluate(() => document.querySelector('[data-testid="voice-interim"]')?.textContent)) === '帮我看一下昨天的构建' && seen(imP), `painted ${pd(imP)}`);
  const lbN = await painted(page, 'voice-hold-label');
  ck(tag, '中间区:「松开 转文字」、zone=neutral', (await label(page)) === '松开 转文字' && (await zone(page)) === 'neutral' && seen(lbN), `${await label(page)} / ${await zone(page)} / painted ${pd(lbN)}`);
  const dim = await bg(page, '[data-testid="voice-overlay"]');
  ck(tag, '全屏压暗 50% 黑', dim === 'rgba(0, 0, 0, 0.5)', dim);
  const bubbleBg = await bg(page, '[data-testid="voice-hold-bubble"] > div');
  ck(tag, '气泡是绿色(亮 #95ec69 / 暗 #3eb575)', bubbleBg === (scheme === 'light' ? 'rgb(149, 236, 105)' : 'rgb(62, 181, 117)'), bubbleBg);

  // ── 2 几何 ──
  const pane = await box(page, 'chat-pane');
  const ov = await box(page, 'voice-overlay');
  const bub = await box(page, 'voice-hold-bubble');
  const cx = await box(page, 'voice-hold-cancel');
  const tx = await box(page, 'voice-hold-totext');
  const arc = await box(page, 'voice-hold-arc');
  const arcContent = await box(page, 'voice-hold-arc-content');
  const vh = 844;
  {
    const centre = ov.x + ov.w / 2;
    const dBubble = bub.cx - centre;
    const dCancel = centre - cx.cx, dText = tx.cx - centre;
    rows.push({ scheme, state: 'neutral', overlayW: r1(ov.w), overlayCx: r1(centre), bubbleCx: r1(bub.cx), dBubble: r1(dBubble), cancelCx: r1(cx.cx), textCx: r1(tx.cx), symL: r1(dCancel), symR: r1(dText), dCircleCy: r1(tx.cy - cx.cy), arcX: r1(arc.x), arcW: r1(arc.w), arcBottom: r1(arc.b), arcContentBottom: r1(arcContent.b), safeBottom: vh - INSETS.bottom });
    ck(tag, '浮层铺满聊天页(和 chat-pane 同框)', Math.abs(ov.x - pane.x) <= 0.5 && Math.abs(ov.w - pane.w) <= 0.5 && Math.abs(ov.y - pane.y) <= 0.5 && Math.abs(ov.h - pane.h) <= 0.5, `${r1(ov.x)},${r1(ov.y)} ${r1(ov.w)}×${r1(ov.h)}`);
    ck(tag, '气泡水平居中(≤1px)', Math.abs(dBubble) <= 1, `d=${r1(dBubble)}`);
    ck(tag, '✕ / 文 关于中线对称(≤1px)且同高', Math.abs(dCancel - dText) <= 1 && Math.abs(tx.cy - cx.cy) <= 1 && Math.abs(cx.w - tx.w) <= 1, `${r1(dCancel)}/${r1(dText)} dy=${r1(tx.cy - cx.cy)}`);
    ck(tag, '弧形面板满宽、贴到屏幕底', Math.abs(arc.x) <= 0.5 && Math.abs(arc.w - 390) <= 0.5 && Math.abs(arc.b - vh) <= 0.5, `${r1(arc.x)} ${r1(arc.w)} bottom=${r1(arc.b)}`);
    ck(tag, `面板内容在底部安全区(${INSETS.bottom}px)之上`, arcContent.b <= vh - INSETS.bottom + 0.5, `content.bottom=${r1(arcContent.b)}`);
    ck(tag, '面板盖住原来的大条', arc.y <= bar.y && arc.b >= bar.b, `arc.top=${r1(arc.y)} bar=${r1(bar.y)}–${r1(bar.b)}`);
    ck(tag, '气泡 < 圈 < 文案 < 面板(自上而下不重叠)', bub.b <= cx.y && cx.b <= arc.y);
    // 正控:同一个居中判据喂一个右移 2px 的气泡必须报红。
    const shifted = await page.evaluate(() => { const el = document.querySelector('[data-testid="voice-hold-bubble"]'); const old = el.style.marginLeft; el.style.marginLeft = '2px'; const r = el.getBoundingClientRect(); el.style.marginLeft = old; return r.x + r.width / 2; });
    ck(tag, '正控:气泡右移 2px 时居中判据会报红', Math.abs(shifted - centre) > 1, `d=${r1(shifted - centre)}`);
  }
  await shot('1-neutral');

  // ── 3 滑到 文 / ✕ + 滞回 ──
  const start = { x: bar.cx, y: bar.cy };
  await slide(page, start, { x: tx.cx, y: tx.cy });
  const txOn = await box(page, 'voice-hold-totext');
  const lbT = await painted(page, 'voice-hold-label');
  ck(tag, '滑到 文:zone=toText、「松开 放进草稿」、圈高亮放大', (await zone(page)) === 'toText' && (await label(page)) === '松开 放进草稿' && seen(lbT) && txOn.w > tx.w + 10, `${await zone(page)} / ${await label(page)} / ${r1(tx.w)}→${r1(txOn.w)} / painted ${pd(lbT)}`);
  await shot('2-totext');
  await slide(page, { x: tx.cx, y: tx.cy }, { x: cx.cx, y: cx.cy }, 16);
  const cxOn = await box(page, 'voice-hold-cancel');
  const cancelBg = await bg(page, '[data-testid="voice-hold-cancel"]');
  const bubbleCancelBg = await bg(page, '[data-testid="voice-hold-bubble"] > div');
  const lbC = await painted(page, 'voice-hold-label');
  ck(tag, '滑到 ✕:zone=cancel、「松开手指，取消」', (await zone(page)) === 'cancel' && (await label(page)) === '松开手指，取消' && seen(lbC), `painted ${pd(lbC)}`);
  ck(tag, '✕ 变红放大、气泡变红', cancelBg === 'rgb(229, 72, 77)' && cxOn.w > cx.w + 10 && /^rgb\((220|239), (38|68), (38|68)\)$/.test(bubbleCancelBg), `${cancelBg} ${r1(cx.w)}→${r1(cxOn.w)} bubble=${bubbleCancelBg}`);
  // 面板暗一档也必须是实色:半透明会透出下面红色的「松开 取消」大条(第一版就是这样)。
  const arcPaint = await page.evaluate(() => { const el = document.querySelector('[data-testid="voice-hold-arc"] > div'); const cs = getComputedStyle(el); return { bg: cs.backgroundColor, opacity: cs.opacity }; });
  ck(tag, '✕ 区时弧形面板仍是不透明实色(不透出大条)', /^rgb\(/.test(arcPaint.bg) && arcPaint.opacity === '1', JSON.stringify(arcPaint));
  await shot('3-cancel');
  // 滞回:出圈到 hitEnter+10(66px)仍在;到 hitExit+10(86px)才出。圈心取静止时的位置(放大是 transform,圆心不动)。
  await slide(page, { x: cx.cx, y: cx.cy }, { x: cx.cx + 66, y: cx.cy }, 6);
  const zIn = await zone(page);
  await slide(page, { x: cx.cx + 66, y: cx.cy }, { x: cx.cx + 86, y: cx.cy }, 3);
  const zOut = await zone(page);
  await slide(page, { x: cx.cx + 86, y: cx.cy }, { x: cx.cx + 66, y: cx.cy }, 3);
  const zBack = await zone(page);
  ck(tag, '滞回:出圈 66px 仍在 ✕;86px 出区;再回到 66px 不重新进', zIn === 'cancel' && zOut === 'neutral' && zBack === 'neutral', `${zIn}/${zOut}/${zBack}`);
  await slide(page, { x: cx.cx + 66, y: cx.cy }, { x: cx.cx, y: cx.cy }, 4);

  // ── 4 松手结果 ──
  await page.evaluate(() => { window.__flash.text = '不该出现'; });
  await releaseAndSettle(page);
  const ntX = await painted(page, 'composer-notice');
  ck(tag, '✕ 区松手:丢弃(没有草稿卡片)、提示「已取消」', (await draft(page)) === null && (await notice(page)) === '已取消' && seen(ntX), `${await draft(page)} / ${await notice(page)} / painted ${pd(ntX)}`);

  await page.evaluate(() => { window.__flash.text = '转成文字的内容'; });
  const b2 = await press(page);
  await page.waitForTimeout(1100);
  await slide(page, { x: b2.cx, y: b2.cy }, { x: tx.cx, y: tx.cy });
  await releaseAndSettle(page);
  ck(tag, '文 区松手:文字进草稿卡片、没有发送', (await draft(page)) === '转成文字的内容' && (await sendPosts(page)) === 0, `${await draft(page)} posts=${await sendPosts(page)}`);

  await page.evaluate(() => { window.__flash.text = '中间松手'; });
  await press(page);
  await page.waitForTimeout(1100);
  await releaseAndSettle(page);
  ck(tag, '中间区松手 = 现状:接在草稿光标后、没有发送', (await draft(page)) === '转成文字的内容中间松手' && (await sendPosts(page)) === 0, `${await draft(page)} posts=${await sendPosts(page)}`);

  // ── 5 长文字:≤3 行后在气泡里滚 ──
  await press(page);
  await page.evaluate(() => window.__anetVoiceSim.partial('这是一段很长的流式识别中间结果,用来确认气泡最多长到三行,再多的时候在气泡里面滚动,并且始终停在最新说出来的那一截上面,不会把整张气泡撑出屏幕。'));
  await page.waitForTimeout(500);
  const sc = await page.evaluate(() => {
    const t = document.querySelector('[data-testid="voice-interim"]');
    let el = t.parentElement; while (el && getComputedStyle(el).overflowY !== 'auto' && getComputedStyle(el).overflowY !== 'scroll') el = el.parentElement;
    return el ? { h: el.clientHeight, sh: el.scrollHeight, top: el.scrollTop } : null;
  });
  ck(tag, '长文字:可见高度 = 3 行(66px),超出部分在气泡里滚到最底', sc && Math.abs(sc.h - 66) <= 1 && sc.sh > sc.h && Math.abs(sc.top - (sc.sh - sc.h)) <= 1, JSON.stringify(sc));
  const bubLong = await box(page, 'voice-hold-bubble');
  const cxNow = await box(page, 'voice-hold-cancel');
  ck(tag, '长文字时气泡仍居中、不压到圈', Math.abs(bubLong.cx - (ov.x + ov.w / 2)) <= 1 && bubLong.b <= cxNow.y, `cx=${r1(bubLong.cx)} bottom=${r1(bubLong.b)} circle.top=${r1(cxNow.y)}`);
  // 草稿卡片(按住期间显示光标处预览,#440)这时有草稿 + 长预览 = 长到最高;面板必须整个盖住它。
  const cardNow = await box(page, 'voice-draft-card');
  const arcNow = await box(page, 'voice-hold-arc');
  const labelNow = await box(page, 'voice-hold-label');
  ck(tag, '草稿卡片长到最高时,面板仍整个盖住它;状态文案在面板之上', cardNow && arcNow.y <= cardNow.y && labelNow.b <= arcNow.y, `card.top=${cardNow && r1(cardNow.y)} arc.top=${r1(arcNow.y)} label.bottom=${r1(labelNow.b)}`);
  rows.push({ scheme, state: 'long-text+card', overlayW: r1(ov.w), overlayCx: r1(ov.x + ov.w / 2), bubbleCx: r1(bubLong.cx), dBubble: r1(bubLong.cx - (ov.x + ov.w / 2)), cancelCx: r1(cxNow.cx), textCx: r1((await box(page, 'voice-hold-totext')).cx), symL: r1(ov.x + ov.w / 2 - cxNow.cx), symR: r1((await box(page, 'voice-hold-totext')).cx - (ov.x + ov.w / 2)), dCircleCy: r1((await box(page, 'voice-hold-totext')).cy - cxNow.cy), arcX: r1(arcNow.x), arcW: r1(arcNow.w), arcBottom: r1(arcNow.b), arcContentBottom: r1((await box(page, 'voice-hold-arc-content')).b), safeBottom: vh - INSETS.bottom });
  await shot('4-long-text');
  // 有草稿卡片时面板更高、圈跟着上移:用现在量到的圈心,别用第一次的。
  await slide(page, { x: bar.cx, y: bar.cy }, { x: cxNow.cx, y: cxNow.cy });
  ck(tag, '面板变高后滑到(上移了的)✕ 仍进取消区', (await zone(page)) === 'cancel');
  await releaseAndSettle(page);

  // ── 6 太短 / 识别报错 ──
  await press(page);
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForSelector('[data-testid="voice-hold-toast"]', { timeout: 3000 }).catch(() => {});
  const toast = await page.evaluate(() => document.querySelector('[data-testid="voice-hold-toast"]')?.textContent ?? null);
  // textContent 里还有 Ionicons 的字形字符(网页上图标是一个私用区字符),只比文字部分。
  const toastBox = await box(page, 'voice-hold-toast');
  const toastCard = await page.evaluate(() => { const r = document.querySelector('[data-testid="voice-hold-toast"] > div')?.getBoundingClientRect(); return r ? { cx: r.x + r.width / 2, cy: r.y + r.height / 2 } : null; });
  // 量文字本身那个元素(voice-hold-toast 是铺满聊天页的定位层,量它恒为真)。
  const toastP = await paintedText(page, '[data-testid="voice-hold-toast"] *', '说话时间太短');
  ck(tag, '太短:「说话时间太短」提示、输入区不重复提示', (toast ?? '').replace(/[\uE000-\uF8FF]/g, '') === '说话时间太短' && seen(toastP) && (await notice(page)) !== '说话时间太短', `${toast} / ${await notice(page)} / painted ${pd(toastP)}`);
  ck(tag, '太短提示在聊天页正中(≤1px)', toastCard && toastBox && Math.abs(toastCard.cx - toastBox.cx) <= 1 && Math.abs(toastCard.cy - toastBox.cy) <= 1, JSON.stringify(toastCard));
  await shot('5-too-short');
  await page.waitForTimeout(1500);
  ck(tag, '太短提示自己消失', (await box(page, 'voice-hold-toast')) === null);
  ck(tag, '太短:草稿不变', (await draft(page)) === '转成文字的内容中间松手');

  await page.evaluate(() => { window.__flash.fail = true; });
  await press(page);
  await page.waitForTimeout(1100);
  await releaseAndSettle(page);
  const ntE = await painted(page, 'composer-notice');
  ck(tag, '识别报错:输入区提示原因、浮层收起、草稿不变', /频繁/.test((await notice(page)) ?? '') && seen(ntE) && (await draft(page)) === '转成文字的内容中间松手', `${await notice(page)} / painted ${pd(ntE)}`);
  await page.evaluate(() => { window.__flash.fail = false; });
  await stopLevels(page);
  await ctx.close();

  // ── 麦克风被拒 ──
  {
    const { ctx: c2, page: p2 } = await open(scheme, { denyMic: true });
    const b = await box(p2, 'voice-hold-bar');
    await p2.mouse.move(b.cx, b.cy);
    await p2.mouse.down();
    await p2.waitForTimeout(800);
    const overlayGone = (await box(p2, 'voice-overlay')) === null;
    await p2.mouse.up();
    await p2.waitForTimeout(300);
    const ntM = await painted(p2, 'composer-notice');
    ck(tag, '麦克风被拒:浮层收起、输入区提示', overlayGone && (await p2.evaluate(() => document.querySelector('[data-testid="composer-notice"]')?.textContent ?? '')) === '麦克风权限被拒绝' && seen(ntM), `${await p2.evaluate(() => document.querySelector('[data-testid="composer-notice"]')?.textContent ?? '')} / painted ${pd(ntM)}`);
    await c2.close();
  }

  // ── 减弱动态效果 ──
  {
    const { ctx: c3, page: p3 } = await open(scheme, { context: { reducedMotion: 'reduce' } });
    const b = await box(p3, 'voice-hold-bar');
    await p3.mouse.move(b.cx, b.cy);
    await p3.mouse.down();
    await p3.waitForSelector('[data-testid="voice-overlay"]', { timeout: 5000 });
    const early = await p3.evaluate(() => { const el = document.querySelector('[data-testid="voice-hold-bubble"]'); const cs = getComputedStyle(el); return { opacity: cs.opacity, transform: cs.transform }; });
    ck(tag, '减弱动态效果:气泡一出现就是完整大小、不透明', early.opacity === '1' && (early.transform === 'none' || early.transform === 'matrix(1, 0, 0, 1, 0, 0)'), JSON.stringify(early));
    await p3.mouse.up();
    await c3.close();
  }
}
// ── 桌面:微信式浮层永远不画(另有桌面自己的录音 UI)。窄桌面窗口会落回 phone 布局、也有「按住 说话」条 ——
// 那里同样不能画手机浮层。宽桌面(1200×850)只有工具栏麦克风。无安卓 UA、无 safeAreaSim = Tauri 桌面。
for (const vp of [{ width: 390, height: 844, name: 'desktop-narrow-390x844' }, { width: 1200, height: 850, name: 'desktop-1200x850' }]) {
  const tag = vp.name;
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, colorScheme: 'light', permissions: ['microphone'] });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGEERROR', e.message.split('\n')[0]));
  await page.addInitScript(initScript, { theme: 'light', denyMic: false });
  await page.goto(WEB_URL);
  await page.getByText(ALIAS, { exact: true }).first().click({ timeout: 20000 });
  await page.waitForTimeout(800);
  const target = (await page.locator('[data-testid="voice-hold-bar"]').count()) ? 'voice-hold-bar' : 'voice-mic';
  const b = await box(page, target);
  if (!b) { ck(tag, '找到语音入口', false, target); await ctx.close(); continue; }
  await page.mouse.move(b.cx, b.cy);
  await page.mouse.down();
  // 宽桌面的 🎤 是点一下开始(#463),松开也不结束;窄窗口的大条是按住。
  if (target === 'voice-mic') await page.mouse.up();
  await page.waitForSelector('[data-testid="voice-overlay"], [data-testid="voice-bar"]', { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(600);
  const s = await page.evaluate(() => ({ voiceBar: !!document.querySelector('[data-testid="voice-bar"]'), card: !!document.querySelector('[data-testid="voice-overlay-card"]'), bubble: !!document.querySelector('[data-testid="voice-hold-bubble"]'), arc: !!document.querySelector('[data-testid="voice-hold-arc"]'), overlay: !!document.querySelector('[data-testid="voice-overlay"]') }));
  // 宽桌面走 #463 的行内录音条(不是任何浮层);窄桌面窗口仍是 #463 留下的卡片。两者都不能出现手机的气泡 / 弧形面板。
  ck(tag, `桌面(${target}):不画手机浮层(无气泡 / 弧形面板)`, !s.bubble && !s.arc && (target === 'voice-hold-bar' ? s.card : s.voiceBar && !s.overlay), JSON.stringify(s));
  const f = `${OUT}/holdoverlay-${tag}.png`; await page.screenshot({ path: f }); shots.push(f);
  if (target === 'voice-hold-bar') await page.mouse.up();
  else await page.keyboard.press('Escape');
  await ctx.close();
}
await browser.close(); web.close();

const cols = ['scheme', 'state', 'overlayW', 'overlayCx', 'bubbleCx', 'dBubble', 'cancelCx', 'textCx', 'symL', 'symR', 'dCircleCy', 'arcX', 'arcW', 'arcBottom', 'arcContentBottom', 'safeBottom'];
console.log(`\n| ${cols.join(' | ')} |\n|${cols.map(() => '---').join('|')}|`);
for (const r of rows) console.log(`| ${cols.map(c => r[c]).join(' | ')} |`);
console.log(`\nscreenshots:\n${shots.join('\n')}`);
console.log(`\n${total - failures}/${total} passed`);
process.exit(failures ? 1 : 0);
