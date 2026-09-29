// 任务描述:⤢ 全屏 + 语音输入 —— 对着一个真 Hub 点真按钮、量真框(task-description-fullscreen-model.ts)。
// Not in CI: needs Playwright + Chromium, a web export, and a THROWAWAY hub you started yourself (never 127.0.0.1:9200)
// holding the seed from tests/test-task-board/seed.mjs. Voice recognition is a stub: requests to the flash endpoint
// (http://127.0.0.1:1/flash) are answered in the page with window.__flash.text and counted. The microphone is
// Chromium's fake device.
//
//   WEB_DIR=<expo export dir> OUT=<png dir> HUB_URL=http://127.0.0.1:<port> HUB_TOKEN=<utok_…> HUB_NETWORK=<net_…> \
//   PLAYWRIGHT_MODULE=<…/playwright/index.mjs> node tests/test-task-description-fullscreen/drive.mjs
//
// desktop 1200×800 / 1000×700 (Tauri stub, mouse):
//   inline     the description toolbar (描述 · 🖼 · 🎤 · ⤢ 全屏 · 编辑/预览) shares one centre line ±1px
//   mic        caret in the middle → 🎤 → recording bar inside the description box (no phone overlay, no gesture copy),
//              bar items on one centre line ±1px → 完成 → text inserted at the caret, caret after it, focus kept
//   shortcut   Ctrl+Shift+M starts, Ctrl+Shift+M again inserts at the caret; no 「先打开一个会话」 toast
//   fullscreen ⤢ → covers the window; opens in 左右 with equal panes filling the body; toolbar on one centre line ±1px;
//              typing shows up in the preview; dragging the divider changes the split; paste and drop of an image upload
//              to the hub and insert ![…](/api/files/…); 🎤 → bar at the bottom → Esc cancels (text unchanged, still full
//              screen) → 🎤 → Enter inserts at the caret; 阅读 hides 🖼 / 🎤; Esc closes the full screen only (the
//              details underneath stay open, draft kept) → inline shows 预览
//   settings   recognition not configured → 🎤 shows 「去设置」; with unsaved changes it says to save first instead
// phone 390×844 (Android UA ⇒ touch):
//   inline     no 🎤 in the detail's small editor
//   page       ⤢ → a pushed page covering the screen; ‹ / 描述 / 🖼 / 编辑·预览 on one centre line ±1px; 按住 说话 bar at
//              the bottom, full width inside the 16px gutters, above the bottom inset
//   hold       caret in the middle → press the bar → WeChat overlay covers the page → release → inserted at the caret,
//              the editor is NOT focused (no keyboard); a second utterance continues after the first
//   preview    预览 hides the bar and 🖼; ‹ closes; 保存修改 writes the new description to the hub
// Exit 1 when any assertion fails. The flows mutate the hub: restore the seed DB before a rerun.
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { WEB_DIR: WEB, OUT, HUB_URL, HUB_TOKEN, HUB_NETWORK } = process.env;
if (!WEB || !OUT || !HUB_URL || !HUB_TOKEN || !HUB_NETWORK) throw new Error('need WEB_DIR OUT HUB_URL HUB_TOKEN HUB_NETWORK');
if (/:9200\b/.test(HUB_URL)) throw new Error('refusing :9200 — that is the production hub port; start a throwaway hub');
mkdirSync(OUT, { recursive: true });

