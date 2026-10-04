// #527(Vincent 10-04 09:49):「比如说图片发送失败啊？我点击重新发送它那个图片并不会去重新发送的」。
// 真应用(expo web 导出 + 页内 Tauri http 桩)端到端:图片消息发送失败 → 点「未送达 · 点击重试」→ 图要重新发出去。
//
//   WEB_DIR=<expo export 目录> OUT=<截图目录> [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] node tests/test-resend-image/drive.mjs
//
// 没有 hub 进程、没有端口、不碰 HOME:hub 由页内桩回答(占位别名 示例-A / 示例-B),POST 记进 window.__posts;
// window.__fail = { upload: n, task: n } 让接下来 n 次上传 / 发任务失败。
//
// 两个失败点 × {原地重试, 切到别的会话再切回来后重试(#527 的路径:回显从 outbox 重建)}:
//   upload-fails   :上传失败 → 未送达;重试要重新上传,再发一条带 attachments 的 /api/task;
//   task-fails     :上传成功、/api/task 失败 → 未送达;重试不再上传,复用同一个 file_id。
// 每个用例断言:重试前气泡里还看得到图;重试后恰好一条 /api/task,attachments 1 个(绝不只发文字);
// 状态 未送达 → 发送中 → 已送达。
// 视口:390×844 手机(＋ → 相册 选图);1200×850 桌面(粘贴图片,桌面输入区)。
// 退出码 1 = 任何一条失败。
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

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
const A = '示例-A', B = '示例-B';
const PLACEHOLDER = `发消息给 ${A}…`;
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const PNG = Buffer.from(PNG_B64, 'base64');
const NOT_DELIVERED = '未送达 · 点击重试';

