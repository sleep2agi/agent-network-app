// 定时任务「任务内容」⤢ 全屏 + 语音输入 —— 端到端 + 量框(owner 09-30「定时任务…也需要全屏以及说支持语音输入」)。
// Not in CI (same as test-schedule-edit-conflict): needs Playwright + Chromium and a web export. No hub at all:
// a stateful mock answers /api/scheduled-tasks through page.route(). Voice recognition is a stub (flash endpoint
// answered in the page with window.__flash.text); the microphone is Chromium's fake device.
// Nothing touches 127.0.0.1:9200 or ~/.anet.
//
//   WEB_DIR=<expo export dir> OUT=<png dir> PLAYWRIGHT_MODULE=<…/playwright/index.mjs> \
//   node tests/test-schedule-content-fullscreen/drive.mjs
//
// desktop 1320×754 (Tauri stub, mouse), light + dark:
//   detail     「任务内容 · ⤢ 全屏」 on one centre line ±1px, the button's right edge on the card's right edge ±1px
//   read       ⤢ → covers the window, opens in 阅读; no 🖼 (schedules carry no images), no 🎤 while read-only, 保存 disabled
//   split      左右 → 🎤 appears; toolbar items on one centre line ±1px; typing marks it unsaved and enables 保存
//   voice      🎤 → recording bar → Enter inserts the recognised text at the caret
//   save       保存 ⇒ exactly one PATCH whose body is { revision, task } (revision = the one opened) ⇒ closes, card updated
//   conflict   another device changes 任务内容 mid-edit ⇒ 保存 ⇒ conflict box, draft kept ⇒ 用我的覆盖 ⇒ PATCH at the new revision
//   form       编辑 ⇒ the form's 任务内容 has ⤢ 全屏 + 🎤 and no 🖼; ⤢ opens the same full-screen editor (左右)
// phone 390×844 (Android UA ⇒ touch), light + dark:
//   detail     tap the 任务内容 card ⇒ pushed page in 预览; ‹ · 任务内容 · 编辑/预览 · 保存 on one centre line ±1px
//   edit       编辑 ⇒ 按住 说话 bar at the bottom, full width inside the 16px gutters; no 🖼
//   draft      type, ‹ back ⇒ card says there are unsaved changes; 继续编辑 restores the draft; 保存 ⇒ PATCH { revision, task }
//   form       编辑 ⇒ ⤢ in the form opens the page in 编辑 with the 按住 说话 bar
// Exit 1 when any assertion fails.
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { paintedText } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR, OUT = process.env.OUT;
if (!WEB || !OUT) throw new Error('need WEB_DIR OUT');
mkdirSync(OUT, { recursive: true });
const HUB = 'http://hub.placeholder.invalid';
const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

const LONG = '示例:每天早上检查一遍示例任务列表,把状态有变化的条目整理成一份简短的清单。\n\n对超过三天没有进展的示例条目,在清单里单独列出,并附上最后一次更新的时间。\n\n参考页面:https://example.invalid/sample/board\n\n清单按优先级从高到低排列,每条不超过一行;没有变化的条目不用列出。这段文字只是测试用的示例内容,用来撑出多行的长度,检查全屏和换行的显示是否正常。';