const auth = { authorization: `Bearer ${HUB_TOKEN}`, 'content-type': 'application/json' };
const hubRow = async (id) => (await (await fetch(`${HUB_URL}/api/requirements/${id}`, { headers: auth })).json()).requirement;
const createReq = async (name, description) => {
  const r = await fetch(`${HUB_URL}/api/requirements`, { method: 'POST', headers: auth, body: JSON.stringify({ network_id: HUB_NETWORK, name, description, column: 'pool' }) });
  const j = await r.json();
  if (!j.requirement?.id) throw new Error(`create failed: ${JSON.stringify(j)}`);
  return j.requirement.id;
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

// Desktop-shell stub; plugin:http goes to the real (throwaway) hub, except the recognition endpoint.
const initScript = ({ hubUrl, token, networkId, theme, voiceConfigured }) => {
  const FLASH = 'http://127.0.0.1:1/flash';
  const profile = { serverUrl: hubUrl, token, username: 'tester', profileId: 'p-task-desc', displayName: 'tester', networkId };
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
        case 'load_voice_credentials': return voiceConfigured ? JSON.stringify(creds) : null;
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
  // 这些流程要点「更多」里的字段(优先级 / 检查项 / 母任务 …):按「上次展开过」起步。渐进展开本身在 test-task-organize 量。
  try { if (localStorage.getItem('task_detail_more_open_v1') === null) localStorage.setItem('task_detail_more_open_v1', '1'); } catch {}
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

let failures = 0;
const rows = [];
function record(vp, what, checks, detail = {}) {
  const ok = Object.values(checks).every(Boolean);
  if (!ok) failures++;
  const row = { vp, what, ...detail, ok, failed: Object.keys(checks).filter(k => !checks[k]).join(',') || '-' };
  rows.push(row);
  console.log(JSON.stringify(row));
}
const rect = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const b = el.getBoundingClientRect();
  return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom, cy: b.y + b.height / 2 };
}, sel);
// Centre lines of the direct visible children of a row (or of the given selectors).
const centres = (page, sels) => page.evaluate((list) => list.map(s => {
  const el = document.querySelector(s);
  if (!el) return { s, cy: null };
  const b = el.getBoundingClientRect();
  return { s, cy: b.y + b.height / 2, h: b.height };
}), sels);
const spread = (cs) => { const ys = cs.map(c => c.cy).filter(v => v != null); return ys.length === cs.length ? Math.max(...ys) - Math.min(...ys) : Infinity; };
const textareaState = (page, sel) => page.locator(sel).evaluate(el => ({ value: el.value, start: el.selectionStart, end: el.selectionEnd, focused: el === document.activeElement }));
const caretTo = async (page, sel, i) => { await page.locator(sel).click(); await page.locator(sel).evaluate((el, a) => el.setSelectionRange(a, a), i); await page.waitForTimeout(120); };
const waitRecording = (page) => page.waitForFunction(() => { const d = document.querySelector('[data-testid="voice-bar-elapsed"]'); return !!d; }, null, { timeout: 8000 });
const say = (page, text) => page.evaluate(t => { window.__flash.text = t; }, text);
const flashCalls = (page) => page.evaluate(() => window.__flash.calls);
const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.png`) });

async function openTasks(page, kind, theme, voiceConfigured = true) {
  await page.addInitScript(initScript, { hubUrl: HUB_URL, token: HUB_TOKEN, networkId: HUB_NETWORK, theme, voiceConfigured });
  if (kind === 'desktop') {
    await page.goto(WEB_URL);
    await page.locator('[data-testid="desktop-rail"] [aria-label="任务"], [data-testid="desktop-rail"] [aria-label="Tasks"]').first().click({ timeout: 30000 });
  } else {
    await page.goto(`${WEB_URL}?safeAreaSim=32,0,24,0`);
    await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 30000 });
    await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'tasks' }));
  }
  await page.locator(tid('tasks-view-board')).first().click({ timeout: 20000 });
  await page.locator('[data-testid^="req-card-"]').first().waitFor({ timeout: 20000 });
}
async function openCard(page, id) {
  await page.locator(tid(`req-card-${id}`)).first().click();
  await page.locator(tid('req-description')).waitFor({ timeout: 10000 });
  await page.waitForTimeout(300);
}

// A 1×1 PNG for paste / drop.
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// ─── desktop ────────────────────────────────────────────────────────────────────────────────────
for (const v of [{ w: 1200, h: 800 }, { w: 1000, h: 700 }]) {
  const vp = `desktop ${v.w}x${v.h}`;
  const reqId = await createReq(`描述全屏 ${v.w}`, '第一段:明天去公司开会。\n\n## 细节\n带上电脑');
  const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, deviceScaleFactor: 1, permissions: ['microphone'], locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).split('\n')[0]));
  await openTasks(page, 'desktop', 'light');
  await openCard(page, reqId);
  await page.locator(tid('req-description-mode-edit')).click();
  await page.locator(tid('voice-mic')).waitFor({ timeout: 8000 });
  const inline = 'textarea[data-testid="req-description-input"]';

  // inline toolbar alignment
  {
    const cs = await centres(page, [`${tid('req-description')} > div:first-child > div:first-child`, tid('req-description-image-button'), tid('voice-mic'), tid('req-description-fullscreen'), tid('req-description-mode')]);
    const tb = await rect(page, tid('req-description-toolbar'));
    const box = await rect(page, tid('req-description'));
    const label = await rect(page, tid('req-description-fullscreen-label'));
    const labelFits = await page.locator(tid('req-description-fullscreen-label')).evaluate(el => el.scrollWidth <= el.clientWidth + 0.5 && el.clientWidth > 0);
    const btn = await rect(page, tid('req-description-fullscreen'));
    const img = await rect(page, tid('req-description-image-button'));
    record(vp, 'inline toolbar: 描述 · 🖼 · 🎤 · ⤢ 全屏 · 编辑/预览 on one centre line; 全屏 on one line', {
      aligned: spread(cs) <= 1, insideBox: tb && box && tb.r <= box.r + 0.5,
      labelOneLine: !!label && label.h < 20, labelNotClipped: labelFits, sameHeightAsIcons: !!btn && !!img && Math.abs(btn.h - img.h) <= 0.5,
    }, { spread: r1(spread(cs)), labelH: label && r1(label.h), btnH: btn && r1(btn.h), toolbarRight: tb && r1(tb.r), boxRight: box && r1(box.r) });
    await shot(page, `desktop-${v.w}-inline-edit`);
  }

  // inline 🎤 → bar → 完成 inserts at the caret
  {
    const before = (await textareaState(page, inline)).value;
    const at = before.indexOf('开会');
    await caretTo(page, inline, at);
    await say(page, '上午');
    await page.locator(tid('voice-mic')).click();
    await waitRecording(page);
    await page.waitForTimeout(900);
    const bar = await rect(page, tid('voice-bar'));
    const box = await rect(page, tid('req-description'));
    const barItems = await centres(page, [tid('voice-bar-dot'), tid('voice-bar-level'), tid('voice-bar-elapsed'), tid('voice-bar-hint'), tid('voice-bar-cancel'), tid('voice-bar-done')]);
    const phoneBits = await page.evaluate(() => ({ overlay: !!document.querySelector('[data-testid="voice-overlay"], [data-testid="voice-hold-bar"]'), gesture: /上滑|按住/.test(document.body.innerText) }));
    await shot(page, `desktop-${v.w}-inline-recording`);
    await page.locator(tid('voice-bar-done')).click();
    await page.waitForFunction(() => !document.querySelector('[data-testid="voice-bar"]'), null, { timeout: 8000 });
    const after = await textareaState(page, inline);
    const want = before.slice(0, at) + '上午' + before.slice(at);
    record(vp, 'inline 🎤: bar inside the description, inserted at the caret, caret after it, focus kept', {
      barInside: !!bar && bar.x >= box.x - 0.5 && bar.r <= box.r + 0.5,
      barAligned: spread(barItems) <= 1,
      noPhoneOverlay: !phoneBits.overlay, noGestureCopy: !phoneBits.gesture,
      inserted: after.value === want, caret: after.start === at + 2 && after.end === at + 2, focused: after.focused,
    }, { barSpread: r1(spread(barItems)), caret: after.start, value: after.value.slice(0, 20) });
  }

  // keyboard shortcut Ctrl+Shift+M toggles
  {
    const before = (await textareaState(page, inline)).value;
    await caretTo(page, inline, 0);
    await say(page, '备注');
    const calls0 = await flashCalls(page);
    await page.keyboard.press('Control+Shift+M');
    await waitRecording(page);
    await page.waitForTimeout(900);
    const toast = await page.evaluate(() => document.body.innerText.includes('先打开一个会话'));
    await page.keyboard.press('Control+Shift+M');
    await page.waitForFunction(() => !document.querySelector('[data-testid="voice-bar"]'), null, { timeout: 8000 });
    const after = await textareaState(page, inline);
    record(vp, 'shortcut Ctrl+Shift+M: start / stop, inserted at the caret, no 「先打开一个会话」', {
      inserted: after.value === '备注' + before, recognised: (await flashCalls(page)) === calls0 + 1, noToast: !toast,
    }, { value: after.value.slice(0, 12) });
  }

  // full screen
  {
    await page.locator(tid('req-description-fullscreen')).click();
    await page.locator(tid('req-description-fullscreen')).nth(1).waitFor({ timeout: 8000 }).catch(() => {});
    await page.locator('[data-testid="req-description-split"]').waitFor({ timeout: 8000 });
    await page.waitForTimeout(400);
    const full = await page.evaluate(() => { const el = [...document.querySelectorAll('[data-testid="req-description-fullscreen"]')].find(e => e.getBoundingClientRect().width > 300); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
    const src = await rect(page, tid('req-description-split-source'));
    const pre = await rect(page, tid('req-description-split-preview'));
    const split = await rect(page, tid('req-description-split'));
    const tb = await centres(page, [tid('req-description-full-mode'), tid('req-description-full-image'), `${tid('req-description-full-toolbar')} ${tid('voice-mic')}`, tid('req-description-full-close')]);
    await shot(page, `desktop-${v.w}-full-split`);
    record(vp, 'full screen: covers the window, opens in 左右 with equal panes, toolbar on one centre line', {
      covers: !!full && Math.abs(full.x) <= 1 && Math.abs(full.y) <= 1 && Math.abs(full.w - v.w) <= 1 && Math.abs(full.h - v.h) <= 1,
      equalPanes: !!src && !!pre && Math.abs(src.w - pre.w) <= 2, fills: !!split && Math.abs(src.w + pre.w - (split.w - 2)) <= 2,
      toolbarAligned: spread(tb) <= 1,
      // focus shows on the whole frame (accent), not as the browser's black outline around the left pane only
      noBrowserOutline: await page.locator('textarea[data-testid="req-description-full-input"]').evaluate(el => { el.focus(); return getComputedStyle(el).outlineStyle === 'none'; }),
    }, { src: src && r1(src.w), pre: pre && r1(pre.w), toolbarSpread: r1(spread(tb)) });

    const fullInput = 'textarea[data-testid="req-description-full-input"]';
    // typing shows up in the preview (debounced)
    await caretTo(page, fullInput, (await textareaState(page, fullInput)).value.length);
    await page.keyboard.type('\n\n预览同步检查');
    await page.waitForTimeout(500);
    const previewHas = await page.evaluate(() => document.querySelector('[data-testid="req-description-split-preview"]').innerText.includes('预览同步检查'));
    // divider drag
    const div = await rect(page, tid('req-description-split-divider'));
    await page.mouse.move(div.x + div.w / 2, div.cy);
    await page.mouse.down();
    await page.mouse.move(div.x + div.w / 2 + 120, div.cy, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const src2 = await rect(page, tid('req-description-split-source'));
    record(vp, 'full screen: preview follows typing; dragging the divider resizes the panes', { previewHas, resized: src2.w - src.w > 80 }, { grew: r1(src2.w - src.w) });

    // paste + drop an image
    const beforeImg = (await textareaState(page, fullInput)).value;
    await caretTo(page, fullInput, 0);
    await page.locator(fullInput).evaluate((el, b64) => {
      const bin = atob(b64); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const dt = new DataTransfer(); dt.items.add(new File([u8], 'paste.png', { type: 'image/png' }));
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, PNG_B64);
    await page.waitForFunction(() => /!\[paste\.png\]\(\/api\/files\//.test(document.querySelector('textarea[data-testid="req-description-full-input"]').value), null, { timeout: 15000 }).catch(() => {});
    await page.locator(fullInput).evaluate((el, b64) => {
      const bin = atob(b64); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const dt = new DataTransfer(); dt.items.add(new File([u8], 'drop.png', { type: 'image/png' }));
      el.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
      el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, PNG_B64);
    await page.waitForFunction(() => /!\[drop\.png\]\(\/api\/files\//.test(document.querySelector('textarea[data-testid="req-description-full-input"]').value), null, { timeout: 15000 }).catch(() => {});
    const imgVal = (await textareaState(page, fullInput)).value;
    record(vp, 'full screen: paste and drop upload to the hub and insert ![…](/api/files/…)', {
      pasted: /!\[paste\.png\]\(\/api\/files\/[^)]+\)/.test(imgVal), dropped: /!\[drop\.png\]\(\/api\/files\/[^)]+\)/.test(imgVal), keptText: imgVal.includes(beforeImg.trim().slice(0, 8)),
    });

    // 🎤 in full screen: Esc cancels (and does not close full screen); Enter completes
    const val0 = (await textareaState(page, fullInput)).value;
    const at = val0.indexOf('带上电脑');
    await caretTo(page, fullInput, at);
    const c0 = await flashCalls(page);
    await page.locator(`${tid('req-description-full-toolbar')} ${tid('voice-mic')}`).click();
    await waitRecording(page);
    await page.waitForTimeout(700);
    const fbar = await rect(page, tid('voice-bar'));
    const body = await rect(page, tid('req-description-split'));
    await shot(page, `desktop-${v.w}-full-recording`);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-testid="voice-bar"]'), null, { timeout: 8000 });
    const stillFull = !!(await rect(page, tid('req-description-split')));
    if (!stillFull) {
      // The Esc that cancelled recording also closed the full screen: record it and skip the rest of this viewport.
      record(vp, 'full screen 🎤: Esc cancels recording without leaving full screen', { stillFull });
      await ctx.close();
      continue;
    }
    const afterCancel = (await textareaState(page, fullInput)).value;
    await caretTo(page, fullInput, at);
    await say(page, '和充电器');
    await page.locator(`${tid('req-description-full-toolbar')} ${tid('voice-mic')}`).click();
    await waitRecording(page);
    await page.waitForTimeout(900);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.querySelector('[data-testid="voice-bar"]'), null, { timeout: 8000 });
    const afterDone = await textareaState(page, fullInput);
    record(vp, 'full screen 🎤: bar below the editor; Esc cancels without leaving full screen; Enter inserts at the caret', {
      barBelow: !!fbar && fbar.y >= body.b - 0.5, cancelUnchanged: afterCancel === val0, stillFull, cancelNoAsr: true,
      inserted: afterDone.value === val0.slice(0, at) + '和充电器' + val0.slice(at), caret: afterDone.start === at + 4, recognisedOnce: (await flashCalls(page)) === c0 + 1,
    }, { caret: afterDone.start });

    // 阅读 hides 🖼 / 🎤; Esc closes; inline back to 预览
    await page.locator(tid('req-description-full-mode-read')).click();
    await page.waitForTimeout(300);
    const readTools = await page.evaluate(() => ({ img: !!document.querySelector('[data-testid="req-description-full-image"]'), mic: !!document.querySelector('[data-testid="req-description-full-toolbar"] [data-testid="voice-mic"]'), read: !!document.querySelector('[data-testid="req-description-full-read"]') }));
    await shot(page, `desktop-${v.w}-full-read`);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-testid="req-description-full-toolbar"]'), null, { timeout: 8000 });
    await page.waitForTimeout(400);
    const inlinePreview = !!(await rect(page, tid('req-description-preview')));
    const detailOpen = !!(await rect(page, tid('req-edit-save')));
    record(vp, 'full screen 阅读: no 🖼 / 🎤; Esc closes only the full screen (details stay open) and shows 预览', { read: readTools.read, noImg: !readTools.img, noMic: !readTools.mic, inlinePreview, detailOpen });

    // save: everything above lands on the hub
    await page.locator(tid('req-edit-save')).click();
    await page.waitForTimeout(800);
    const row = await hubRow(reqId);
    record(vp, '保存修改 writes the voice + image edits to the hub', { saved: row.description === afterDone.value });
  }
  record(vp, 'no page errors', { none: errors.length === 0 }, { errors: errors.slice(0, 2).join(' | ') });
  await ctx.close();
}

// desktop: recognition not configured → 「去设置」; unsaved changes → save first
{
  const vp = 'desktop 1200x800 (voice not configured)';
  const reqId = await createReq('描述未配置语音', '一段描述');
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1, permissions: ['microphone'], locale: 'zh-CN' });
  const page = await ctx.newPage();
  await openTasks(page, 'desktop', 'dark', false);
  await openCard(page, reqId);
  await page.locator(tid('req-description-mode-edit')).click();
  await page.locator(tid('voice-mic')).click();
  await page.locator(tid('voice-settings-prompt')).waitFor({ timeout: 8000 }).catch(() => {});
  const clean = await page.evaluate(() => document.querySelector('[data-testid="voice-settings-prompt"]')?.innerText ?? '');
  await shot(page, 'desktop-unconfigured-link');
  await page.locator('textarea[data-testid="req-description-input"]').click();
  await page.keyboard.type('改');
  await page.locator(tid('voice-mic')).click();
  await page.waitForTimeout(400);
  const dirty = await page.evaluate(() => document.querySelector('[data-testid="voice-settings-prompt"]')?.innerText ?? '');
  await shot(page, 'desktop-unconfigured-save-first');
  record(vp, 'not configured: 「去设置」 link; with unsaved changes it says to save first', { link: /去设置/.test(clean), saveFirst: /先保存修改/.test(dirty) && !/去设置 ›/.test(dirty) }, { clean, dirty });
  await ctx.close();
}

// ─── phone ──────────────────────────────────────────────────────────────────────────────────────
{
  const vp = 'phone 390x844';
  const reqId = await createReq('描述手机全屏', '明天去公司开会');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, userAgent: ANDROID_UA, hasTouch: true, permissions: ['microphone'], locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).split('\n')[0]));
  await openTasks(page, 'phone', 'light');
  await openCard(page, reqId);
  await page.locator(tid('req-description-mode-edit')).click();
  await page.waitForTimeout(300);
  const inlineMic = await page.evaluate(() => !!document.querySelector('[data-testid="req-description"] [data-testid="voice-mic"]'));
  record(vp, 'detail page small editor: no 🎤 (voice is on the full-screen page)', { noMic: !inlineMic });
  await page.locator(tid('req-description-fullscreen')).click();
  await page.locator(tid('req-description-page')).waitFor({ timeout: 8000 });
  await page.waitForTimeout(500);
  const pg = await rect(page, tid('req-description-page'));
  const head = await centres(page, [tid('req-description-page-back'), `${tid('req-description-page-header')} > div:nth-child(2)`, tid('req-description-page-image'), tid('req-description-page-mode')]);
  const barWrap = await rect(page, tid('req-description-page-voice'));
  const bar = await rect(page, tid('voice-hold-bar'));
  await shot(page, 'phone-page-edit');
  record(vp, 'page: covers the screen; ‹ / 描述 / 🖼 / 编辑·预览 on one centre line; 按住 说话 at the bottom inside the gutters', {
    covers: !!pg && Math.abs(pg.w - 390) <= 1 && Math.abs(pg.h - 844) <= 1,
    headerAligned: spread(head) <= 1,
    bar: !!bar, gutters: !!bar && Math.abs(bar.x - 16) <= 1 && Math.abs(390 - bar.r - 16) <= 1,
    aboveInset: !!barWrap && !!bar && barWrap.b - bar.b >= 24 - 0.5,
  }, { headerSpread: r1(spread(head)), barX: bar && r1(bar.x), barRight: bar && r1(390 - bar.r), bottomGap: barWrap && bar && r1(barWrap.b - bar.b) });

  const input = 'textarea[data-testid="req-description-page-input"]';
  const before = (await textareaState(page, input)).value;
  const at = before.indexOf('开会');
  await caretTo(page, input, at);
  await page.locator(input).evaluate(el => el.blur());
  await say(page, '上午');
  const b = await rect(page, tid('voice-hold-bar'));
  await page.mouse.move(b.x + b.w / 2, b.cy);
  await page.mouse.down();
  await page.locator(tid('voice-overlay')).waitFor({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(900);
  const ov = await rect(page, tid('voice-overlay'));
  await shot(page, 'phone-page-holding');
  await page.mouse.up();
  await page.waitForFunction((a) => document.querySelector('textarea[data-testid="req-description-page-input"]').value.includes('上午'), at, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(300);
  const s1 = await textareaState(page, input);
  // second utterance continues after the first
  await say(page, '九点');
  await page.mouse.move(b.x + b.w / 2, b.cy);
  await page.mouse.down();
  await page.waitForTimeout(900);
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('textarea[data-testid="req-description-page-input"]').value.includes('九点'), null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(300);
  const s2 = await textareaState(page, input);
  record(vp, 'hold: WeChat overlay covers the page; inserted at the caret, not focused; next utterance continues after it', {
    overlay: !!ov && Math.abs(ov.w - 390) <= 1 && ov.h >= 844 - 32 - 1,
    inserted: s1.value === before.slice(0, at) + '上午' + before.slice(at), notFocused: !s1.focused,
    continued: s2.value === before.slice(0, at) + '上午九点' + before.slice(at),
  }, { v1: s1.value, v2: s2.value });

  await page.locator(tid('req-description-page-mode-preview')).click();
  await page.waitForTimeout(300);
  const pv = await page.evaluate(() => ({ bar: !!document.querySelector('[data-testid="voice-hold-bar"]'), img: !!document.querySelector('[data-testid="req-description-page-image"]') }));
  await shot(page, 'phone-page-preview');
  await page.locator(tid('req-description-page-back')).click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="req-description-page"]'), null, { timeout: 8000 });
  await page.locator(tid('req-edit-save')).click();
  await page.waitForTimeout(800);
  const row = await hubRow(reqId);
  record(vp, '预览 hides the bar and 🖼; ‹ closes; 保存修改 writes it to the hub', { noBar: !pv.bar, noImg: !pv.img, saved: row.description === s2.value }, { hub: row.description });
  record(vp, 'no page errors', { none: errors.length === 0 }, { errors: errors.slice(0, 2).join(' | ') });
  await ctx.close();
}

await browser.close();
web.close();
console.log('\n| viewport | check | ok | failed |\n|---|---|---|---|');
for (const r of rows) console.log(`| ${r.vp} | ${r.what} | ${r.ok ? 'PASS' : 'FAIL'} | ${r.failed} |`);
console.log(`\n${rows.length - failures}/${rows.length} rows passed`);
process.exit(failures ? 1 : 0);
