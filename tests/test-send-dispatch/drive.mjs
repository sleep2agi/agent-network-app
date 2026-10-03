// #518 发送派发延迟 + 后台请求是否随使用时长堆积(owner 2026-10-03:「为什么现在发消息都需要发那么久?」)。
//
// 真应用(expo web 导出)+ Tauri 桥桩,桥桩的 pooled_fetch 走**真的 HTTP** 到一个本地假 hub(随机端口,每个请求
// 加 LATENCY_MS 延迟,模拟中国 → 美国一次往返)。不碰生产 hub、不碰 HOME。
//
//   WEB_DIR=<expo export 目录> OUT=<输出目录> [PLAYWRIGHT_MODULE=…] [BROWSER=chromium|webkit] [LATENCY_MS=250]
//   [CHURN=60] node tests/test-send-dispatch/drive.mjs
//
// 量什么:
//   dispatch_ms = 假 hub 收到 POST /api/task 的时刻 − 该条 dreq id 里的生成时刻(同一台机器同一个钟,没有钟差)。
//   bubble_ms   = 点发送 → 气泡不再是「发送中…」。
//   后台:翻页 CHURN 次(会话 A / B / 任务 / 列表 来回切)前后,活跃 setInterval 数、在路上的请求数、每秒请求数。
//
// 断言(退出码 1 = 任一失败):
//   1 热身后每次发送 dispatch < 500 ms(翻页前、翻页后都要)
//   2 热身后每次发送只发 1 个请求(POST /api/task;不再先查 /api/auth/me)
//   3 气泡在 POST 回来后立即变「已送达」:bubble_ms < 2×LATENCY_MS + 600
//   4 翻页 CHURN 次之后:活跃 interval 数不超过翻页前 + 2,在路上的请求峰值 ≤ 12,每秒请求数不超过翻页前 ×1.5 + 2
//   5 「发送中…」卡死(#518):假 hub 的 POST /api/task 依次 (a) 中途断连 (b) 收下不回 (c) 502 (d) 回了头、正文卡住
//     (走 plugin:http,设置 → 连接复用 关) (e) 收下不回 + 发出后立刻切到别的会话、等它失败后再切回 ——
//     每一种气泡都在上限内变「未送达 · 点击重试」;hub 恢复后点重试,发出的是同一个 client_request_id。
//     改前(origin/main fccf51d)(d)(e) 红:气泡永远「发送中…」。
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';

const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR, OUT = process.env.OUT;
if (!WEB || !OUT) throw new Error('need WEB_DIR OUT');
mkdirSync(OUT, { recursive: true });
const LATENCY = Number(process.env.LATENCY_MS ?? 250);
const CHURN = Number(process.env.CHURN ?? 60);
const BROWSER = process.env.BROWSER || 'chromium';

