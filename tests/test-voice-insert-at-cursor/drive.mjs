// 语音插到光标处 —— 真应用(expo web 导出 + Tauri 桥桩)端到端 + 截图。不进 CI:要 Playwright + Chromium + 一个一次性 hub。
//
//   HUB_URL=http://127.0.0.1:<非 9200 端口> HUB_TOKEN=utok_… ALIAS=<会话别名> WEB_DIR=<expo export 目录> OUT=<截图目录> \
//   PLAYWRIGHT_MODULE=<…/playwright/index.mjs> node tests/test-voice-insert-at-cursor/drive.mjs
//
// 同 test-voice-composer-visual:桌面壳分支(有安全存储 → 有语音输入),Chromium 假麦克风,识别走极速版到本地
// 假 HTTP 服务 —— 这里的假服务按调用顺序返回 RESULTS 里的句子。布局:390×844 + 安卓 UA = 手机单栏,
// 1200×850 + 安卓 UA = 双栏(两者都是键盘模式输入框里的小麦克风);1200×850 桌面 UA = 桌面(工具栏麦克风)。
// 手机 / 双栏带 ?safeAreaSim(底部 24)量麦克风没压进底部安全区(#432)。
//
// 每个布局断言:
//   1 中间插入   「明天|去公司开会」按住框内麦克风说「上午」→「明天上午去公司开会」,光标 = 4,焦点仍在输入框
//   2 放开控制   紧接着敲一个字 → 落在光标处(selection 受控已放开,用户能继续打字 / 挪光标)
//   3 录音中不失焦 按住期间 document.activeElement 仍是输入框(网页 mousedown 不抢焦点)
//   4 替换选区   选中「公司」说「办公室」→ 替换,光标在「办公室」之后
//   5 失焦后按   程序化挪光标(不报选区事件)再让输入框失焦,然后按麦克风 → 仍插在失焦前的光标处
//   6 拉丁空格   「hello|world」说「big」→「hello big world」
//   7 草稿卡片   (手机 / 双栏)语音模式有草稿 → 点卡片 → 键盘模式、光标在末尾
// 退出码 1 = 任何一条失败。
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const HUB_URL = process.env.HUB_URL, TOKEN = process.env.HUB_TOKEN, ALIAS = process.env.ALIAS, WEB = process.env.WEB_DIR, OUT = process.env.OUT;
if (!HUB_URL || !TOKEN || !ALIAS || !WEB || !OUT) throw new Error('need HUB_URL HUB_TOKEN ALIAS WEB_DIR OUT');
if (/:9200\b/.test(HUB_URL)) throw new Error('refusing the production hub port 9200');
mkdirSync(OUT, { recursive: true });

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ttf': 'font/ttf', '.json': 'application/json', '.ico': 'image/x-icon' };
const web = createServer((req, res) => {
  let p = join(WEB, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!existsSync(p) || statSync(p).isDirectory()) p = join(WEB, 'index.html');
  res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' });
  res.end(readFileSync(p));
}).listen(0, '127.0.0.1');
// 假极速版:下一句识别结果由 /next?text=… 预置(每次按住前设一次)。
let nextText = '上午';
const flash = createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/next') { nextText = u.searchParams.get('text') || ''; res.writeHead(204, { 'access-control-allow-origin': '*' }); res.end(); return; }
  req.on('data', () => {}); req.on('end', () => {
    res.writeHead(200, { 'content-type': 'application/json', 'X-Api-Status-Code': '20000000', 'access-control-expose-headers': 'X-Api-Status-Code' });
    res.end(JSON.stringify({ result: { text: nextText } }));
  });
}).listen(0, '127.0.0.1');
await new Promise(r => setTimeout(r, 200));
const WEB_URL = `http://127.0.0.1:${web.address().port}/`;
const FLASH_URL = `http://127.0.0.1:${flash.address().port}/flash`;
const say = (text) => { nextText = text; };