// ── stateful mock hub ────────────────────────────────────────────────────────
let row, patches;
const reset = () => {
  patches = [];
  row = {
    schedule_id: 'sched_1', network_id: 'net-placeholder', name: '示例巡检计划', target_node_id: 'node-a', target_alias: '测试甲',
    task_content: LONG, priority: 'normal', schedule: { type: 'interval', every_seconds: 180 }, timezone: 'Asia/Shanghai',
    misfire_policy: 'skip', status: 'active', next_run_at: new Date(Date.now() + 120_000).toISOString(), last_run_at: null, revision: 4,
  };
};
const answer = (req) => {
  const u = new URL(req.url()), p = u.pathname, method = req.method();
  if (p === '/api/status') return json({ sessions: [{ alias: '测试甲', node_id: 'node-a', status: 'idle', runtime: 'codex', updated_at: new Date().toISOString() }] });
  if (p === '/api/nodes') return json({ ok: true, nodes: [{ node_id: 'node-a', alias: '测试甲', runtime: 'codex' }], count: 1 });
  if (p === '/api/scheduled-tasks') return json({ ok: true, schedules: [row] });
  if (p.endsWith('/runs')) return json({ ok: true, runs: [] });
  if (p === '/api/scheduled-tasks/sched_1' && method === 'PATCH') {
    const body = JSON.parse(req.postData() || '{}');
    patches.push(body);
    if (body.revision !== row.revision) return json({ ok: false, error: 'revision_conflict', current_revision: row.revision }, 409);
    row = { ...row, ...(body.name !== undefined ? { name: body.name } : {}), ...(body.task !== undefined ? { task_content: body.task } : {}), revision: row.revision + 1 };
    return json({ ok: true, schedule: row });
  }
  return json({ ok: true, messages: [], tasks: [], nodes: [], sessions: [], schedules: [] });
};

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ttf': 'font/ttf', '.json': 'application/json', '.ico': 'image/x-icon' };
const web = createServer((req, res) => {
  let p = join(WEB, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!existsSync(p) || statSync(p).isDirectory()) p = join(WEB, 'index.html');
  res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' });
  res.end(readFileSync(p));
}).listen(0, '127.0.0.1');
await new Promise(r => setTimeout(r, 200));
const WEB_URL = `http://127.0.0.1:${web.address().port}/`;

// Desktop-shell stub; plugin:http goes to page fetch (page.route answers it), except the recognition endpoint.
const initScript = ({ hubUrl, theme }) => {
  const FLASH = 'http://127.0.0.1:1/flash';
  const profile = { serverUrl: hubUrl, token: 'utok_placeholder', username: 'tester', profileId: 'p-sched-content', displayName: 'tester', networkId: 'net-placeholder' };
  const creds = { appId: '', accessToken: 'placeholder-api-key-0000', endpoint: FLASH };
  window.__flash = { text: '', calls: 0 };
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
          if (String(c.url).startsWith(FLASH)) {
            window.__flash.calls++;
            const id = ++rid; bodies.set(id, { buf: new TextEncoder().encode(JSON.stringify({ result: { text: window.__flash.text } })), sent: false });
            return { status: 200, statusText: 'OK', url: c.url, headers: [['content-type', 'application/json'], ['X-Api-Status-Code', '20000000']], rid: id };
          }
          const r = await fetch(c.url, { method: c.method, headers: c.headers, body: c.data ? new Uint8Array(c.data) : undefined });
          const buf = new Uint8Array(await r.arrayBuffer());
          const id = ++rid; bodies.set(id, { buf, sent: false });
          return { status: r.status, statusText: r.statusText, url: r.url || c.url, headers: Array.from(r.headers.entries()), rid: id };
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
  try { localStorage.setItem('theme_mode_v1', theme); } catch {}
};

