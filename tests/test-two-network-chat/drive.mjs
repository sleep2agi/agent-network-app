// #769 —— 新账号 = 自己的空个人网络(当前网络)+ 被拉进的主网络(Agent 在这)。点列表里主网络的 Agent 发消息:
// 改前 POST /api/task 带个人网络 → 404 alias_not_found(「未送达 · 没有找到这个 Agent」),历史也按个人网络读、空的。
//
// 真应用(expo web 导出)+ Tauri 桥桩,pooled_fetch 走真 HTTP 到本地假 hub(只认主网络里的 Agent,和生产一致)。
//
//   WEB_DIR=<expo export 目录> OUT=<输出目录> [PLAYWRIGHT_MODULE=…] node tests/test-two-network-chat/drive.mjs
//
// 断言:点列表行(不是 setScreen)打开会话 → 历史 GET /api/tasks?to_name=<agent> 带主网络;发一条 → POST /api/task
// 带主网络、气泡不是「未送达」;同时单网络的那个 Agent(在个人网络)仍按个人网络发。
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
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

// ── fake hub (placeholder data only) ──
const PERSONAL = 'net-personal', MAIN = 'net-main';
const MAIN_AGENT = '示例主网络', OWN_AGENT = '示例个人';
const hubTime = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const sessions = [
  { alias: MAIN_AGENT, status: 'idle', agent: 'claude-code', runtime: 'agent-node', updated_at: hubTime(Date.now() - 30_000), network_id: MAIN },
  { alias: OWN_AGENT, status: 'idle', agent: 'claude-code', runtime: 'agent-node', updated_at: hubTime(Date.now() - 60_000), network_id: PERSONAL },
];
const home = { [MAIN_AGENT]: MAIN, [OWN_AGENT]: PERSONAL };
const posts = [], historyReads = [];
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const hub = createServer((req, res) => {
  for (const [k, v] of Object.entries({ 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' })) res.setHeader(k, v);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  let raw = '';
  req.on('data', c => { raw += c; });
  req.on('end', () => {
    if (p === '/api/task' && req.method === 'POST') {
      let body = null; try { body = JSON.parse(raw); } catch {}
      posts.push({ alias: body?.alias, network: body?.network_id });
      // production: an alias is only found in its own network
      if (home[body?.alias] !== body?.network_id) return json(res, 404, { ok: false, error: 'alias_not_found', alias: body?.alias, queued: false });
      return json(res, 200, { ok: true, task_id: `t_new_${Date.now()}`, queued: false });
    }
    if (p === '/api/auth/me') return json(res, 200, { ok: true, user: { user_id: 'u_t', username: 'tester', role: 'user' }, current_network: null,
      networks: [{ network_id: PERSONAL, network_name: 'personal', member_role: 'owner', agent_access: 'all' }, { network_id: MAIN, network_name: 'main', member_role: 'member', agent_access: 'all' }] });
    if (p === '/api/status') return json(res, 200, { ok: true, sessions });
    if (p === '/api/tasks') {
      const to = url.searchParams.get('to_name'), net = url.searchParams.get('network_id');
      if (to) historyReads.push({ alias: to, network: net });
      const tasks = to && home[to] === net ? [{ task_id: `t_hist_${to}`, from_name: 'tester', to_name: to, content: `历史消息 ${to}`, status: 'replied', result: `历史回复 ${to}`, created_at: hubTime(Date.now() - 600_000), updated_at: hubTime(Date.now() - 590_000), network_id: net }] : [];
      return json(res, 200, { ok: true, tasks });
    }
    if (p === '/api/messages') return json(res, 200, { ok: true, messages: [], unread: 0, pending_count: 0 });
    if (p === '/api/nodes') return json(res, 200, { ok: true, nodes: [], count: 0 });
    if (p === '/api/side-threads/capability') return json(res, 200, { ok: true, supported: false });
    if (p.startsWith('/api/events') || p.startsWith('/events')) return json(res, 404, { ok: false });
    return json(res, 200, { ok: true });
  });
}).listen(0, '127.0.0.1');
await new Promise(r => hub.once('listening', r));
const HUB = `http://127.0.0.1:${hub.address().port}`;

const initScript = ({ hubUrl }) => {
  // The fresh account: its saved current network is the empty personal one.
  const profile = { serverUrl: hubUrl, token: 'utok_placeholder', username: 'tester', profileId: 'p-two-net', displayName: 'tester', networkId: 'net-personal' };
  try { localStorage.setItem('anet.language.v1', 'zh'); } catch {}
  const frame = (meta, body) => {
    const m = new TextEncoder().encode(JSON.stringify(meta));
    const out = new Uint8Array(4 + m.length + body.length);
    new DataView(out.buffer).setUint32(0, m.length, false);
    out.set(m, 4); out.set(body, 4 + m.length);
    return out.buffer;
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
    transformCallback: (cb) => { const id = Math.floor(Math.random() * 1e9); window[`_${id}`] = cb; return id; },
    convertFileSrc: (p) => p,
    invoke: async (cmd, args) => {
      switch (cmd) {
        case 'load_active_desktop_profile': return JSON.stringify(profile);
        case 'save_desktop_profile': return args.sessionJson;
        case 'read_desktop_profile_file': return null;
        case 'get_theme_preference': return 'light';
        case 'plugin:event|listen': return 0;
        case 'pooled_fetch': {
          const r = args.request;
          try {
            const res = await fetch(r.url, { method: r.method, headers: r.headers, body: r.data ? new Uint8Array(r.data) : undefined });
            const body = new Uint8Array(await res.arrayBuffer());
            const headers = []; res.headers.forEach((v, k) => headers.push([k, v]));
            return frame({ status: res.status, statusText: res.statusText, url: res.url, headers }, body);
          } catch (e) {
            throw `pooled_fetch/${r.method === 'GET' ? 'not_sent' : 'maybe_sent'}: ${e}`;
          }
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
const browser = await pw.chromium.launch({ headless: true, executablePath: findExe() });
let failures = 0, total = 0;
const ck = (name, cond, detail = '') => { total++; if (!cond) failures++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };

const ctx = await browser.newContext({ viewport: { width: 1200, height: 850 }, colorScheme: 'light', deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('PAGEERROR', e.message.split('\n')[0]));
await page.addInitScript(initScript, { hubUrl: HUB });
await page.goto(`${WEB_URL}?safeAreaSim=0,0,0,0`);

const waitFor = async (pred, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (pred()) return true; await new Promise(r => setTimeout(r, 50)); } return false; };

const openAndSend = async (alias) => {
  // A real click on the list row — the row is what carries the network.
  await page.getByText(alias, { exact: true }).first().click({ timeout: 30000 });
  const input = page.locator(`textarea[placeholder="发消息给 ${alias}…"]`);
  await input.waitFor({ timeout: 15000 });
  await waitFor(() => historyReads.some(h => h.alias === alias), 10000);
  const text = `#769 ${alias} ${Date.now() % 100000}`;
  const before = posts.length;
  await input.click(); await input.fill(text); await page.keyboard.press('Enter');
  await waitFor(() => posts.length > before, 15000);
  await page.waitForTimeout(1500);
  const failed = await page.evaluate(() => document.body.innerText.includes('未送达'));
  const history = await page.evaluate((a) => document.body.innerText.includes(`历史回复 ${a}`), alias);
  return { post: posts[before], reads: historyReads.filter(h => h.alias === alias), failed, history };
};

const main = await openAndSend(MAIN_AGENT);
ck('主网络 Agent:历史按主网络读', main.reads.length > 0 && main.reads.every(h => h.network === MAIN), JSON.stringify(main.reads.map(h => h.network)));
ck('主网络 Agent:历史显示出来了', main.history);
ck('主网络 Agent:POST /api/task 带主网络', main.post?.network === MAIN, `network=${main.post?.network}`);
ck('主网络 Agent:气泡不是「未送达」', !main.failed);
await page.screenshot({ path: join(OUT, 'two-network-chat.png') });

const own = await openAndSend(OWN_AGENT);
ck('个人网络 Agent:历史仍按个人网络读', own.reads.length > 0 && own.reads.every(h => h.network === PERSONAL), JSON.stringify(own.reads.map(h => h.network)));
ck('个人网络 Agent:POST /api/task 仍带个人网络', own.post?.network === PERSONAL, `network=${own.post?.network}`);

await browser.close();
web.close(); hub.close();
console.log(`\n${total - failures}/${total} passed`);
process.exit(failures ? 1 : 0);
