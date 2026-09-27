// 语音模式草稿卡片里选插入位置 —— 真应用(expo web 导出 + Tauri 桥桩)端到端 + 量尺寸。不进 CI:要 Playwright +
// Chromium + 一个一次性 hub。
//
//   HUB_URL=http://127.0.0.1:<非 9200 端口> HUB_TOKEN=utok_… ALIAS=<会话别名> WEB_DIR=<expo export 目录> OUT=<截图目录> \
//   PLAYWRIGHT_MODULE=<…/playwright/index.mjs> node tests/test-voice-draft-cursor/drive.mjs
//
// 同 test-voice-insert-at-cursor:桌面壳分支(有安全存储 → 有语音输入),Chromium 假麦克风,识别走极速版到本地
// 假 HTTP 服务(下一句由 say() 预置)。390×844 + 安卓 UA = 手机单栏,起始就是语音模式。
// (网页上走极速版,没有流式中间结果 —— 光标处预览由 src/voice-draft-cursor.test.ts 覆盖。)
//
// 断言:
//   1 卡片是 inputmode=none 的输入框;点它 = 聚焦 + 放光标,不切键盘模式(没有主输入框、大条还在)
//   2 光标在中间:按住大条说「具体」→「什么具体情况?」,光标 = 4,卡片仍聚焦(光标可见),仍是语音模式
//   3 连着按:说「是」→ 接在新光标处
//   4 选中一段 → 替换,光标在替换文字之后
//   5 程序化挪光标(不报选区事件)再按 → 插在那里(按下时读宿主选区)
//   6 ⌨ 切到键盘:输入框拿到同一个选区;再切回语音:卡片拿到同一个选区
//   7 ✕ 清空 → 卡片消失;发送 → 草稿清空、消息出现在会话里
//   8 输入行几何(卡片聚焦时):⌨ / 大条 / 发送 同一中线 ≤1px、同高、左右内边距相等、两侧间距相等(#424)
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
// 假极速版:返回 nextText(每次按住前 say() 预置)。
let nextText = '';
const flash = createServer((req, res) => {
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
  const profile = { serverUrl: hubUrl, token, username: 'tester', profileId: 'p-draftcursor', displayName: 'tester' };
  const creds = { appId: '', accessToken: 'visual-api-key-0000', endpoint: flashUrl };
  let rid = 0; const reqs = new Map(); const bodies = new Map();
  try { localStorage.setItem('voice_composer_input_mode_v1', 'voice'); } catch {}
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
          // 记下发往 hub 的 POST(断言「发送」真的发出去了;假会话没有历史可加载,不能靠气泡判断)。
          if (c.method === 'POST' && c.data) { try { (window.__posts ||= []).push({ url: c.url, body: new TextDecoder().decode(new Uint8Array(c.data)) }); } catch {} }
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
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

let failures = 0;
const results = [];
const ck = (tag, name, cond, detail = '') => {
  results.push({ tag, name, ok: !!cond, detail });
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'} [${tag}] ${name}${detail ? ` — ${detail}` : ''}`);
};
const r1 = (n) => Math.round(n * 10) / 10;
const rows = [];

for (const scheme of ['light', 'dark']) {
  const tag = `phone-390x844-${scheme}`;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme, userAgent: ANDROID_UA, permissions: ['microphone'], deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGEERROR', e.message.split('\n')[0]));
  await page.addInitScript(initScript, { hubUrl: HUB_URL, token: TOKEN, flashUrl: FLASH_URL, theme: scheme });
  await page.goto(`${WEB_URL}?safeAreaSim=32,0,24,0`);
  await page.getByText(ALIAS, { exact: true }).first().click({ timeout: 20000 });
  const bar = page.locator('[data-testid="voice-hold-bar"]');
  await bar.waitFor({ timeout: 15000 });
  const card = page.locator('[data-testid="voice-draft-card-text"]');
  const mainInput = page.locator(`textarea[placeholder="Message ${ALIAS}…"]`);
  await page.waitForTimeout(300);

  const cardState = () => card.evaluate(el => ({ value: el.value, start: el.selectionStart, end: el.selectionEnd, focused: el === document.activeElement, inputMode: el.getAttribute('inputmode') }));
  const inVoiceMode = async () => (await bar.count()) === 1 && (await mainInput.count()) === 0;
  // 真实路径:点卡片(聚焦 + 放光标),方向键挪到 j,Shift+← 选回 i(选区事件照常触发)。
  const caretTo = async (i, j = i) => {
    await card.click();
    await page.keyboard.press('Control+End');
    const len = (await card.inputValue()).length;
    for (let k = 0; k < len - j; k++) await page.keyboard.press('ArrowLeft');
    for (let k = 0; k < j - i; k++) await page.keyboard.press('Shift+ArrowLeft');
    await page.waitForTimeout(150);
  };
  const hold = async (text) => {
    say(text);
    const b = await bar.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
    await page.waitForSelector('[data-testid="voice-overlay"]', { timeout: 5000 });
    await page.waitForTimeout(1300);
    await page.mouse.up();
    await page.waitForFunction(() => !document.querySelector('[data-testid="voice-overlay"]'), null, { timeout: 10000 });
    await page.waitForTimeout(400);
  };

  // 0 第一句:空草稿按住 → 卡片出现(没点过卡片 = 末尾)
  await hold('什么情况?');
  await card.waitFor({ timeout: 3000 });
  let s = await cardState();
  ck(tag, '第一句进卡片,仍是语音模式', s.value === '什么情况?' && await inVoiceMode(), JSON.stringify(s));

  // 1 卡片是不弹键盘的输入框;点它不切模式
  ck(tag, '卡片 inputmode=none(网页上不弹软键盘;原生 = showSoftInputOnFocus={false})', s.inputMode === 'none', `inputmode=${s.inputMode}`);
  await caretTo(2);
  s = await cardState();
  ck(tag, '点卡片:聚焦、光标放在「什么|情况?」(2)、没切到键盘模式', s.focused && s.start === 2 && s.end === 2 && await inVoiceMode(), JSON.stringify(s));
  await page.screenshot({ path: `${OUT}/draftcursor-${tag}-1-caret-mid.png` });

  // 8 几何:卡片聚焦、右格 = 发送
  {
    const m = await page.evaluate(() => {
      const q = (x) => document.querySelector(x);
      const left = q('[data-testid="composer-mode-toggle"]'), mid = q('[data-testid="voice-hold-bar"]'), right = q('[data-testid="composer-send"]');
      if (!left || !mid || !right) return null;
      let row = left.parentElement; while (row && !row.contains(right)) row = row.parentElement;
      const cardEl = q('[data-testid="voice-draft-card"]');
      const b = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, h: r.height, r: r.right, b: r.bottom, cy: r.y + r.height / 2 }; };
      return { left: b(left), mid: b(mid), right: b(right), row: b(row), card: cardEl ? b(cardEl) : null };
    });
    if (!m) ck(tag, '输入行三个控件都在', false);
    else {
      const dL = m.left.cy - m.mid.cy, dR = m.right.cy - m.mid.cy;
      const padL = m.left.x - m.row.x, padR = m.row.r - m.right.r, gapL = m.mid.x - m.left.r, gapR = m.right.x - m.mid.r;
      const row = { scheme, state: 'voice-card-focused', hL: r1(m.left.h), hMid: r1(m.mid.h), hR: r1(m.right.h), dCyL: r1(dL), dCyR: r1(dR), padL: r1(padL), padR: r1(padR), gapL: r1(gapL), gapR: r1(gapR), cardBottom: r1(m.card.b), rowTop: r1(m.row.y) };
      rows.push(row);
      ck(tag, '⌨ / 大条 / 发送 同一中线(≤1px)', Math.abs(dL) <= 1 && Math.abs(dR) <= 1, `dCyL=${r1(dL)} dCyR=${r1(dR)}`);
      ck(tag, '三者同高(≤1px)', Math.abs(m.mid.h - m.left.h) <= 1 && Math.abs(m.right.h - m.left.h) <= 1, `${r1(m.left.h)}/${r1(m.mid.h)}/${r1(m.right.h)}`);
      ck(tag, '左右内边距相等(≤1px)', Math.abs(padL - padR) <= 1, `${r1(padL)}/${r1(padR)}`);
      ck(tag, '两侧间距相等(≤1px)', Math.abs(gapL - gapR) <= 1, `${r1(gapL)}/${r1(gapR)}`);
      ck(tag, '卡片在输入行之上、不压行', m.card && m.card.b <= m.row.y + 0.5, `card.bottom=${r1(m.card.b)} row.top=${r1(m.row.y)}`);
      // 正控:同一判据喂一个下移 2px 的大条必须报红,否则中线判据是空断言。
      const shifted = await bar.evaluate(el => { el.style.transform = 'translateY(2px)'; const r = el.getBoundingClientRect(); el.style.transform = ''; return r.y + r.height / 2; });
      ck(tag, '正控:大条下移 2px 时中线判据会报红', Math.abs(m.left.cy - shifted) > 1);
    }
  }

  // 2 光标在中间按住
  await hold('具体');
  s = await cardState();
  ck(tag, '中间插入:「什么|情况?」+「具体」→「什么具体情况?」', s.value === '什么具体情况?', s.value);
  ck(tag, '插完光标紧跟插入文字(4)', s.start === 4 && s.end === 4, `${s.start},${s.end}`);
  ck(tag, '插完卡片仍聚焦(光标可见)、仍是语音模式', s.focused && await inVoiceMode());
  await page.screenshot({ path: `${OUT}/draftcursor-${tag}-2-after-insert.png` });

  // 3 连着按:接在新光标处
  await hold('是');
  s = await cardState();
  ck(tag, '连着按:「什么具体|情况?」+「是」→「什么具体是情况?」,光标 5', s.value === '什么具体是情况?' && s.start === 5, `${s.value} @${s.start}`);

  // 4 选中一段 → 替换
  await caretTo(2, 5);                     // 选中「具体是」
  s = await cardState();
  ck(tag, '拖选:卡片里选中「具体是」(2,5),没切模式', s.start === 2 && s.end === 5 && await inVoiceMode(), `${s.start},${s.end}`);
  await page.screenshot({ path: `${OUT}/draftcursor-${tag}-3-range.png` });
  await hold('到底是什么');
  s = await cardState();
  ck(tag, '替换:「具体是」→「到底是什么」,光标在其后(7)', s.value === '什么到底是什么情况?' && s.start === 7 && s.end === 7, `${s.value} @${s.start},${s.end}`);

  // 5 程序化挪光标(不触发选区事件)→ 按下时读宿主选区
  await card.evaluate(el => el.setSelectionRange(0, 0));
  await page.waitForTimeout(100);
  await hold('请问');
  s = await cardState();
  ck(tag, '按下时读卡片当前选区(没报事件也算):插在开头', s.value === '请问什么到底是什么情况?' && s.start === 2, `${s.value} @${s.start}`);

  // 6 模式切换保留选区
  await caretTo(4, 6);                     // 选中「到底」
  await page.locator('[data-testid="composer-mode-toggle"]').click();
  await mainInput.waitFor({ timeout: 3000 });
  await page.waitForTimeout(400);
  const kb = await mainInput.evaluate(el => ({ value: el.value, start: el.selectionStart, end: el.selectionEnd, focused: el === document.activeElement }));
  ck(tag, '⌨ 切到键盘:输入框同一份草稿、同一个选区(4,6)、已聚焦', kb.value === '请问什么到底是什么情况?' && kb.start === 4 && kb.end === 6 && kb.focused, JSON.stringify(kb));
  await page.screenshot({ path: `${OUT}/draftcursor-${tag}-4-keyboard-keeps-selection.png` });
  await mainInput.evaluate(el => el.setSelectionRange(2, 2));
  await page.keyboard.press('ArrowRight');   // 用户在键盘模式挪光标(报选区事件)→ 3
  await page.waitForTimeout(150);
  await page.locator('[data-testid="composer-mode-toggle"]').click();
  await card.waitFor({ timeout: 3000 });
  await page.waitForTimeout(400);
  s = await cardState();
  ck(tag, '切回语音:卡片拿到键盘模式里的光标(3)', s.start === 3 && s.end === 3 && await inVoiceMode(), `${s.start},${s.end}`);
  await hold('一下');
  s = await cardState();
  ck(tag, '切回后按住:插在那里', s.value === '请问什一下么到底是什么情况?', s.value);

  // 7 ✕ 清空 / 发送
  await page.locator('[data-testid="voice-draft-card-clear"]').click();
  await page.waitForTimeout(300);
  ck(tag, '✕ 清空:卡片消失、仍是语音模式', (await card.count()) === 0 && await inVoiceMode());
  const msg = `草稿光标测试 ${scheme} ${Date.now() % 100000}`;
  await hold(msg);
  await page.locator('[data-testid="composer-send"]').click();
  await page.waitForTimeout(800);
  const posted = await page.evaluate((m) => (window.__posts || []).filter(x => x.body.includes(m)).map(x => new URL(x.url).pathname), msg);
  ck(tag, '发送:草稿发往 hub', posted.length > 0, posted.join(','));
  ck(tag, '发送后:卡片消失、仍是语音模式(不弹键盘)', (await card.count()) === 0 && await inVoiceMode());
  await page.screenshot({ path: `${OUT}/draftcursor-${tag}-5-sent.png` });
  await ctx.close();
}
await browser.close(); web.close(); flash.close();

const cols = ['scheme', 'state', 'hL', 'hMid', 'hR', 'dCyL', 'dCyR', 'padL', 'padR', 'gapL', 'gapR', 'cardBottom', 'rowTop'];
console.log(`\n| ${cols.join(' | ')} |\n|${cols.map(() => '---').join('|')}|`);
for (const r of rows) console.log(`| ${cols.map(c => r[c]).join(' | ')} |`);
console.log(`\n${results.length - failures}/${results.length} passed`);
process.exit(failures ? 1 : 0);
