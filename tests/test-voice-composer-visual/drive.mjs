// 微信式语音输入区 —— 真应用(expo web 导出 + Tauri 桥桩)截图。不进 CI:要 Playwright + Chromium + 一个一次性 hub。
//
//   HUB_URL=http://127.0.0.1:<非 9200 端口> HUB_TOKEN=utok_… ALIAS=<会话别名> WEB_DIR=<expo export 目录> OUT=<截图目录> \
//   PLAYWRIGHT_MODULE=<…/playwright/index.mjs> node tests/test-voice-composer-visual/drive.mjs
//
// 桌面壳分支(__TAURI_INTERNALS__ 桩)是因为纯 web 分支没有安全存储 → 没有语音输入;
// 390 宽 = 手机单栏布局,1200 宽 + 安卓 UA = 双栏布局(wide-layout.ts chooseAppLayout)。
// 麦克风用 Chromium 假设备(--use-fake-device-for-media-stream);识别走极速版到本地假 HTTP 服务
// (桌面壳上 voicePlatform()=desktop,流式只在原生 —— 流式的中间结果由 src/doubao-stream-e2e.test.ts 覆盖)。
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const HUB_URL = process.env.HUB_URL, TOKEN = process.env.HUB_TOKEN, ALIAS = process.env.ALIAS, WEB = process.env.WEB_DIR, OUT = process.env.OUT;
if (!HUB_URL || !TOKEN || !ALIAS || !WEB || !OUT) throw new Error('need HUB_URL HUB_TOKEN ALIAS WEB_DIR OUT');
if (/:9200\b/.test(HUB_URL)) throw new Error('refusing the production hub port 9200');
mkdirSync(OUT, { recursive: true });

// 静态服务(SPA:未知路径回 index.html)
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ttf': 'font/ttf', '.json': 'application/json', '.ico': 'image/x-icon' };
const web = createServer((req, res) => {
  let p = join(WEB, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!existsSync(p) || statSync(p).isDirectory()) p = join(WEB, 'index.html');
  res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' });
  res.end(readFileSync(p));
}).listen(0, '127.0.0.1');
// 假极速版接口:返回一句固定文本
const flash = createServer((req, res) => {
  let n = 0; req.on('data', c => { n += c.length; }); req.on('end', () => {
    res.writeHead(200, { 'content-type': 'application/json', 'X-Api-Status-Code': '20000000', 'access-control-expose-headers': 'X-Api-Status-Code' });
    res.end(JSON.stringify({ result: { text: '帮我看一下今天的构建为什么失败了' } }));
  });
}).listen(0, '127.0.0.1');
await new Promise(r => setTimeout(r, 200));
const WEB_URL = `http://127.0.0.1:${web.address().port}/`;
const FLASH_URL = `http://127.0.0.1:${flash.address().port}/flash`;