const initScript = ({ theme }) => {
  const HUB = 'http://mock-hub.invalid';
  const iso = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();
  const profile = { serverUrl: HUB, token: 'placeholder-token', username: 'tester', profileId: 'p-resend', displayName: 'tester', networkId: 'net-demo' };
  const creds = { appId: '', accessToken: 'placeholder-api-key-0000', endpoint: 'http://127.0.0.1:1/flash' };
  const sessions = ['示例-A', '示例-B'].map((alias, i) => ({ alias, status: 'idle', agent: 'claude-code', runtime: 'agent-node', node_id: `n_demo_${i}`, hostname: 'host-a', project_dir: `/work/demo-${i}`, version: '0.0.0', updated_at: iso(1) }));
  try { localStorage.setItem('voice_composer_input_mode_v1', 'keyboard'); } catch {}
  try { localStorage.setItem('anet.language.v1', 'zh'); } catch {}
  window.__posts = [];
  window.__fail = { upload: 0, task: 0 };
  let uploads = 0;
  const route = (url, method) => {
    const p = new URL(url).pathname;
    const ok = (body) => ({ status: 200, body });
    if (p === '/api/upload' && method === 'POST') {
      if (window.__fail.upload > 0) { window.__fail.upload--; return { status: 500, body: { ok: false, error: 'upload_failed' } }; }
      uploads++;
      return ok({ ok: true, file_id: `f_demo_${uploads}`, path: `/uploads/f_demo_${uploads}.png`, url: `/api/files/f_demo_${uploads}`, size: 68, mime: 'image/png' });
    }
    if (p === '/api/task' && method === 'POST') {
      if (window.__fail.task > 0) { window.__fail.task--; return { status: 503, body: { ok: false, error: 'hub restarting' } }; }
      return ok({ ok: true, task_id: `t_demo_${Date.now()}` });
    }
    if (p === '/api/auth/me') return ok({ ok: true, user: { username: 'tester' }, current_network: 'net-demo', networks: [{ network_id: 'net-demo', name: 'demo' }] });
    if (p === '/api/status') return ok({ ok: true, sessions, files_capable: true });
    if (p === '/api/nodes') return ok({ ok: true, nodes: [], count: 0 });
    if (p === '/api/tasks') return ok({ ok: true, tasks: [] });
    if (p === '/api/messages') return ok({ ok: true, messages: [], unread: 0, pending_count: 0 });
    if (p === '/api/side-threads/capability') return ok({ ok: true, supported: false });
    if (p.startsWith('/api/events')) return { status: 404, body: { ok: false } };
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
          const method = c.method || 'GET';
          const r = route(c.url, method);
          if (method === 'POST') {
            let body = '';
            try { body = c.data ? new TextDecoder().decode(new Uint8Array(c.data)) : ''; } catch {}
            window.__posts.push({ path: new URL(c.url).pathname, body, status: r.status });
          }
          const buf = new TextEncoder().encode(JSON.stringify(r.body));
          const id = ++rid; bodies.set(id, { buf, sent: false });
          return { status: r.status, statusText: r.status === 200 ? 'OK' : 'ERR', url: c.url, headers: [['content-type', 'application/json']], rid: id };
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
const browser = await chromium.launch({ headless: true, executablePath: findExe() });
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

let failures = 0, total = 0;
const ck = (tag, name, cond, detail = '') => { total++; if (!cond) failures++; console.log(`${cond ? 'PASS' : 'FAIL'} [${tag}] ${name}${detail ? ` — ${detail}` : ''}`); };
const shots = [];

const DEVICES = [
  { kind: 'phone', viewport: { width: 390, height: 844 }, ua: ANDROID_UA, sim: '32,0,24,0' },
  { kind: 'desktop', viewport: { width: 1200, height: 850 } },
];
const CASES = [
  { name: 'upload-fails', fail: { upload: 1, task: 0 }, switchAway: false, uploadsAfterRetry: 2 },
  { name: 'upload-fails-switch', fail: { upload: 1, task: 0 }, switchAway: true, uploadsAfterRetry: 2 },
  { name: 'task-fails', fail: { upload: 0, task: 1 }, switchAway: false, uploadsAfterRetry: 1 },
  { name: 'task-fails-switch', fail: { upload: 0, task: 1 }, switchAway: true, uploadsAfterRetry: 1 },
];

for (const dev of DEVICES) for (const c of CASES) {
  const tag = `${dev.kind}/${c.name}`;
  const ctx = await browser.newContext({ viewport: dev.viewport, colorScheme: 'light', ...(dev.ua ? { userAgent: dev.ua } : {}), deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGEERROR', e.message.split('\n')[0]));
  await page.addInitScript(initScript, { theme: 'light' });
  const openChat = async (alias) => {
    if (dev.kind === 'phone') await page.evaluate((a) => window.__anetLayoutSweep.setScreen({ name: 'chat', alias: a }), alias);
    else await page.getByText(alias, { exact: true }).first().click({ timeout: 20000 });
    await page.locator(`textarea[placeholder="发消息给 ${alias}…"]`).waitFor({ timeout: 15000 });
    await page.waitForTimeout(400);
  };
  if (dev.kind === 'phone') {
    await page.goto(`${WEB_URL}?safeAreaSim=${dev.sim}`);
    await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 20000 });
  } else {
    await page.goto(WEB_URL);
  }
  await openChat(A);
  const input = page.locator(`textarea[placeholder="${PLACEHOLDER}"]`);

  // 选一张图(手机:＋ → 相册;桌面:粘贴),写一句话
  if (dev.kind === 'phone') {
    await page.locator('[data-testid="composer-plus"]').click();
    const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 5000 }), page.getByText('相册', { exact: true }).first().click()]);
    await chooser.setFiles({ name: 'resend.png', mimeType: 'image/png', buffer: PNG });
  } else {
    await page.evaluate((b64) => {
      const bytes = Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));
      const dt = new DataTransfer(); dt.items.add(new File([bytes], 'resend.png', { type: 'image/png' }));
      window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, PNG_B64);
  }
  await page.waitForTimeout(600);
  await input.click();
  await page.keyboard.type('看这张图');
  await page.evaluate((f) => { window.__posts = []; window.__fail = f; }, c.fail);
  if (dev.kind === 'phone') await page.locator('[data-testid="composer-send"]').click();
  else await page.keyboard.press('Enter');

  const failed = page.getByText(NOT_DELIVERED, { exact: true });
  const sawFailed = await failed.first().waitFor({ timeout: 15000 }).then(() => true, () => false);
  ck(tag, '第一次发送失败 → 未送达 · 点击重试', sawFailed);
  const firstPosts = await page.evaluate(() => window.__posts.map(p => `${p.path}:${p.status}`));
  ck(tag, `失败点符合用例(${c.fail.upload ? '上传' : '发任务'}失败)`, c.fail.upload ? firstPosts.join(',') === '/api/upload:500' : firstPosts.join(',') === '/api/upload:200,/api/task:503', firstPosts.join(','));

  if (c.switchAway) {
    await openChat(B);
    await openChat(A);
  }
  const bubbleImgs = await page.evaluate(() => [...document.querySelectorAll('img')].filter(i => /^blob:|\/api\/files\//.test(i.getAttribute('src') || '') && i.getBoundingClientRect().width > 4).length);
  ck(tag, '重试前:失败气泡里还看得到这张图', bubbleImgs >= 1, `imgs=${bubbleImgs}`);
  await page.screenshot({ path: `${OUT}/resend-${dev.kind}-${c.name}-1-failed.png` }); shots.push(`${OUT}/resend-${dev.kind}-${c.name}-1-failed.png`);

  // 点重试;逐帧记状态文字
  const watch = page.evaluate(() => new Promise(resolve => {
    const seen = []; const t0 = performance.now();
    const tick = () => {
      const txt = document.body.innerText;
      const s = txt.includes('发送中…') ? 'sending' : txt.includes('未送达 · 点击重试') ? 'failed' : txt.includes('已送达') ? 'delivered' : '?';
      if (seen[seen.length - 1] !== s) seen.push(s);
      if (performance.now() - t0 < 4000) requestAnimationFrame(tick); else resolve(seen);
    };
    tick();
  }));
  const failedCount = await failed.count();
  if (failedCount) await failed.first().click();
  const seen = await watch;
  await page.waitForTimeout(300);
  const posts = await page.evaluate(() => window.__posts);
  const uploads = posts.filter(p => p.path === '/api/upload' && p.status === 200);
  const tasks = posts.filter(p => p.path === '/api/task' && p.status === 200);
  let body = null; try { body = JSON.parse(tasks[0]?.body || 'null'); } catch {}
  ck(tag, '重试后:恰好一条 /api/task 送达', tasks.length === 1, `tasks=${tasks.length} posts=${posts.map(p => `${p.path}:${p.status}`).join(',')}`);
  ck(tag, '那条消息带着图(attachments 1 个,不是只有文字)', !!body && Array.isArray(body.attachments) && body.attachments.length === 1, body ? `task=${JSON.stringify(body.task).slice(0, 50)} attachments=${JSON.stringify(body.attachments ?? null)}` : 'no body');
  ck(tag, '正文还是那句话', !!body && typeof body.task === 'string' && body.task.startsWith('看这张图'));
  const uploadPosts = posts.filter(p => p.path === '/api/upload').length;
  ck(tag, c.fail.upload ? '没传上的重新上传(第二次上传成功)' : '传上过的不重传(复用 file_id)', uploads.length === 1 && uploadPosts === c.uploadsAfterRetry && body?.attachments?.[0]?.file_id === 'f_demo_1', `upload posts=${uploadPosts} ok=${uploads.length} file_id=${body?.attachments?.[0]?.file_id}`);
  ck(tag, '状态 未送达 → 发送中 → 已送达', seen.join('>').startsWith('failed>sending') && seen[seen.length - 1] === 'delivered', seen.join('>'));
  await page.screenshot({ path: `${OUT}/resend-${dev.kind}-${c.name}-2-delivered.png` }); shots.push(`${OUT}/resend-${dev.kind}-${c.name}-2-delivered.png`);
  await ctx.close();
}
await browser.close(); web.close();
console.log(`\nscreenshots:\n${shots.join('\n')}`);
console.log(`\n${total - failures}/${total} passed`);
process.exit(failures ? 1 : 0);
