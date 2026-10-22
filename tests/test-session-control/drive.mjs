// #2014 only: two viewports, actual Web bundle and synthetic Hub transport.
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium, ANDROID_UA } from '../test-layout-sweep/harness.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
if (!process.env.WEB_DIR) throw Error('WEB_DIR required');
const out = process.env.OUT || '/tmp/opencode/2014-ui-evidence';
mkdirSync(out, { recursive: true });
const stub = ({ language }) => {
  localStorage.setItem('anet.language.v1', language);
  window.__controlMode = 'ready'; window.__controlRequests = []; window.__controlOperations = {};
  const session = { alias: '示例-A', node_id: 'n_sweep_a', network_id: 'net-sweep', session_id: 'ses_Browser2014',
    status: 'working', agent: 'agent-node:opencode', runtime: 'opencode', model: 'fixture/model', hostname: 'host-a', updated_at: new Date().toISOString() };
  window.__routeOverride = (url, bodyText, method) => {
    const path = url.pathname;
    if (path === '/api/status') {
      if (url.searchParams.get('light') === '1') { const { node_id, session_id, ...light } = session; return { ok: true, sessions: [light] }; }
      return { ok: true, sessions: [session] };
    }
    if (path === '/api/nodes') return { ok: true, nodes: [{ ...session, lifecycle_state: 'running', lifecycle_controllable: false }] };
    if (path === '/api/node-session-control' && method === 'POST') {
      const body = JSON.parse(bodyText); window.__controlRequests.push(body);
      if (window.__controlMode === 'unsupported') return null;
      const request_id = `bg_${Date.now()}_browser2014${window.__controlRequests.length}`;
      window.__controlOperations[request_id] = body.operation;
      return { ok: true, request_id, status: 'pending', expires_at: Date.now() + 15_000 };
    }
    if (path.startsWith('/api/node-session-control/')) {
      const request_id = decodeURIComponent(path.split('/').pop());
      const state = { session_id: session.session_id, binding_id: 'browser-generation-2014', supported: true,
        active: window.__controlMode !== 'idle', can_request_background: window.__controlMode !== 'idle', observed_at: Date.now() };
      const op = window.__controlOperations[request_id];
      if (op === 'background' && window.__controlMode === 'unknown') return { ok: true, request_id, status: 'unknown' };
      return { ok: true, request_id, status: 'done', result: op === 'background' ? { outcome: state.active ? 'request_processed' : 'already_idle', state } : state };
    }
  };
};
const web = await serveExport(process.env.WEB_DIR);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || findChromium() });
let pass = 0;
const ck = (name, condition) => { if (!condition) throw Error(name); pass++; console.log(`PASS ${name}`); };
try {
  for (const phone of [true, false]) {
    const language = phone ? 'zh' : 'en';
    const context = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1200, height: 800 },
      ...(phone ? { userAgent: ANDROID_UA } : {}), locale: phone ? 'zh-CN' : 'en-US', colorScheme: phone ? 'light' : 'dark' });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.addInitScript(initScript, { theme: phone ? 'light' : 'dark' });
    await page.addInitScript(stub, { language });
    await page.goto(`${web.url}?safeAreaSim=${phone ? '32,0,24,0' : '0,0,0,0'}`);
    await page.waitForFunction(() => !!window.__anetLayoutSweep);
    await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'chat', alias: '示例-A', networkId: 'net-sweep' }));
    const panel = page.locator('[data-testid="node-session-control"]');
    await panel.waitFor();
    ck(`${language} chat uses full scoped identity, not narrow light rows`, await panel.count() === 1);
    ck(`${language} no control request before explicit read`, await page.evaluate(() => window.__controlRequests.length) === 0);
    const background = panel.locator('[data-testid="session-control-background"]'), refresh = panel.locator('[data-testid="session-control-refresh"]');
    ck(`${language} no capability means disabled`, await background.isDisabled());
    await refresh.click(); await background.waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('[data-testid="session-control-background"]')?.getAttribute('aria-disabled') !== 'true');
    ck(`${language} active supported session enables control`, await background.isEnabled());
    await background.click();
    await panel.locator('[data-testid="session-control-notice"]').getByText(phone ? '请求已处理；不代表一定有工具转到后台。' : 'Request processed; this does not prove a tool moved to the background.', { exact: true }).waitFor();
    ck(`${language} processed receipt is not a false success`, true);
    ck(`${language} only original network/node/binding is sent`, await page.evaluate(() => window.__controlRequests.every(r => r.node_id === 'n_sweep_a' && r.network_id === 'net-sweep' && (!r.expected || r.expected.session_id === 'ses_Browser2014'))));
    await page.evaluate(() => { window.__controlMode = 'unknown'; });
    await background.click();
    await panel.locator('[data-testid="session-control-notice"]').getByText(phone ? /未自动重试/ : /was not retried/).waitFor();
    ck(`${language} unknown blocks another mutation`, await background.isDisabled());
    const before = await page.evaluate(() => window.__controlRequests.filter(r => r.operation === 'background').length);
    await refresh.click();
    await panel.locator('[data-testid="session-control-status"]').waitFor();
    ck(`${language} read-only refresh cannot unlock unknown or resend`, await background.isDisabled() && before === await page.evaluate(() => window.__controlRequests.filter(r => r.operation === 'background').length));
    await page.screenshot({ path: `${out}/${phone ? 'phone' : 'desktop'}-unknown.png` });
    await page.evaluate(() => { window.__controlMode = 'unsupported'; window.__anetLayoutSweep.setScreen({ name: 'nodeDetail', alias: '示例-A' }); });
    await panel.waitFor(); await page.locator('[data-testid="session-control-refresh"]').click();
    await panel.locator('[data-testid="session-control-notice"]').getByText(phone ? /尚不支持此控制/ : /does not support this control/).waitFor();
    ck(`${language} old Hub refusal visible on node overview`, await panel.locator('[data-testid="session-control-background"]').isDisabled());
    ck(`${language} no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    ck(`${language} no page errors`, errors.length === 0);
    await context.close();
  }
  console.log(`RESULT: PASS ${pass} targeted assertions; fixture transport, not native binaries or real OpenCode`);
} finally { await browser.close(); web.close(); }
