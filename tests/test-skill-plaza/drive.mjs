// Focused #2013 acceptance only: one phone flow, one dedicated desktop window.
// Reuses the established app harness, no Hub or production credentials.
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, openStubWindow, findChromium, ANDROID_UA } from '../test-layout-sweep/harness.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
if (!process.env.WEB_DIR) throw Error('WEB_DIR required');
const out = process.env.OUT || '/tmp/opencode/skill-plaza-evidence';
mkdirSync(out, { recursive: true });
const body = '# Example skill\n\n公开技能，仅供阅读。No installation or execution.';
const hash = createHash('sha256').update(body).digest('hex');
const plazaStub = ({ language, body, hash }) => {
  localStorage.setItem('anet.language.v1', language);
  const inner = window.__TAURI_INTERNALS__, invoke = inner.invoke;
  let rid = 10000;
  const responses = new Map();
  window.__plazaMode = 'ready'; window.__plazaRequests = [];
  inner.invoke = async (cmd, args) => {
    if (cmd === 'plugin:http|fetch' && new URL(args.clientConfig.url).hostname === 'www.anet.sh') {
      const request = args.clientConfig;
      if (request.maxRedirections !== 0) throw Error('public fetch must prohibit redirects');
      window.__plazaRequests.push(request);
      const catalog = request.url.endsWith('/catalog.json');
      const failed = catalog && window.__plazaMode === 'catalog-failure';
      const text = failed ? 'unavailable' : catalog ? JSON.stringify({ skills: [
        { slug: 'example', name: 'Example skill', description: 'Review fixture', version: '1.0', content_sha256: hash, content_url: '/skillhub/example/SKILL.md' },
        { slug: 'second', name: 'Second skill', description: 'Other fixture', content_sha256: hash, content_url: '/skillhub/second/SKILL.md' },
      ] }) : window.__plazaMode === 'mismatch' ? 'unverified content must never appear' : body;
      const id = ++rid;
      responses.set(id, { status: failed ? 503 : 200, statusText: failed ? 'Unavailable' : 'OK', url: request.url,
        headers: [], data: new TextEncoder().encode(text), sent: false });
      return id;
    }
    if (cmd === 'plugin:http|fetch_send' && responses.has(args.rid)) {
      const { status, statusText, url, headers } = responses.get(args.rid);
      return { status, statusText, url, headers, rid: args.rid };
    }
    if (cmd === 'plugin:http|fetch_read_body' && responses.has(args.rid)) {
      const response = responses.get(args.rid);
      if (response.sent) { responses.delete(args.rid); return [1]; }
      response.sent = true;
      return [...response.data, 0];
    }
    if (cmd === 'plugin:http|fetch_cancel_body' && responses.has(args.rid)) {
      responses.delete(args.rid);
      return;
    }
    return invoke(cmd, args);
  };
};
const web = await serveExport(process.env.WEB_DIR);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || findChromium() });
let passed = 0;
function ck(name, ok) { if (!ok) throw Error(name); passed++; console.log(`PASS ${name}`); }
try {
  for (const phone of [true, false]) {
    const language = phone ? 'zh' : 'en', theme = phone ? 'light' : 'dark';
    const context = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1200, height: 800 },
      ...(phone ? { userAgent: ANDROID_UA } : {}), locale: phone ? 'zh-CN' : 'en-US', colorScheme: theme });
    const scripts = [[initScript, { theme }], [plazaStub, { language, body, hash }]];
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    for (const [fn, args] of scripts) await page.addInitScript(fn, args);
    await page.goto(`${web.url}?safeAreaSim=${phone ? '32,0,24,0' : '0,0,0,0'}`);
    let win = page;
    if (phone) {
      await page.getByText('示例-A', { exact: true }).first().waitFor();
      await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'settings' }));
      await page.locator('[data-testid="settings-row-skillPlaza"]').click();
    } else {
      await page.locator('[data-testid="desktop-rail"]').waitFor();
      await page.getByRole('tab', { name: 'Settings', exact: true }).click();
      win = await openStubWindow(page, 'settings', scripts);
      ck('desktop opens a separate settings window', !!win);
      win.on('pageerror', e => errors.push(String(e)));
      await win.setViewportSize({ width: 960, height: 720 });
      await win.locator('[data-testid="settings-sidebar"]').getByText('Skill plaza', { exact: true }).click();
    }
    await win.locator('[data-testid="skill-plaza-row-example"]').waitFor();
    await win.locator('[data-testid="skill-plaza-search"]').fill('Review');
    ck(`${language} search filters`, await win.locator('[data-testid="skill-plaza-row-second"]').count() === 0);
    await win.locator('[data-testid="skill-plaza-row-example"]').click();
    await win.locator('[data-testid="skill-plaza-body"]').waitFor();
    ck(`${language} verified plain text content`, await win.locator('[data-testid="skill-plaza-body"]').innerText() === body);
    await win.screenshot({ path: `${out}/${phone ? 'phone' : 'desktop'}-detail.png` });
    if (phone) await win.locator('[data-testid="settings-back"]').click();
    else await win.locator('[data-testid="skill-plaza-back"]').click();
    await win.locator('[data-testid="skill-plaza-row-example"]').waitFor();
    ck(`${language} back preserves search`, await win.locator('[data-testid="skill-plaza-search"]').inputValue() === 'Review');
    await win.screenshot({ path: `${out}/${phone ? 'phone' : 'desktop'}-catalogue.png` });
    if (phone) {
      await win.locator('[data-testid="settings-back"]').click();
      await win.evaluate(() => { window.__plazaMode = 'catalog-failure'; });
      await win.locator('[data-testid="settings-row-skillPlaza"]').click();
      const retry = win.locator('[data-testid="skill-plaza-retry"]');
      await retry.waitFor();
      ck('catalogue HTTP failure is visible', (await retry.innerText()).includes('HTTP 503'));
      await win.evaluate(() => { window.__plazaMode = 'mismatch'; });
      await retry.click();
      await win.locator('[data-testid="skill-plaza-row-example"]').click();
      await retry.waitFor();
      ck('mismatch refuses content visibly', (await retry.innerText()).includes('拒绝打开') && await win.locator('[data-testid="skill-plaza-body"]').count() === 0);
      await win.evaluate(() => { window.__plazaMode = 'ready'; });
      await retry.click();
      await win.locator('[data-testid="skill-plaza-body"]').waitFor();
      await win.setViewportSize({ width: 900, height: 390 });
      await win.locator('[data-testid="settings-sidebar"]').waitFor();
      await win.setViewportSize({ width: 390, height: 844 });
      await win.locator('[data-testid="skill-plaza-row-example"]').waitFor();
      await win.locator('[data-testid="settings-subpage-title"]').filter({ hasText: '技能广场' }).waitFor();
      ck('phone rotation reconciles lost selection with catalogue header', await win.locator('[data-testid="skill-plaza-body"]').count() === 0);
      await win.locator('[data-testid="settings-back"]').click();
      await win.locator('[data-testid="settings-row-skillPlaza"]').waitFor();
      ck('one Back after rotation leaves catalogue, no phantom detail', true);
    }
    ck(`${language} no public request carries Hub authorization`, await win.evaluate(() => window.__plazaRequests.every(r => !r.headers.some(([key]) => key.toLowerCase() === 'authorization'))));
    ck(`${language} no page errors`, errors.length === 0);
    await context.close();
  }
  console.log(`RESULT: PASS ${passed} focused assertions; synthetic transport, not native binaries`);
} finally { await browser.close(); web.close(); }