// ── static web export ──
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
const ALIASES = Array.from({ length: Number(process.env.N_SESSIONS ?? 60) }, (_, i) => `示例-${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26) || ''}`);
const A = ALIASES[0], B = ALIASES[1];
const NET = 'net-demo';
const isoAgo = (s) => new Date(Date.now() - s * 1000).toISOString();
const hubTime = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const sessions = ALIASES.map((alias, i) => ({ alias, status: i % 3 ? 'idle' : 'working', agent: 'claude-code', runtime: 'agent-node', node_id: `n_demo_${i}`, hostname: `host-${i}`, project_dir: `/work/demo-${i}`, version: '0.0.0', updated_at: isoAgo(30 + i), network_id: NET }));
const tasksFor = (alias) => Array.from({ length: 50 }, (_, i) => ({
  task_id: `t_${alias}_${i}`, from_name: 'tester', to_name: alias, content: `历史消息 ${i} `.repeat(4), status: 'replied',
  result: `回复 ${i} `.repeat(6), created_at: hubTime(Date.now() - (i + 1) * 600_000), updated_at: hubTime(Date.now() - (i + 1) * 590_000), network_id: NET,
}));
const N_REQ = Number(process.env.N_REQUIREMENTS ?? 0);
const requirements = Array.from({ length: N_REQ }, (_, i) => ({ id: `req_${i}`, requirement_id: `req_${i}`, short_id: i + 1, title: `示例任务 ${i}`, description: `描述 ${i} `.repeat(20), status: ['todo', 'doing', 'done'][i % 3], priority: 'normal', owner: 'tester', created_at: hubTime(Date.now() - i * 3600_000), updated_at: hubTime(Date.now() - i * 60_000), network_id: NET, tags: [], participants: [] }));
const N_MSG = Number(process.env.N_MESSAGES ?? 0);
const userMessages = Array.from({ length: N_MSG }, (_, i) => ({ message_id: `m_${i}`, from: ALIASES[i % ALIASES.length], to: 'tester', content: `主动消息 ${i} `.repeat(8), created_at: hubTime(Date.now() - i * 120_000), acked: 1 }));
const sent = []; // { at, dreqAt, requestId, alias }
const reqLog = []; // { path, method, start, end }
let inflight = 0, peakInflight = 0;
let taskMode = 'ok'; // POST /api/task behaviour: ok | drop | hang | 502 | hang-body
const hung = [];
const json = (res, status, body, extra = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', date: new Date().toUTCString(), ...extra });
  res.end(JSON.stringify(body));
};
const hub = createServer((req, res) => {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'access-control-expose-headers': 'etag,date' };
  for (const [k, v] of Object.entries(cors)) res.setHeader(k, v);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const start = Date.now();
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  let raw = '';
  req.on('data', c => { raw += c; });
  req.on('end', () => {
    if (p === '/api/task' && req.method === 'POST') {
      let body = null; try { body = JSON.parse(raw); } catch {}
      const rid = body?.meta?.client_request_id ?? '';
      const m = /^dreq_([a-f0-9]{12})/.exec(rid);
      sent.push({ at: start, dreqAt: m ? parseInt(m[1], 16) : null, requestId: rid, alias: body?.alias, hadFrom: !!body?.from, network: body?.network_id });
    }
    if (p === '/api/task' && req.method === 'POST' && taskMode !== 'ok') {
      const mode = taskMode;
      reqLog.push({ path: p, method: req.method, start, end: Date.now(), mode });
      if (mode === 'drop') { req.socket.destroy(); return; }                 // (a) connection dropped mid-request
      if (mode === 'hang') { hung.push(res); return; }                         // (b) accepted, never answers
      if (mode === '502') { res.writeHead(502, { 'content-type': 'text/html' }); res.end('<html>502 Bad Gateway</html>'); return; } // (c) proxy during restart
      if (mode === 'hang-body') { res.writeHead(200, { 'content-type': 'application/json', 'content-length': '64' }); res.write('{"ok":'); hung.push(res); return; } // headers, then the body stalls
    }
    inflight++; peakInflight = Math.max(peakInflight, inflight);
    setTimeout(() => {
      inflight--;
      reqLog.push({ path: p, method: req.method, start, end: Date.now() });
      if (p === '/api/task' && req.method === 'POST') return json(res, 200, { ok: true, task_id: `t_new_${Date.now()}`, queued: false });
      if (p === '/api/auth/me') return json(res, 200, { ok: true, user: { username: 'tester' }, current_network: NET, networks: [{ network_id: NET, name: 'demo' }] });
      if (p === '/api/status' || p === '/api/requirements') {
        // ETag + 304 like hub ≥ .88 (#2247) / ≥ .75, so the app's conditional-GET path (#467) is exercised.
        const body = p === '/api/status' ? { ok: true, sessions, files_capable: true } : { ok: true, requirements, projects: [] };
        const etag = `W/"${p}-v1"`;
        if (req.headers['if-none-match'] === etag) { res.writeHead(304, { etag, date: new Date().toUTCString() }); res.end(); return; }
        return json(res, 200, body, { etag });
      }
      if (p === '/api/tasks') return json(res, 200, { ok: true, tasks: tasksFor(url.searchParams.get('to_name') || A) });
      if (p === '/api/messages') return json(res, 200, { ok: true, messages: userMessages, unread: 0, pending_count: 0 });
      if (p === '/api/requirements') return json(res, 200, { ok: true, requirements, projects: [] });
      if (p === '/api/nodes') return json(res, 200, { ok: true, nodes: [], count: 0 });
      if (p === '/api/side-threads/capability') return json(res, 200, { ok: true, supported: false });
      if (p.startsWith('/api/events') || p.startsWith('/events')) return json(res, 404, { ok: false });
      return json(res, 200, { ok: true });
    }, LATENCY);
  });
}).listen(0, '127.0.0.1');
await new Promise(r => hub.once('listening', r));
const HUB = `http://127.0.0.1:${hub.address().port}`;