const findExe = () => {
  const base = `${process.env.HOME}/.cache/ms-playwright`;
  for (const d of ['chromium-1234', 'chromium-1217', 'chromium-1208']) for (const p of [`${base}/${d}/chrome-linux64/chrome`, `${base}/${d}/chrome-linux/chrome`]) if (existsSync(p)) return p;
  return undefined;
};
const browser = await chromium.launch({ headless: true, executablePath: findExe(), args: ['--disable-web-security', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36';
const r1 = (n) => Math.round(n * 10) / 10;
const tid = (id) => `[data-testid="${id}"]`;
// The ⤢ button and the full-screen modal share the testID req-description-fullscreen (task description's naming); the modal is the div.
const FULL = 'div[data-testid="req-description-fullscreen"]';

let failures = 0;
function record(vp, what, checks, detail = {}) {
  const ok = Object.values(checks).every(Boolean);
  if (!ok) failures++;
  console.log(JSON.stringify({ vp, what, ...detail, ok, failed: Object.keys(checks).filter(k => !checks[k]).join(',') || '-' }));
}
const rect = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const b = el.getBoundingClientRect();
  return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom, cy: b.y + b.height / 2 };
}, sel);
const spread = (rs) => { const ys = rs.map(r => r?.cy); return ys.every(v => v != null) ? Math.max(...ys) - Math.min(...ys) : Infinity; };
const count = (page, sel) => page.locator(sel).count();
const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.png`) });
// Text checks also demand the PAINTED box (after overflow clipping): a 0-wide element keeps its textContent.
const painted = (p) => !!p && p.painted && p.w >= 8;
const pw = (p) => p ? `${r1(p.w)}×${r1(p.h)}` : 'none';
const patchKeys = (b) => Object.keys(b || {}).sort().join(',');

async function openSchedules(page, kind, theme) {
  await page.route(`${HUB}/**`, route => route.fulfill(answer(route.request())));
  await page.addInitScript(initScript, { hubUrl: HUB, theme });
  await page.goto(WEB_URL);
  const rail = page.locator('[data-testid="desktop-rail"] [aria-label="定时任务"]');
  if (kind === 'desktop' && await rail.first().waitFor({ timeout: 25000 }).then(() => true, () => false)) await rail.first().click();
  else await page.getByText('定时任务', { exact: true }).first().click({ timeout: 25000 });
  if (kind === 'phone') await page.getByText('示例巡检计划', { exact: true }).first().click({ timeout: 15000 });
  await page.locator(tid('schedule-detail')).waitFor({ timeout: 15000 });
  await page.waitForTimeout(400);
}

// ─── desktop ────────────────────────────────────────────────────────────────────────────────────
for (const theme of ['light', 'dark']) {
  reset();
  const vp = `desktop 1320x754 ${theme}`;
  const ctx = await browser.newContext({ viewport: { width: 1320, height: 754 }, deviceScaleFactor: 1, permissions: ['microphone'], locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).split('\n')[0]));
  await openSchedules(page, 'desktop', theme);
  {
    const btn = await rect(page, tid('schedule-content-fullscreen'));
    const card = await rect(page, tid('schedule-content-card'));
    const label = await page.locator(tid('schedule-detail')).getByText('任务内容', { exact: true }).first().boundingBox();
    const labelR = label && { cy: label.y + label.height / 2 };
    record(vp, 'detail: 任务内容 · ⤢ 全屏 on one centre line, button flush with the card', {
      button: !!btn, aligned: spread([btn, labelR]) <= 1, flushRight: !!btn && !!card && Math.abs(btn.r - card.r) <= 1 + 8, above: !!btn && !!card && btn.b <= card.y + 0.5,
    }, { spread: r1(spread([btn, labelR])), btnR: btn && r1(btn.r), cardR: card && r1(card.r) });
    await shot(page, `desktop-${theme}-detail`);
  }
  await page.locator(tid('schedule-content-fullscreen')).click();
  await page.locator(FULL).waitFor({ timeout: 8000 });
  await page.waitForTimeout(300);
  {
    const full = await rect(page, FULL);
    const save = page.locator(tid('req-description-full-save'));
    const readSel = await page.locator(tid('req-description-full-mode-read')).getAttribute('aria-selected');
    const readP = await paintedText(page, tid('req-description-full-read'));
    record(vp, 'read: covers the window, 阅读, no 🖼 / 🎤, 保存 disabled', {
      covers: !!full && full.x <= 0.5 && full.y <= 0.5 && full.w >= 1319 && full.h >= 753,
      read: readSel === 'true', noImage: (await count(page, tid('req-description-full-image'))) === 0, noMic: (await count(page, tid('voice-mic'))) === 0,
      saveDisabled: (await save.getAttribute('aria-disabled')) === 'true',
      textShown: (await page.locator(tid('req-description-full-read')).innerText()).includes('检查全屏和换行的显示是否正常') && painted(readP),
    }, { readPainted: pw(readP) });
    await shot(page, `desktop-${theme}-fullscreen-read`);
  }
  await page.locator(tid('req-description-full-mode-split')).click();
  await page.locator(tid('voice-mic')).waitFor({ timeout: 8000 });
  const input = `textarea[data-testid="req-description-full-input"]`;
  await page.locator(input).click();
  await page.locator(input).press('End');
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n每次只同步 10 条。');
  await page.waitForTimeout(400);
  {
    const items = await Promise.all([tid('req-description-full-mode'), tid('voice-mic'), tid('req-description-full-save'), tid('req-description-full-close')].map(s => rect(page, s)));
    const src = await rect(page, tid('req-description-split-source'));
    const prev = await rect(page, tid('req-description-split-preview'));
    const dirtyP = await paintedText(page, tid('req-description-full-dirty'));
    const prevP = await paintedText(page, tid('req-description-split-preview'));
    record(vp, 'split: toolbar on one centre line, 🎤 present, unsaved + 保存 enabled, panes side by side', {
      aligned: spread(items) <= 1, mic: !!items[1], noImage: (await count(page, tid('req-description-full-image'))) === 0,
      unsaved: (await page.locator(tid('req-description-full-dirty')).innerText()).includes('未保存') && painted(dirtyP),
      saveEnabled: (await page.locator(tid('req-description-full-save')).getAttribute('aria-disabled')) !== 'true',
      sideBySide: !!src && !!prev && Math.abs(src.y - prev.y) <= 1 && src.r <= prev.x + 1,
      previewLive: (await page.locator(tid('req-description-split-preview')).innerText()).includes('每次只同步 10 条') && painted(prevP),
    }, { spread: r1(spread(items)), dirtyPainted: pw(dirtyP), previewPainted: pw(prevP) });
    await shot(page, `desktop-${theme}-fullscreen-split`);
  }
  // 🎤 → recording bar → Enter inserts at the caret (end of text).
  {
    await page.locator(input).click();
    await page.keyboard.press('Control+End');
    await page.evaluate(() => { window.__flash.text = '语音补一句。'; });
    await page.locator(tid('voice-mic')).click();
    const recording = await page.locator(tid('voice-bar')).waitFor({ timeout: 8000 }).then(() => true, () => false);
    await page.waitForTimeout(900);
    if (recording) await shot(page, `desktop-${theme}-fullscreen-voice`);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => (document.querySelector('textarea[data-testid="req-description-full-input"]')?.value || '').includes('语音补一句'), null, { timeout: 10000 }).catch(() => {});
    const value = await page.locator(input).inputValue();
    record(vp, 'voice: 🎤 → bar → Enter inserts the recognised text at the caret', { recording, inserted: value.endsWith('语音补一句。') });
  }
  const typed = await page.locator(input).inputValue();
  if (theme === 'dark') {
    // another device edits 任务内容 while we are in full screen ⇒ conflict box; draft kept; 用我的覆盖
    row = { ...row, task_content: '别的设备改过的内容', revision: row.revision + 1 };
    await page.locator(tid('req-description-full-save')).click();
    await page.locator(tid('schedule-content-problem')).waitFor({ timeout: 8000 }).catch(() => {});
    const theirs = await page.locator(tid('schedule-content-problem')).innerText().catch(() => '');
    const problemP = await paintedText(page, tid('schedule-content-problem'));
    record(vp, 'conflict: box with the latest text, draft kept, one PATCH so far', {
      box: (await count(page, tid('schedule-content-problem'))) === 1,
      theirs: theirs.includes('别的设备改过的内容') && painted(problemP),
      draftKept: (await page.locator(input).inputValue()) === typed, onePatch: patches.length === 1 && patches[0].revision === 4,
    }, { theirs: JSON.stringify(theirs), problemPainted: pw(problemP) });
    await shot(page, `desktop-${theme}-fullscreen-conflict`);
    await page.locator(tid('schedule-content-conflict-mine')).click();
    await page.locator(FULL).waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
    record(vp, 'conflict: 用我的覆盖 ⇒ PATCH { revision, task } at the new revision ⇒ saved, closed', {
      patch: patches.length === 2 && patches[1].revision === 5 && patchKeys(patches[1]) === 'revision,task' && patches[1].task === typed.trim(),
      saved: row.task_content === typed.trim(), closed: (await count(page, FULL)) === 0,
    }, { patches: patches.map(p => `${p.revision}:${patchKeys(p)}`).join(' ') });
  } else {
    await page.locator(tid('req-description-full-save')).click();
    await page.locator(FULL).waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(600);
    const cardP = await paintedText(page, tid('schedule-content-card'));
    record(vp, 'save: one PATCH { revision: 4, task } ⇒ closed, card shows the new text', {
      patch: patches.length === 1 && patches[0].revision === 4 && patchKeys(patches[0]) === 'revision,task' && patches[0].task === typed.trim(),
      closed: (await count(page, FULL)) === 0,
      card: (await page.locator(tid('schedule-content-card')).innerText()).includes('语音补一句') && painted(cardP),
    }, { patches: patches.map(p => `${p.revision}:${patchKeys(p)}`).join(' '), cardPainted: pw(cardP) });
  }
  // the edit form's 任务内容
  await page.locator(tid('schedule-detail')).getByText('编辑', { exact: true }).click();
  await page.locator(tid('schedule-form')).waitFor({ timeout: 8000 });
  await page.waitForTimeout(400);
  {
    const field = tid('schedule-form-task');
    const items = await Promise.all([`${field} > div:first-child > div:first-child`, `${field} ${tid('voice-mic')}`, `${field} ${tid('req-description-fullscreen')}`, `${field} ${tid('req-description-mode')}`].map(s => rect(page, s)));
    const box = await rect(page, field);
    const tb = await rect(page, `${field} ${tid('req-description-toolbar')}`);
    record(vp, 'form: 任务内容 · 🎤 · ⤢ 全屏 · 编辑/预览 on one centre line, no 🖼, opens as an editor', {
      aligned: spread(items) <= 1, noImage: (await count(page, `${field} ${tid('req-description-image-button')}`)) === 0,
      editor: (await page.getByPlaceholder('节点收到的任务').inputValue()) === row.task_content, insideBox: !!tb && !!box && tb.r <= box.r + 0.5,
    }, { spread: r1(spread(items)) });
    await shot(page, `desktop-${theme}-form`);
    await page.locator(`${field} ${tid('req-description-fullscreen')}`).click();
    await page.locator(FULL).waitFor({ timeout: 8000 });
    await page.waitForTimeout(300);
    record(vp, 'form: ⤢ opens the same full-screen editor in 左右 with 🎤, no 保存 (the form saves)', {
      split: (await count(page, tid('req-description-split'))) === 1, mic: (await count(page, `${FULL} ${tid('voice-mic')}`)) === 1,
      noSave: (await count(page, tid('req-description-full-save'))) === 0,
    });
    await shot(page, `desktop-${theme}-form-fullscreen`);
    await page.locator(tid('req-description-full-close')).click();
    await page.waitForTimeout(300);
    record(vp, 'form: closing full screen returns to the still-open form', { form: (await count(page, tid('schedule-form'))) === 1, closed: (await count(page, FULL)) === 0 });
  }
  record(vp, 'no page errors', { none: errors.length === 0 }, { errors: errors.slice(0, 3).join(' | ') });
  await ctx.close();
}

// ─── phone ──────────────────────────────────────────────────────────────────────────────────────
for (const theme of ['light', 'dark']) {
  reset();
  const vp = `phone 390x844 ${theme}`;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, userAgent: ANDROID_UA, hasTouch: true, permissions: ['microphone'], locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).split('\n')[0]));
  await openSchedules(page, 'phone', theme);
  {
    const btn = await rect(page, tid('schedule-content-fullscreen'));
    const card = await rect(page, tid('schedule-content-card'));
    const label = await page.locator(tid('schedule-detail')).getByText('任务内容', { exact: true }).first().boundingBox();
    const labelR = label && { cy: label.y + label.height / 2 };
    record(vp, 'detail: 任务内容 · ⤢ 全屏 on one centre line, inside the card width', {
      aligned: spread([btn, labelR]) <= 1, inside: !!btn && !!card && btn.r <= card.r + 8 + 0.5 && card.r <= 390 - 15.5,
    }, { spread: r1(spread([btn, labelR])), btnR: btn && r1(btn.r), cardR: card && r1(card.r) });
    await shot(page, `phone-${theme}-detail`);
  }
  await page.locator(tid('schedule-content-card')).click();
  await page.locator(tid('req-description-page')).waitFor({ timeout: 8000 });
  await page.waitForTimeout(500);
  {
    const items = await Promise.all([tid('req-description-page-back'), tid('req-description-page-title'), tid('req-description-page-mode'), tid('req-description-page-save')].map(s => rect(page, s)));
    const pageR = await rect(page, tid('req-description-page'));
    const titleP = await paintedText(page, tid('req-description-page-title'));
    record(vp, 'page: covers the screen, 预览 first, ‹ · 任务内容 · 编辑/预览 · 保存 on one centre line, no 🖼 / bar', {
      covers: !!pageR && pageR.w >= 389 && pageR.h >= 843, aligned: spread(items) <= 1,
      title: (await page.locator(tid('req-description-page-title')).innerText()) === '任务内容' && painted(titleP),
      preview: (await count(page, tid('req-description-page-preview'))) === 1, noBar: (await count(page, tid('req-description-page-voice'))) === 0,
      headerFits: items.every(r => r && r.x >= 0 && r.r <= 390),
    }, { spread: r1(spread(items)), titlePainted: pw(titleP) });
    await shot(page, `phone-${theme}-page-read`);
  }
  await page.locator(tid('req-description-page-mode-edit')).click();
  await page.locator(tid('req-description-page-voice')).waitFor({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(300);
  {
    const bar = await rect(page, tid('voice-hold-bar'));
    const wrap = await rect(page, tid('req-description-page-voice'));
    record(vp, 'edit: 按住 说话 bar at the bottom, full width inside 16px gutters, no 🖼', {
      bar: !!bar, gutters: !!bar && Math.abs(bar.x - 16) <= 1 && Math.abs(390 - bar.r - 16) <= 1, bottom: !!wrap && Math.abs(wrap.b - 844) <= 1,
      noImage: (await count(page, tid('req-description-page-image'))) === 0,
    }, { barX: bar && r1(bar.x), barR: bar && r1(bar.r), wrapB: wrap && r1(wrap.b) });
    await shot(page, `phone-${theme}-page-edit`);
  }
  const pageInput = `textarea[data-testid="req-description-page-input"]`;
  await page.locator(pageInput).fill('手机上改过的内容');
  await page.locator(tid('req-description-page-back')).click();
  await page.locator(tid('req-description-page')).waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(300);
  record(vp, 'draft: ‹ back keeps it, the card says so, no PATCH', { note: (await count(page, tid('schedule-content-draft'))) === 1, noPatch: patches.length === 0 });
  await shot(page, `phone-${theme}-draft`);
  await page.locator(tid('schedule-content-draft-resume')).click();
  await page.locator(tid('req-description-page')).waitFor({ timeout: 8000 });
  await page.waitForTimeout(300);
  if (await count(page, tid('req-description-page-mode-edit'))) await page.locator(tid('req-description-page-mode-edit')).click();
  record(vp, 'draft: 继续编辑 restores it', { restored: (await page.locator(pageInput).inputValue().catch(() => '')) === '手机上改过的内容' });
  await page.locator(tid('req-description-page-save')).click();
  await page.locator(tid('req-description-page')).waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(600);
  record(vp, 'save: one PATCH { revision: 4, task } ⇒ page closed, draft note gone', {
    patch: patches.length === 1 && patches[0].revision === 4 && patchKeys(patches[0]) === 'revision,task' && patches[0].task === '手机上改过的内容',
    closed: (await count(page, tid('req-description-page'))) === 0, noNote: (await count(page, tid('schedule-content-draft'))) === 0,
  }, { patches: patches.map(p => `${p.revision}:${patchKeys(p)}`).join(' ') });
  // form
  await page.locator(tid('schedule-detail')).getByText('编辑', { exact: true }).click();
  await page.locator(tid('schedule-form')).waitFor({ timeout: 8000 });
  await page.waitForTimeout(400);
  {
    const field = tid('schedule-form-task');
    record(vp, 'form: 任务内容 has ⤢ 全屏, no 🎤 in the small editor (phone), no 🖼', {
      fullscreen: (await count(page, `${field} ${tid('req-description-fullscreen')}`)) === 1, noMic: (await count(page, `${field} ${tid('voice-mic')}`)) === 0,
      noImage: (await count(page, `${field} ${tid('req-description-image-button')}`)) === 0,
    });
    await shot(page, `phone-${theme}-form`);
    await page.locator(`${field} ${tid('req-description-fullscreen')}`).click();
    await page.locator(tid('req-description-page')).waitFor({ timeout: 8000 });
    await page.waitForTimeout(400);
    const bar = await rect(page, tid('voice-hold-bar'));
    record(vp, 'form: ⤢ opens the page in 编辑 with 按住 说话, no 保存 (the form saves)', {
      edit: (await count(page, pageInput)) === 1, bar: !!bar, noSave: (await count(page, tid('req-description-page-save'))) === 0,
    });
    await shot(page, `phone-${theme}-form-page`);
  }
  record(vp, 'no page errors', { none: errors.length === 0 }, { errors: errors.slice(0, 3).join(' | ') });
  await ctx.close();
}

await browser.close();
web.close();
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