const initScript = ({ hubUrl, token, flashUrl, theme }) => {
  const profile = { serverUrl: hubUrl, token, username: 'tester', profileId: 'p-visual', displayName: 'tester' };
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
const shots = [];
for (const [w, h, name, ua] of [[390, 844, 'phone', undefined], [1200, 850, 'twopane', ANDROID_UA]]) {
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, userAgent: ua, permissions: ['microphone'] });
    const page = await ctx.newPage();
    page.on('pageerror', e => console.log('PAGEERROR', e.message.split('\n')[0]));
    await page.addInitScript(initScript, { hubUrl: HUB_URL, token: TOKEN, flashUrl: FLASH_URL, theme: scheme });
    await page.goto(WEB_URL);
    await page.getByText(ALIAS, { exact: true }).first().click({ timeout: 20000 });
    const bar = page.locator('[data-testid="voice-hold-bar"]');
    await bar.waitFor({ timeout: 15000 });
    const tag = `${name}-${w}x${h}-${scheme}`;
    const box = await bar.boundingBox();
    const label = async () => (await page.locator('[data-testid="voice-hold-bar-label"]').innerText()).trim();
    const rec = { tag, barHeight: box.height, barWidth: box.width, idleLabel: await label() };
    await page.screenshot({ path: `${OUT}/${tag}-1-voice-idle.png` });
    // 按住
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy); await page.mouse.down();
    await page.waitForSelector('[data-testid="voice-overlay"]', { timeout: 5000 });
    await page.waitForTimeout(2300);
    rec.pressedLabel = await label();
    await page.screenshot({ path: `${OUT}/${tag}-2-recording.png` });
    // 上滑进取消区
    await page.mouse.move(cx, cy - 90, { steps: 8 });
    await page.waitForTimeout(250);
    rec.cancelLabel = await label();
    rec.cancelZone = (await page.locator('[data-testid="voice-cancel-zone-label"]').innerText()).trim();
    await page.screenshot({ path: `${OUT}/${tag}-3-cancel-armed.png` });
    // 滑回来,松手 → 识别 → 文字进输入框、切回键盘
    await page.mouse.move(cx, cy, { steps: 8 });
    await page.waitForTimeout(300);
    await page.mouse.up();
    const input = page.locator(`textarea[placeholder="Message ${ALIAS}…"]`);
    await input.waitFor({ timeout: 8000 });
    await page.waitForTimeout(400);
    rec.afterReleaseDraft = await input.inputValue();
    rec.keyboardModeAfterRelease = (await page.locator('[data-testid="voice-hold-bar"]').count()) === 0;
    rec.inputFocused = await input.evaluate(el => el === document.activeElement);
    await page.screenshot({ path: `${OUT}/${tag}-4-after-release.png` });
    // 切换按钮回到语音
    await page.locator('[data-testid="composer-mode-toggle"]').click();
    await bar.waitFor({ timeout: 3000 });
    rec.toggleBackToVoice = true;
    shots.push(rec);
    console.log(JSON.stringify(rec));
    await ctx.close();
  }
}
// 设置 → 语音输入(识别模型 + 单个 API Key;高级 / 旧版控制台展开后)
for (const scheme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme });
  const page = await ctx.newPage();
  await page.addInitScript(initScript, { hubUrl: HUB_URL, token: TOKEN, flashUrl: FLASH_URL, theme: scheme });
  await page.goto(WEB_URL);
  await page.getByText(ALIAS, { exact: true }).first().waitFor({ timeout: 20000 });
  await page.getByText('设置', { exact: true }).last().click();
  await page.getByText('语音输入', { exact: true }).first().click();
  await page.locator('[data-testid="voice-api-key"]').waitFor({ timeout: 8000 });
  const rec = {
    tag: `settings-390-${scheme}`,
    apiKeyFields: await page.locator('[data-testid="voice-api-key"]').count(),
    appIdVisibleBeforeAdvanced: await page.locator('[data-testid="voice-app-id"]').count(),
    secretKeyTextOnPage: await page.getByText('Secret Key').count(),
    modes: await page.locator('[data-testid^="voice-mode-"]').allInnerTexts(),
  };
  await page.screenshot({ path: `${OUT}/settings-390x844-${scheme}-1.png`, fullPage: true });
  // 桩里的凭据带了自定义极速版地址(本地假服务)→「高级」默认就是展开的
  if (!(await page.locator('[data-testid="voice-advanced"]').count())) await page.locator('[data-testid="voice-advanced-toggle"]').click();
  await page.locator('[data-testid="voice-console-old"]').click();
  rec.appIdVisibleAfterOld = await page.locator('[data-testid="voice-app-id"]').count();
  rec.apiKeyHiddenAfterOld = (await page.locator('[data-testid="voice-api-key"]').count()) === 0;
  await page.screenshot({ path: `${OUT}/settings-390x844-${scheme}-2-advanced-old.png`, fullPage: true });
  console.log(JSON.stringify(rec));
  await ctx.close();
}
await browser.close(); web.close(); flash.close();