const initScript = ({ hubUrl }) => {
  const profile = { serverUrl: hubUrl, token: 'utok_placeholder', username: 'tester', profileId: 'p-dispatch', displayName: 'tester', networkId: 'net-demo' };
  try { localStorage.setItem('anet.language.v1', 'zh'); } catch {}
  // live interval / timeout accounting
  const ivs = new Set();
  const si = window.setInterval.bind(window), ci = window.clearInterval.bind(window);
  window.setInterval = (fn, ms, ...a) => { const id = si(fn, ms, ...a); ivs.add(id); return id; };
  window.clearInterval = (id) => { ivs.delete(id); return ci(id); };
  window.__activeIntervals = () => ivs.size;
  // main-thread lag probe (uses the unwrapped setInterval so it is not counted)
  window.__maxLag = 0; let last = performance.now();
  si(() => { const now = performance.now(); window.__maxLag = Math.max(window.__maxLag, now - last - 50); last = now; }, 50);
  window.__inflight = 0; window.__peakInflight = 0; window.__reqs = 0;
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
      window.__invokes = window.__invokes || {};
      const k = cmd === 'write_desktop_profile_file' ? `${cmd}:${args.relativePath}` : cmd;
      const e = (window.__invokes[k] = window.__invokes[k] || { n: 0, bytes: 0 });
      e.n++; e.bytes += cmd === 'write_desktop_profile_file' ? (args.contents?.length ?? 0) : 0;
      switch (cmd) {
        case 'load_active_desktop_profile': return JSON.stringify(profile);
        case 'save_desktop_profile': return args.sessionJson;
        case 'read_desktop_profile_file': return null;
        case 'get_theme_preference': return 'light';
        case 'plugin:event|listen': return 0;
        case 'pooled_fetch': {
          // Same contract as src-tauri/src/hub_http.rs: real HTTP, whole body, framed. No cancellation (the Rust
          // side keeps going after the JS side gives up, exactly like the real command).
          const r = args.request;
          window.__inflight++; window.__reqs++; window.__peakInflight = Math.max(window.__peakInflight, window.__inflight);
          try {
            const res = await fetch(r.url, { method: r.method, headers: r.headers, body: r.data ? new Uint8Array(r.data) : undefined });
            const body = new Uint8Array(await res.arrayBuffer());
            const headers = []; res.headers.forEach((v, k) => headers.push([k, v]));
            return frame({ status: res.status, statusText: res.statusText, url: res.url, headers }, body);
          } catch (e) {
            throw `pooled_fetch/${r.method === 'GET' ? 'not_sent' : 'maybe_sent'}: ${e}`;
          } finally { window.__inflight--; }
        }
        // tauri-plugin-http (the fallback when 设置 → 连接复用 is off): a real streaming fetch, cancel honoured
        // like the Rust plugin (fetch_cancel aborts the request; the body stream errors on abort).
        case 'plugin:http|fetch': {
          const id = ++window.__rid; const ctrl = new AbortController();
          const c = args.clientConfig;
          window.__plugin.set(id, { ctrl, p: fetch(c.url, { method: c.method, headers: c.headers, body: c.data ? new Uint8Array(c.data) : undefined, signal: ctrl.signal }) });
          return id;
        }
        case 'plugin:http|fetch_cancel': { window.__plugin.get(args.rid)?.ctrl.abort(); return null; }
        case 'plugin:http|fetch_send': {
          const r = window.__plugin.get(args.rid);
          const res = await r.p.catch(e => { throw String(e?.message ?? e); });
          const id = ++window.__rid; window.__plugin.set(id, { ctrl: r.ctrl, reader: res.body ? res.body.getReader() : null });
          const headers = []; res.headers.forEach((v, k) => headers.push([k, v]));
          return { status: res.status, statusText: res.statusText, url: res.url, headers, rid: id };
        }
        case 'plugin:http|fetch_read_body': {
          const b = window.__plugin.get(args.rid);
          if (!b?.reader) return [1];
          const { done, value } = await b.reader.read();
          return done ? [1] : [...value, 0];
        }
        case 'plugin:http|fetch_cancel_body': { window.__plugin.get(args.rid)?.ctrl.abort(); return null; }
        default: return null;
      }
    },
  };
  window.__rid = 0; window.__plugin = new Map();
};

