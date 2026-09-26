// 微信式输入行(＋ 在右、＋⇄发送、⤢ 全屏编辑)—— 真应用(expo web 导出 + Tauri 桥桩)截图。不进 CI:要 Playwright + Chromium + 一个一次性 hub。
//
//   HUB_URL=http://127.0.0.1:<非 9200 端口> HUB_TOKEN=utok_… ALIAS=<会话别名> WEB_DIR=<expo export 目录> OUT=<截图目录> \
//   PLAYWRIGHT_MODULE=<…/playwright/index.mjs> node tests/test-composer-wechat-visual/drive.mjs
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
const PHONE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36';
const out = [];
const box = async (page, sel) => { const l = page.locator(sel); return (await l.count()) ? await l.first().boundingBox() : null; };
for (const [w, h, name, ua] of [[390, 844, 'phone', PHONE_UA], [1200, 850, 'twopane', ANDROID_UA]]) {
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, userAgent: ua });
    const page = await ctx.newPage();
    page.on('pageerror', e => console.log('PAGEERROR', e.message.split('\n')[0]));
    await page.addInitScript(initScript, { hubUrl: HUB_URL, token: TOKEN, flashUrl: FLASH_URL, theme: scheme });
    await page.goto(WEB_URL);
    await page.getByText(ALIAS, { exact: true }).first().click({ timeout: 20000 });
    const input = page.locator('textarea[placeholder="Message ' + ALIAS + '…"]');
    await input.waitFor({ timeout: 15000 });
    await page.waitForTimeout(600);
    const tag = 'composer-' + name + '-' + w + 'x' + h + '-' + scheme;
    const rec = { tag };
    // 1 empty
    rec.empty = { plus: await page.locator('[data-testid="composer-plus"]').count(), send: await page.locator('[data-testid="composer-send"]').count(), expand: await page.locator('[data-testid="composer-expand"]').count() };
    const t = await box(page, '[data-testid="composer-mode-toggle"]'), i = await box(page, 'textarea[placeholder="Message ' + ALIAS + '…"]'), p = await box(page, '[data-testid="composer-plus"]');
    rec.empty.order = t && i && p ? (t.x < i.x && i.x + i.width <= p.x ? 'toggle|input|plus' : 'WRONG') : 'missing';
    await page.screenshot({ path: OUT + '/' + tag + '-1-empty.png' });
    // 1b whitespace-only
    await input.fill('   ');
    await page.waitForTimeout(250);
    rec.whitespace = { plus: await page.locator('[data-testid="composer-plus"]').count(), send: await page.locator('[data-testid="composer-send"]').count() };
    // 2 typed
    await input.fill('你好，帮我看一下示例项目');
    await page.waitForTimeout(400);
    rec.typed = { plus: await page.locator('[data-testid="composer-plus"]').count(), send: await page.locator('[data-testid="composer-send"]').count(), sendText: (await page.locator('[data-testid="composer-send"]').innerText().catch(() => '')).trim(), expand: await page.locator('[data-testid="composer-expand"]').count() };
    await page.screenshot({ path: OUT + '/' + tag + '-2-typed.png' });
    // 3-line: no expand yet
    await input.fill('第一行\n第二行\n第三行');
    await page.waitForTimeout(300);
    rec.threeLines = { expand: await page.locator('[data-testid="composer-expand"]').count() };
    // 3 multi-line
    await input.fill('示例长消息第一行\n第二行：检查构建日志\n第三行：对比上一次成功的提交\n第四行：列出失败的测试\n第五行：给出修复建议');
    await page.waitForTimeout(400);
    rec.multi = { expand: await page.locator('[data-testid="composer-expand"]').count() };
    const e = await box(page, '[data-testid="composer-expand"]'), i2 = await box(page, 'textarea[placeholder="Message ' + ALIAS + '…"]'), t2 = await box(page, '[data-testid="composer-mode-toggle"]');
    rec.multi.expandTopLeft = !!(e && i2 && t2 && e.x + e.width <= i2.x + 1 && e.y < t2.y && e.y <= i2.y + 12);
    await page.screenshot({ path: OUT + '/' + tag + '-3-multiline-expand.png' });
    // 4 fullscreen editor
    await page.locator('[data-testid="composer-expand"]').click();
    await page.locator('[data-testid="composer-fullscreen-editor"]').waitFor({ timeout: 5000 });
    await page.waitForTimeout(500);
    rec.editor = { sameDraft: (await page.locator('[data-testid="composer-fullscreen-input"]').inputValue()).startsWith('示例长消息第一行') };
    await page.locator('[data-testid="composer-fullscreen-input"]').fill('示例长消息第一行（全屏里改过）\n第二行\n第三行\n第四行\n第五行');
    await page.screenshot({ path: OUT + '/' + tag + '-4-fullscreen-editor.png' });
    // Esc → onRequestClose (RNW routes Esc there; Android back takes the same prop)
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    rec.editor.closedByEsc = (await page.locator('[data-testid="composer-fullscreen-editor"]').count()) === 0;
    rec.editor.draftKeptAfterClose = (await input.inputValue()).includes('全屏里改过');
    // collapse button
    await page.locator('[data-testid="composer-expand"]').click();
    await page.locator('[data-testid="composer-fullscreen-collapse"]').click();
    await page.waitForTimeout(600);
    rec.editor.closedByCollapse = (await page.locator('[data-testid="composer-fullscreen-editor"]').count()) === 0;
    // 5 voice mode
    await input.fill('');
    await page.waitForTimeout(200);
    await page.locator('[data-testid="composer-mode-toggle"]').click();
    await page.locator('[data-testid="voice-hold-bar"]').waitFor({ timeout: 5000 });
    await page.waitForTimeout(300);
    const bar = await box(page, '[data-testid="voice-hold-bar"]'), p3 = await box(page, '[data-testid="composer-plus"]');
    rec.voice = { plus: await page.locator('[data-testid="composer-plus"]').count(), send: await page.locator('[data-testid="composer-send"]').count(), barWidth: bar && Math.round(bar.width), barBeforePlus: !!(bar && p3 && bar.x + bar.width <= p3.x) };
    await page.screenshot({ path: OUT + '/' + tag + '-5-voice.png' });
    // 6 ＋ panel from voice mode
    await page.locator('[data-testid="composer-plus"]').click();
    await page.waitForTimeout(400);
    rec.voice.panelOpens = (await page.locator('[aria-label="更多发送方式面板"]').count()) === 1;
    await page.screenshot({ path: OUT + '/' + tag + '-6-plus-panel.png' });
    // restore keyboard pref for next context
    out.push(rec);
    console.log(JSON.stringify(rec));
    await ctx.close();
  }
}
await browser.close(); web.close(); flash.close();