const initScript = ({ hubUrl, token, flashUrl, theme }) => {
  const profile = { serverUrl: hubUrl, token, username: 'tester', profileId: 'p-voiceinsert', displayName: 'tester' };
  const creds = { appId: '', accessToken: 'visual-api-key-0000', endpoint: flashUrl };
  let rid = 0; const reqs = new Map(); const bodies = new Map();
  try { localStorage.setItem('voice_composer_input_mode_v1', 'keyboard'); } catch {}
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
          const r = await fetch(c.url, { method: c.method, headers: c.headers, body: c.data ? new Uint8Array(c.data) : undefined });
          const buf = new Uint8Array(await r.arrayBuffer());
          const id = ++rid; bodies.set(id, { buf, sent: false });
          return { status: r.status, statusText: r.statusText, url: r.url, headers: Array.from(r.headers.entries()), rid: id };
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
const browser = await chromium.launch({ headless: true, executablePath: findExe(), args: ['--disable-web-security', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel Fold) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

let failures = 0;
const results = [];
const ck = (tag, name, cond, detail = '') => {
  results.push({ tag, name, ok: !!cond, detail });
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'} [${tag}] ${name}${detail ? ` — ${detail}` : ''}`);
};

const LAYOUTS = [
  { name: 'phone', w: 390, h: 844, ua: ANDROID_UA, mic: '[data-testid="voice-field-mic"]', insets: [32, 0, 24, 0] },
  { name: 'twopane', w: 1200, h: 850, ua: ANDROID_UA, mic: '[data-testid="voice-field-mic"]', insets: [32, 0, 24, 40] },
  { name: 'desktop', w: 1200, h: 850, ua: undefined, mic: '[data-testid="voice-mic"]', insets: null },
];

for (const L of LAYOUTS) {
  const tag = `${L.name}-${L.w}x${L.h}`;
  const ctx = await browser.newContext({ viewport: { width: L.w, height: L.h }, colorScheme: 'light', userAgent: L.ua, permissions: ['microphone'], deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGEERROR', e.message.split('\n')[0]));
  await page.addInitScript(initScript, { hubUrl: HUB_URL, token: TOKEN, flashUrl: FLASH_URL, theme: 'light' });
  await page.goto(L.insets ? `${WEB_URL}?safeAreaSim=${L.insets.join(',')}` : WEB_URL);
  await page.getByText(ALIAS, { exact: true }).first().click({ timeout: 20000 });
  const input = page.locator(`textarea[placeholder="Message ${ALIAS}…"]`);
  await input.waitFor({ timeout: 15000 });
  const mic = page.locator(L.mic);
  await mic.waitFor({ timeout: 10000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/voiceinsert-${tag}-0-keyboard-mode.png` });
  const state = () => input.evaluate(el => ({ value: el.value, start: el.selectionStart, end: el.selectionEnd, focused: el === document.activeElement }));
  // 用户的真实路径:点进输入框,方向键把光标挪到 j,Shift+← 选回 i(选区事件照常触发)。
  const caretTo = async (i, j = i) => {
    await input.click();
    await page.keyboard.press('Control+End');
    const len = (await input.inputValue()).length;
    for (let k = 0; k < len - j; k++) await page.keyboard.press('ArrowLeft');
    for (let k = 0; k < j - i; k++) await page.keyboard.press('Shift+ArrowLeft');
    await page.waitForTimeout(150);
  };
  // 程序化改选区(不触发任何选区事件):只有「按下时直接读 textarea」才拿得到它。
  const caretSilently = async (i) => { await input.evaluate((el, a) => el.setSelectionRange(a, a), i); await page.waitForTimeout(100); };
  const hold = async (text, { shot } = {}) => {
    say(text);
    const b = await mic.boundingBox();
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    await page.mouse.move(cx, cy); await page.mouse.down();
    await page.waitForSelector('[data-testid="voice-overlay"]', { timeout: 5000 });
    await page.waitForTimeout(1300);
    const during = await state();
    if (shot) await page.screenshot({ path: shot });
    await page.mouse.up();
    await page.waitForFunction(() => !document.querySelector('[data-testid="voice-overlay"]'), null, { timeout: 10000 });
    await page.waitForTimeout(300);
    return during;
  };

  // 麦克风几何:在输入框里、与输入框同一中线;手机 / 双栏不压进底部安全区。
  {
    const m = await mic.boundingBox(), i = await input.boundingBox();
    const dCy = (m.y + m.height / 2) - (i.y + i.height / 2);
    if (L.name !== 'desktop') {
      ck(tag, `框内麦克风在输入框里、同一中线(dCy=${dCy.toFixed(1)}, mic ${m.height}px, input ${i.height}px)`, m.x >= i.x && m.x + m.width <= i.x + i.width + 0.5 && Math.abs(dCy) <= 1);
      ck(tag, `麦克风底边在底部安全区之上(bottom=${(m.y + m.height).toFixed(1)} ≤ ${L.h - L.insets[2]})`, m.y + m.height <= L.h - L.insets[2]);
      // 判据自检(正控):同一判据喂一个下移 2px 的麦克风必须报红,否则上面那条「中线」是空断言。
      const shifted = await mic.evaluate(el => { el.style.transform = 'translateY(2px)'; const r = el.getBoundingClientRect(); el.style.transform = ''; return r.y + r.height / 2; });
      ck(tag, '正控:麦克风下移 2px 时中线判据会报红', Math.abs(shifted - (i.y + i.height / 2)) > 1);
    }
  }

  // 1 中间插入 + 3 录音中不失焦
  await input.fill('明天去公司开会');
  await caretTo(2);
  await page.screenshot({ path: `${OUT}/voiceinsert-${tag}-1-before-caret-mid.png` });
  const during = await hold('上午', { shot: `${OUT}/voiceinsert-${tag}-2-recording.png` });
  ck(tag, '录音期间输入框没有失焦', during.focused, JSON.stringify(during));
  let s = await state();
  ck(tag, '中间插入:「明天|去公司开会」+「上午」', s.value === '明天上午去公司开会', s.value);
  ck(tag, '插入后光标紧跟「上午」(4)', s.start === 4 && s.end === 4, `${s.start},${s.end}`);
  ck(tag, '插入后焦点仍在输入框', s.focused);
  await page.screenshot({ path: `${OUT}/voiceinsert-${tag}-3-after-insert-mid.png` });

  // 2 放开控制:直接打字落在光标处
  await page.waitForTimeout(300);
  await page.keyboard.type('9');
  s = await state();
  ck(tag, '放开控制:紧接着打的字落在光标处', s.value === '明天上午9去公司开会' && s.start === 5, `${s.value} @${s.start}`);

  // 4 替换选区:选中「公司」
  await input.fill('明天去公司开会');
  await caretTo(3, 5);
  await hold('办公室');
  s = await state();
  ck(tag, '替换选区:「公司」→「办公室」', s.value === '明天去办公室开会' && s.start === 6, `${s.value} @${s.start}`);

  // 5 失焦后再按:插在失焦前的光标处
  await input.fill('明天去公司开会');
  await caretTo(7);
  await caretSilently(5);
  await input.evaluate(el => el.blur());
  await page.waitForTimeout(150);
  const blurred = await state();
  await hold('三楼');
  s = await state();
  ck(tag, '先失焦再按麦克风:仍插在失焦前的光标处', !blurred.focused && s.value === '明天去公司三楼开会', `${s.value} (blurred=${!blurred.focused})`);
  ck(tag, '失焦后按完:焦点回到输入框、光标在插入之后', s.focused && s.start === 7, `${s.start} focused=${s.focused}`);

  // 6 拉丁空格
  await input.fill('hello world');
  await caretTo(5);
  await hold('big');
  s = await state();
  ck(tag, '拉丁:「hello|world」+「big」→「hello big world」', s.value === 'hello big world', JSON.stringify(s.value));

  // 7 草稿卡片 → 键盘模式,光标在末尾(手机 / 双栏)
  if (L.name !== 'desktop') {
    await input.fill('帮我看一下今天的构建为什么失败了');
    await caretTo(0);
    await page.locator('[data-testid="composer-mode-toggle"]').click();
    await page.locator('[data-testid="voice-draft-card"]').waitFor({ timeout: 3000 });
    ck(tag, '语音模式下没有框内麦克风', (await page.locator('[data-testid="voice-field-mic"]').count()) === 0);
    await page.locator('[data-testid="voice-draft-card-text"]').click();
    await input.waitFor({ timeout: 3000 });
    await page.waitForTimeout(400);
    s = await state();
    ck(tag, '点草稿卡片 → 键盘模式、聚焦、光标在末尾', s.focused && s.start === s.value.length && s.end === s.value.length, `${s.start}/${s.value.length}`);
    await page.screenshot({ path: `${OUT}/voiceinsert-${tag}-4-card-tap-cursor-end.png` });
  }
  await ctx.close();
}
await browser.close(); web.close(); flash.close();
console.log(`\n${results.length - failures}/${results.length} passed`);
process.exit(failures ? 1 : 0);