const findExe = () => {
  if (BROWSER !== 'chromium') return undefined;
  const base = `${process.env.HOME}/.cache/ms-playwright`;
  for (const d of ['chromium-1234', 'chromium-1217', 'chromium-1208']) for (const p of [`${base}/${d}/chrome-linux64/chrome`, `${base}/${d}/chrome-linux/chrome`]) if (existsSync(p)) return p;
  return undefined;
};
const browser = await pw[BROWSER].launch({ headless: true, executablePath: findExe() });
let failures = 0, total = 0;
const ck = (name, cond, detail = '') => { total++; if (!cond) failures++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };

const ctx = await browser.newContext({ viewport: { width: 1200, height: 850 }, colorScheme: 'light', deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('PAGEERROR', e.message.split('\n')[0]));
await page.addInitScript(initScript, { hubUrl: HUB });
await page.goto(`${WEB_URL}?safeAreaSim=0,0,0,0`);
await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 30000 });

const openChat = async (alias) => {
  await page.evaluate((a) => window.__anetLayoutSweep.setScreen({ name: 'chat', alias: a }), alias);
  const input = page.locator(`textarea[placeholder="发消息给 ${alias}…"]`);
  await input.waitFor({ timeout: 15000 });
  return input;
};
const sendOne = async (input, text) => {
  const before = sent.length;
  await input.click();
  await input.fill(text);
  const clickAt = Date.now();
  await page.keyboard.press('Enter');
  // bubble: the echo with this text exists and no 「发送中…」 is left on it
  const flipped = await page.waitForFunction((t) => {
    const nodes = [...document.querySelectorAll('div')].filter(d => d.textContent === t);
    if (!nodes.length) return false;
    return !document.body.innerText.includes('发送中…');
  }, text, { timeout: 30000, polling: 20 }).then(() => Date.now()).catch(() => null);
  const deadline = Date.now() + 30000;
  while (sent.length === before && Date.now() < deadline) await new Promise(r => setTimeout(r, 20));
  const s = sent[before];
  return { dispatchMs: s && s.dreqAt ? s.at - s.dreqAt : null, bubbleMs: flipped ? flipped - clickAt : null, s };
};
const backgroundRate = async (ms) => {
  const t0 = Date.now(); const n0 = reqLog.length;
  await page.waitForTimeout(ms);
  return (reqLog.length - n0) / ((Date.now() - t0) / 1000);
};

