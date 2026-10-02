// 状态读的条件 GET(board #467,#431 的 app 那一半):hub ≥ .88 的 GET /api/status 带 ETag,app 下次带
// If-None-Match,hub 回 304(空体)就用上次的正文 —— 列表照常显示;数据变了 hub 回 200,列表跟着变。
// Placeholder data only, served in-page by the Tauri stub in tests/test-layout-sweep/harness.mjs (window.__statusEtag
// makes the stub answer /api/status like the new hub; no hub process, no port, no HOME touched).
// Not in CI: needs Playwright + Chromium and a web export.
//
//   WEB_DIR=<expo export dir> [OUT=<png dir>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] node tests/test-status-etag/drive.mjs
//
// desktop 1440×900 和 phone 390×844(安卓 UA),各一个干净的浏览器上下文:
//   inm       第一次状态读不带 If-None-Match;之后的读带上一次的 ETag,至少有一次 304
//   kept      304 之后列表还在(三个示例节点都画着),不是空白
//   changed   改一个节点的进度 ⇒ 下一次读回 200(新 ETag)⇒ 列表上出现新进度
//   bytes     304 的读 0 字节正文;打印全程节省的字节
// Exit 1 on any failure.
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium, ANDROID_UA } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
if (OUT) mkdirSync(OUT, { recursive: true });

const fixture = () => {
  window.__statusEtag = true;
  const iso = (m) => new Date(Date.now() - m * 60000).toISOString();
  window.__driveSessions = [
    { alias: '示例-A', status: 'idle', agent: 'claude-code', runtime: 'claude-code', task: null, server: 'host-a', updated_at: iso(1), network_id: 'net-sweep' },
    { alias: '示例-B', status: 'working', agent: 'codex', runtime: 'codex', task: '示例进度第一版', server: 'host-b', updated_at: iso(2), network_id: 'net-sweep' },
    { alias: '示例-C', status: 'offline', agent: 'grok', runtime: 'grok', task: null, server: 'host-c', updated_at: iso(90), network_id: 'net-sweep' },
  ];
  window.__routeOverride = (u) => (u.pathname === '/api/status' ? { ok: true, sessions: window.__driveSessions, summary: { total: 3 } } : undefined);
};

let failures = 0, rows = 0;
const record = (where, what, checks, extra = {}) => {
  const ok = Object.values(checks).every(Boolean);
  rows++; if (!ok) failures++;
  console.log(JSON.stringify({ where, what, ok, failed: Object.keys(checks).filter(k => !checks[k]).join(',') || '-', ...extra }));
};

const VIEWPORTS = { desktop: { w: 1440, h: 900 }, phone: { w: 390, h: 844, ua: ANDROID_UA } };
const web = await serveExport(WEB);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
for (const [name, V] of Object.entries(VIEWPORTS)) {
  const ctx = await browser.newContext({ viewport: { width: V.w, height: V.h }, ...(V.ua ? { userAgent: V.ua, hasTouch: true } : {}), deviceScaleFactor: 1, locale: 'zh-CN' });
  const page = await ctx.newPage();
  const reads = () => page.evaluate(() => window.__statusReads || []);
  const visible = (text) => page.getByText(text, { exact: false }).first().isVisible().catch(() => false);
  try {
    await page.addInitScript(fixture);
    await page.addInitScript(initScript, { theme: 'light' });
    await page.addInitScript(() => { try { localStorage.setItem('anet.language.v1', 'zh'); } catch {} });
    await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
    await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 20000 });
    // Agent list polls /api/status?light=1 every 10 s: wait for a few rounds.
    await page.waitForFunction(() => (window.__statusReads || []).filter(r => r.url.includes('light=1')).length >= 3, null, { timeout: 45000 }).catch(() => {});
    const light = (await reads()).filter(r => r.url.includes('light=1'));
    const after304 = light.findIndex(r => r.status === 304);
    if (OUT) await page.screenshot({ path: `${OUT}/${name}-after-304.png` });
    const kept = (await visible('示例-A')) && (await visible('示例-B')) && (await visible('示例进度第一版'));
    record(name, 'inm + 304 + list kept', {
      firstPlain: light[0]?.inm === null,
      laterConditional: light.slice(1).length > 0 && light.slice(1).every(r => r.inm !== null),
      got304: after304 > 0,
      kept,
    }, { reads: light.map(r => `${r.status}${r.inm ? '(inm)' : ''}`).join(' ') });

    await page.evaluate(() => { window.__driveSessions[1].task = '示例进度第二版'; });
    const n0 = (await reads()).length;
    await page.waitForFunction((n) => (window.__statusReads || []).slice(n).some(r => r.url.includes('light=1') && r.status === 200), n0, { timeout: 25000 }).catch(() => {});
    await page.getByText('示例进度第二版').first().waitFor({ timeout: 5000 }).catch(() => {});
    const changed = await visible('示例进度第二版');
    if (OUT) await page.screenshot({ path: `${OUT}/${name}-changed.png` });
    const all = await reads();
    const saved = all.filter(r => r.status === 304).length;
    record(name, 'changed data → 200 → list updates', { changed, noStale: !(await visible('示例进度第一版')) }, { reads304: saved, readsTotal: all.length, bodyBytesSent: all.reduce((a, r) => a + r.bytes, 0) });
  } catch (e) {
    record(name, 'run', { ran: false }, { error: String(e).split('\n')[0] });
  }
  await ctx.close();
}
await browser.close();
web.close();
console.log(`\n${rows - failures}/${rows} rows passed`);
process.exit(failures ? 1 : 0);