const results = { browser: BROWSER, latency: LATENCY, churn: CHURN, phases: {} };
const phase = async (name) => {
  const input = await openChat(A);
  await page.waitForTimeout(1500);
  const before = await page.evaluate(() => ({ intervals: window.__activeIntervals(), inflight: window.__inflight }));
  await page.evaluate(() => { window.__maxLag = 0; });
  peakInflight = 0;
  const rate = await backgroundRate(8000);
  const peak = peakInflight;
  const maxLag = await page.evaluate(() => Math.round(window.__maxLag));
  const sends = [];
  for (let i = 0; i < 3; i++) {
    const reqsBefore = reqLog.length;
    const sentBefore = sent.length;
    const r = await sendOne(input, `${name} 测试消息 ${i} ${Date.now() % 100000}`);
    // requests issued for this send: POST /api/task plus anything sendTask awaited first (auth/me)
    const authMe = reqLog.slice(reqsBefore).filter(x => x.path === '/api/auth/me' && x.start <= (r.s?.at ?? Infinity)).length;
    sends.push({ ...r, authMeBeforePost: authMe, posts: sent.length - sentBefore });
    await page.waitForTimeout(1500);
  }
  results.phases[name] = { maxLagMs: maxLag, intervals: before.intervals, rate: Math.round(rate * 10) / 10, peakInflight: peak, sends: sends.map(s => ({ dispatchMs: s.dispatchMs, bubbleMs: s.bubbleMs, authMeBeforePost: s.authMeBeforePost, posts: s.posts })) };
  console.log(`[${name}] maxLag=${maxLag} intervals=${before.intervals} req/s=${results.phases[name].rate} peakInflight=${peak} sends=${JSON.stringify(results.phases[name].sends)}`);
  return results.phases[name];
};

const p0 = await phase('fresh');
// churn: navigate around like a long-lived window
const screens = [{ name: 'chat', alias: A }, { name: 'chat', alias: B }, { name: 'tasks' }, { name: 'agents' }, { name: 'chat', alias: ALIASES[2] }];
for (let i = 0; i < CHURN; i++) {
  await page.evaluate((s) => window.__anetLayoutSweep.setScreen(s), screens[i % screens.length]);
  await page.waitForTimeout(250);
}
const p1 = await phase('after-churn');

// ── #518 stuck 「发送中…」: every send settles into 已送达 or 未送达 · 点击重试, within the send bound ──
const FAILED = '未送达 · 点击重试';
const SENDING = '发送中…';
const bubbleState = (text) => page.evaluate(({ t, FAILED, SENDING }) => {
  // the bubble whose own text is t, and the status mark rendered next to it
  const el = [...document.querySelectorAll('div')].find(d => d.textContent === t);
  if (!el) return 'missing';
  let box = el;
  for (let i = 0; i < 8 && box; i++, box = box.parentElement) {
    const txt = box.textContent || '';
    if (txt.includes(FAILED)) return 'failed';
    if (txt.includes(SENDING)) return 'sending';
    if (txt.includes('已送达')) return 'sent';
  }
  return 'unknown';
}, { t: text, FAILED, SENDING });
const waitState = async (text, want, ms) => {
  const t0 = Date.now(); let st;
  while (Date.now() - t0 < ms) { st = await bubbleState(text); if (st === want) return { ok: true, ms: Date.now() - t0 }; await page.waitForTimeout(100); }
  return { ok: false, ms: Date.now() - t0, st };
};
const SEND_BOUND = 15_000 + 6_000; // HUB_TOOL_DEADLINE_MS + reconcile/render slack
const scenario = async (mode, { plugin = false, switchAway = false } = {}) => {
  await page.evaluate((off) => { try { off ? localStorage.setItem('anet.pooledHttp.off', '1') : localStorage.removeItem('anet.pooledHttp.off'); } catch {} }, plugin);
  const input = await openChat(A);
  await page.waitForTimeout(800);
  taskMode = mode;
  const text = `#518 ${mode}${plugin ? ' plugin' : ''}${switchAway ? ' switch' : ''} ${Date.now() % 100000}`;
  const before = sent.length;
  await input.click(); await input.fill(text); await page.keyboard.press('Enter');
  if (switchAway) {
    await page.waitForTimeout(300);
    await page.evaluate((b) => window.__anetLayoutSweep.setScreen({ name: 'chat', alias: b }), B);
    await page.waitForTimeout(SEND_BOUND);
    await openChat(A);
    await page.waitForTimeout(1500);
  }
  const settled = await waitState(text, 'failed', switchAway ? 6000 : SEND_BOUND);
  const tag = `${mode}${plugin ? ' (plugin:http)' : ' (pooled_fetch)'}${switchAway ? ' + 切走再切回' : ''}`;
  ck(`${tag}: 气泡在上限内变「未送达 · 点击重试」,不停在「发送中…」`, settled.ok, settled.ok ? `${settled.ms} ms` : `still ${settled.st} after ${settled.ms} ms`);
  // retry with the hub back: same client_request_id, no new logical send, ends 已送达
  taskMode = 'ok';
  const firstId = sent[before]?.requestId;
  if (settled.ok) {
    await page.locator(`text=${FAILED}`).first().click();
    const delivered = await waitState(text, 'sent', 8000).then(r => r.ok ? r : waitState(text, 'missing', 1)); // the hub row may replace the echo
    const retryRow = sent.slice(before + 1).find(x => x.requestId === firstId);
    ck(`${tag}: 点重试复用同一个 client_request_id,然后不再是失败`, !!firstId && !!retryRow && (delivered.ok || (await bubbleState(text)) !== 'failed'), `first=${firstId?.slice(0, 18)} retried=${!!retryRow}`);
  }
  for (const r of hung.splice(0)) { try { r.destroy(); } catch {} }
};
await scenario('drop');
await scenario('hang');
await scenario('502');
await scenario('hang-body', { plugin: true });
await scenario('hang', { switchAway: true });
await page.evaluate(() => { try { localStorage.removeItem('anet.pooledHttp.off'); } catch {} });

for (const [name, p] of Object.entries({ fresh: p0, 'after-churn': p1 })) {
  const warm = p.sends.slice(1);
  ck(`${name}: 热身后每次发送 dispatch < 500 ms`, warm.every(s => s.dispatchMs !== null && s.dispatchMs < 500), warm.map(s => s.dispatchMs).join(','));
  ck(`${name}: 热身后每次发送只有 1 个请求(无 auth/me)`, warm.every(s => s.posts === 1 && s.authMeBeforePost === 0), JSON.stringify(warm.map(s => [s.posts, s.authMeBeforePost])));
  ck(`${name}: 气泡在 POST 回来后立即变色`, p.sends.every(s => s.bubbleMs !== null && s.bubbleMs < 2 * LATENCY + 600), p.sends.map(s => s.bubbleMs).join(','));
}
ck('翻页后活跃 interval 不堆积', p1.intervals <= p0.intervals + 2, `${p0.intervals} → ${p1.intervals}`);
ck('翻页后在路上的请求峰值 ≤ 12', p1.peakInflight <= 12, `${p0.peakInflight} → ${p1.peakInflight}`);
ck('翻页后每秒请求数不堆积', p1.rate <= p0.rate * 1.5 + 2, `${p0.rate} → ${p1.rate}`);

const byPath = {}; for (const r of reqLog) byPath[`${r.method} ${r.path}`] = (byPath[`${r.method} ${r.path}`] || 0) + 1;
results.byPath = byPath; results.invokes = await page.evaluate(() => window.__invokes); console.log('invokes:', JSON.stringify(results.invokes)); console.log('requests by path:', JSON.stringify(byPath));
writeFileSync(join(OUT, `send-dispatch-${BROWSER}.json`), JSON.stringify(results, null, 2));
await browser.close();
web.close(); hub.close();
console.log(`\n${total - failures}/${total} passed`);
process.exit(failures ? 1 : 0);
