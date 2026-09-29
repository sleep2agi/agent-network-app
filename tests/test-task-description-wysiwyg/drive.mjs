// 任务描述所见即所得(RichDescriptionEditor.web.tsx / rich-markdown.ts):对着 web 导出点真按钮、打真字、量真框。
// Not in CI: needs Playwright + Chromium and a web export. No hub process: every hub request is answered in the page
// (desktop-shell Tauri stub, placeholder data only), and every PATCH body is recorded in window.__patches.
//
//   WEB_DIR=<expo export dir> OUT=<png dir> PLAYWRIGHT_MODULE=<…/playwright/index.mjs> [THEME=dark] node tests/test-task-description-wysiwyg/drive.mjs
//
// desktop 1200×800 and 1440×900 (mouse):
//   layout     opens in 富文本 (not 预览); the rich frame has the same left / right / width as the 源码 textarea (±0.5px)
//              and the header row (描述 · 🖼 · 🎤 · ⤢ · 富文本/源码) sits on one centre line ±1px
//   no-edit    a description in non-canonical Markdown (* bullets, bare URL, CJK table): open, click in, toggle
//              源码 → 富文本 → 源码 → 富文本, click 保存修改 → no PATCH, save stays disabled, source bytes identical
//   type       type a heading / bullet list / checkbox / bold with Markdown shortcuts and the toolbar → 保存修改 →
//              PATCH body `description` is exactly the expected Markdown
//   source     源码 shows that Markdown; editing it and switching back renders the edit (italic); toggling both ways
//              without edits changes nothing
//   checkbox   ticking a checkbox writes only that line (- [ ] → - [x])
//   paste      pasting a PNG uploads it and inserts ![…](/api/files/<id>) (shown as an image); pasted Markdown text
//              becomes formatting, not literal ## / **
//   voice      caret in the middle of a paragraph → 🎤 → 完成 → recognised text inserted at the caret
//   full       ⤢ from 富文本 opens the full screen on 富文本 (editable, 🖼 / 🎤 shown); typing there shows up inline on exit
//   unsafe     a description with raw HTML stays 编辑 / 预览 with the explanation; no rich editor
// Exit 1 when any assertion fails.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { serveExport, findChromium } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { WEB_DIR: WEB, OUT } = process.env;
if (!WEB || !OUT) throw new Error('need WEB_DIR OUT');
mkdirSync(OUT, { recursive: true });
const server = await serveExport(WEB);

// 真实形状的描述(占位内容)。
const DESCRIPTIONS = {
  'r_nonCanonical': '## 原始反馈\n\n> 富文本的直接编辑\n> 底层还是存 Markdown\n\n* 星号列表\n* 第二项\n\n看 https://example.com/a 这里\n\n| 平台 | 结论 |\n| --- | --- |\n| 桌面 | 所见即所得 |',
  'r_empty': '',
  'r_tasks': '## 进展\n\n- [x] 第一步\n- [ ] 第二步\n- [ ] 第三步',
  'r_voice': '第一段:明天开会。',
  'r_html': '<details><summary>折叠</summary>\n\n内容\n\n</details>',
};

const initScript = ({ theme, descriptions }) => {
  const HUB = 'http://mock-hub.invalid';
  const FLASH = 'http://127.0.0.1:1/flash';
  const profile = { serverUrl: HUB, token: 'placeholder-token', username: 'tester', profileId: 'p-wysiwyg', displayName: 'tester', networkId: 'net-wysiwyg' };
  const creds = { appId: '', accessToken: 'placeholder-api-key-0000', endpoint: FLASH };
  const now = new Date().toISOString();
  const rows = Object.fromEntries(Object.entries(descriptions).map(([id, description], i) => [id, {
    id, name: `示例任务 ${i + 1}`, priority: 'normal', assignee: '', due: '', column: 'pool', createdAt: now, updated_at: now,
    description, checklist: [], owner: null, participants: [], agent_owner: null, project_id: null, parent_id: null, tags: [], issues: [],
  }]));
  window.__patches = [];
  window.__uploads = 0;
  window.__flash = { text: '', calls: 0 };
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const route = (method, url, bodyText) => {
    const u = new URL(url);
    const p = u.pathname;
    if (p === '/api/auth/me') return { ok: true, user: { username: 'tester', user_id: 'u_tester' }, current_network: 'net-wysiwyg', networks: [{ network_id: 'net-wysiwyg', name: 'demo' }] };
    if (p === '/api/status') return { ok: true, sessions: [], files_capable: true };
    if (p === '/api/nodes') return { ok: true, nodes: [], count: 0 };
    if (p === '/api/requirements' && method === 'GET') return { ok: true, requirements: Object.values(rows), capabilities: ['agent_owner', 'description', 'checklist', 'projects', 'due_datetime'] };
    if (p === '/api/requirements/people') return { ok: true, people: [] };
    if (p === '/api/requirements/projects') return { ok: true, projects: [] };
    const m = /^\/api\/requirements\/([^/]+)$/.exec(p);
    if (m && method === 'PATCH') {
      if (!rows[m[1]]) return { __status: 404, ok: false, error: 'requirement_not_found' };
      const body = JSON.parse(bodyText || '{}');
      window.__patches.push({ id: m[1], body });
      Object.assign(rows[m[1]], body, { updated_at: new Date().toISOString() });
      return { ok: true, requirement: rows[m[1]] };
    }
    if (m && rows[m[1]]) return { ok: true, requirement: rows[m[1]] };
    if (p === '/api/upload') { window.__uploads++; return { ok: true, file_id: `f_up${window.__uploads}`, path: '/x', url: `/api/files/f_up${window.__uploads}`, size: 68, mime: 'image/png' }; }
    if (p.startsWith('/api/events')) return { __status: 404, ok: false };
    if (p === '/api/messages') return { ok: true, messages: [], unread: 0, pending_count: 0 };
    if (p === '/api/tasks') return { ok: true, tasks: [] };
    return { ok: true };
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
          let buf; let status = 200; let type = 'application/json'; const headers = [];
          if (String(c.url).startsWith(FLASH)) {
            window.__flash.calls++;
            buf = new TextEncoder().encode(JSON.stringify({ result: { text: window.__flash.text } }));
            headers.push(['X-Api-Status-Code', '20000000']);
          } else if (/\/api\/files\//.test(c.url)) {
            const bin = atob(PNG); buf = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
            type = 'image/png';
          } else {
            const body = route(c.method || 'GET', c.url, c.data ? new TextDecoder().decode(new Uint8Array(c.data)) : '');
            status = body.__status || 200;
            buf = new TextEncoder().encode(JSON.stringify(body));
          }
          const id = ++rid; bodies.set(id, { buf, sent: false });
          return { status, statusText: 'OK', url: c.url, headers: [['content-type', type], ...headers], rid: id };
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

const browser = await chromium.launch({ headless: true, executablePath: findChromium(), args: ['--disable-web-security', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const tid = (id) => `[data-testid="${id}"]`;
const r1 = (n) => Math.round(n * 10) / 10;
let failures = 0;
function record(vp, what, checks, detail = {}) {
  const ok = Object.values(checks).every(Boolean);
  if (!ok) failures++;
  console.log(JSON.stringify({ vp, what, ok, failed: Object.keys(checks).filter(k => !checks[k]).join(',') || '-', ...detail }));
}
const rect = (page, sel) => page.evaluate((s) => {
  const el = [...document.querySelectorAll(s)].find(e => e.getBoundingClientRect().width > 0);
  if (!el) return null;
  const b = el.getBoundingClientRect();
  return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom, cy: b.y + b.height / 2 };
}, sel);
const spread = (cs) => { const ys = cs.map(c => c?.cy).filter(v => v != null); return ys.length === cs.length ? Math.max(...ys) - Math.min(...ys) : Infinity; };
const shot = async (page, name) => {
  await page.evaluate(() => { const el = [...document.querySelectorAll('[data-testid="req-description"]')].find(e => e.getBoundingClientRect().width > 0); el?.scrollIntoView({ block: 'center' }); });
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
};
const patches = (page) => page.evaluate(() => window.__patches);
const content = tid('req-description-rich-content');
const source = 'textarea[data-testid="req-description-input"]';
const saveEnabled = (page) => page.locator(tid('req-edit-save')).evaluate(el => el.getAttribute('aria-disabled') !== 'true');

async function openCard(page, id) {
  await page.locator(tid(`req-card-${id}`)).first().click();
  await page.locator(tid('req-description')).waitFor({ timeout: 10000 });
  await page.waitForTimeout(300);
}
async function closeDetail(page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}
async function save(page) {
  await page.locator(tid('req-edit-save')).click({ force: true });
  await page.waitForTimeout(500);
}
// Caret at the end of the rich editor (or after a given text).
async function caretAfter(page, text) {
  await page.locator(content).evaluate((root, t) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node; let target = null; let offset = 0;
    while (t && (node = walker.nextNode())) { const i = node.data.indexOf(t); if (i >= 0) { target = node; offset = i + t.length; break; } }
    root.focus();
    const sel = getSelection(); const r = document.createRange();
    if (target) r.setStart(target, offset); else { r.selectNodeContents(root); r.collapse(false); }
    r.collapse(true); sel.removeAllRanges(); sel.addRange(r);
  }, text);
  await page.waitForTimeout(150);
}

for (const v of [{ w: 1200, h: 800 }, { w: 1440, h: 900 }]) {
  const vp = `desktop ${v.w}x${v.h}`;
  const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, deviceScaleFactor: 1, permissions: ['microphone', 'clipboard-read', 'clipboard-write'], locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).split('\n')[0]));
  await page.addInitScript(initScript, { theme: process.env.THEME || 'light', descriptions: DESCRIPTIONS });
  await page.goto(server.url);
  await page.locator('[data-testid="desktop-rail"] [aria-label="任务"], [data-testid="desktop-rail"] [aria-label="Tasks"]').first().click({ timeout: 30000 });
  await page.locator(tid('tasks-view-board')).first().click({ timeout: 20000 }).catch(() => {});
  await page.locator('[data-testid^="req-card-"]').first().waitFor({ timeout: 20000 });

  // ── layout + no-edit round trip ──
  {
    await openCard(page, 'r_nonCanonical');
    await page.locator(content).waitFor({ timeout: 8000 });
    const richOn = await page.locator(tid('req-description-mode-rich')).getAttribute('aria-selected');
    const frame = await rect(page, tid('req-description-rich'));
    const header = await rect(page, `${tid('req-description')} > div:first-child`);
    const tb = await rect(page, tid('req-description-rich-toolbar'));
    const cs = await Promise.all([`${tid('req-description')} > div:first-child > div:first-child`, tid('req-description-image-button'), tid('voice-mic'), tid('req-description-fullscreen'), tid('req-description-mode')].map(s => rect(page, s)));
    await shot(page, `desktop-${v.w}-rich-open`);
    // click in, type nothing, toggle both ways twice
    await page.locator(content).click();
    await page.locator(tid('req-description-mode-edit')).click();
    const src1 = await page.locator(source).inputValue();
    const srcRect = await rect(page, source);
    await page.locator(tid('req-description-mode-rich')).click();
    await page.locator(content).click();
    await page.locator(tid('req-description-mode-edit')).click();
    const src2 = await page.locator(source).inputValue();
    await page.locator(tid('req-description-mode-rich')).click();
    const enabled = await saveEnabled(page);
    await save(page);
    const ps = await patches(page);
    record(vp, 'layout: opens in 富文本; rich frame aligned with the 源码 textarea; header on one centre line', {
      opensRich: richOn === 'true',
      sameLeft: !!frame && !!srcRect && Math.abs(frame.x - srcRect.x) <= 0.5,
      sameWidth: !!frame && !!srcRect && Math.abs(frame.w - srcRect.w) <= 0.5,
      headerWidth: !!frame && !!header && Math.abs(frame.x - header.x) <= 0.5 && Math.abs(frame.r - header.r) <= 0.5,
      headerAligned: spread(cs) <= 1,
      toolbarOneRow: !!tb && tb.h <= 36,
    }, { toolbarH: tb && r1(tb.h),  frame: frame && [r1(frame.x), r1(frame.w)], source: srcRect && [r1(srcRect.x), r1(srcRect.w)], header: header && [r1(header.x), r1(header.w)], spread: r1(spread(cs)) });
    record(vp, 'no-edit: open + click + toggle 源码/富文本 twice + 保存 → no PATCH, bytes identical', {
      noPatch: ps.length === 0, saveDisabled: !enabled,
      bytes1: src1 === DESCRIPTIONS.r_nonCanonical, bytes2: src2 === DESCRIPTIONS.r_nonCanonical,
    }, { patches: ps.length });
    await closeDetail(page);
  }

  // ── type with shortcuts + toolbar → PATCH body ──
  {
    await openCard(page, 'r_empty');
    await page.locator(content).waitFor({ timeout: 8000 });
    await page.locator(content).click();
    await page.keyboard.type('## 目标');
    await page.keyboard.press('Enter');
    await page.keyboard.type('- 列表一');
    await page.keyboard.press('Enter');
    await page.keyboard.type('列表二');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('[ ] 待办一');
    await page.keyboard.press('Enter');
    await page.keyboard.type('待办二');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('普通 ');
    await page.keyboard.press('Control+b');
    await page.keyboard.type('加粗');
    await page.keyboard.press('Control+b');
    await page.keyboard.type(' 和 **星号粗** 结束');
    await page.keyboard.press('Enter');
    await page.locator(tid('req-description-rich-tool-h3')).click();
    await page.keyboard.type('工具条标题');
    await page.keyboard.press('Enter');
    await page.locator(tid('req-description-rich-tool-task')).click();
    await page.keyboard.type('工具条复选框');
    await page.waitForTimeout(200);
    const dom = await page.locator(content).evaluate(el => ({ h2: el.querySelector('h2')?.textContent, h3: el.querySelector('h3')?.textContent, lis: el.querySelectorAll('ul:not([data-type]) > li').length, tasks: el.querySelectorAll('ul[data-type="taskList"] > li').length, strong: [...el.querySelectorAll('strong')].map(s => s.textContent) }));
    await shot(page, `desktop-${v.w}-rich-typed`);
    await save(page);
    const ps = await patches(page);
    const want = '## 目标\n\n- 列表一\n- 列表二\n\n- [ ] 待办一\n- [ ] 待办二\n\n普通 **加粗** 和 **星号粗** 结束\n\n### 工具条标题\n\n- [ ] 工具条复选框';
    const got = ps.at(-1)?.body?.description;
    record(vp, 'type: heading / list / checkbox / bold (shortcuts + toolbar) → PATCH description is the expected Markdown', {
      oneBody: ps.length === 1 && Object.keys(ps[0].body).join() === 'description',
      markdown: got === want, rendered: dom.h2 === '目标' && dom.h3 === '工具条标题' && dom.lis === 2 && dom.tasks === 3 && dom.strong.join('|') === '加粗|星号粗',
    }, { got: JSON.stringify(got), dom });

    // ── source toggle: shows the Markdown; edit there → rendered in rich; toggle without edits → nothing changes ──
    await page.locator(tid('req-description-mode-edit')).click();
    const src = await page.locator(source).inputValue();
    await page.locator(source).click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n\n源码里写的 *斜体*');
    await page.locator(tid('req-description-mode-rich')).click();
    await page.locator(content).waitFor();
    const em = await page.locator(content).evaluate(el => el.querySelector('em')?.textContent);
    await page.locator(tid('req-description-mode-edit')).click();
    const src3 = await page.locator(source).inputValue();
    await page.locator(tid('req-description-mode-rich')).click();
    await page.locator(tid('req-description-mode-edit')).click();
    const src4 = await page.locator(source).inputValue();
    await page.locator(tid('req-description-mode-rich')).click();
    record(vp, '源码 toggle: shows the saved Markdown; a source edit renders in rich; toggling without edits keeps bytes', {
      sourceShowsMarkdown: src === want, italicRendered: em === '斜体',
      keptEdit: src3 === `${want}\n\n源码里写的 *斜体*`, toggleNoop: src4 === src3,
    }, { em, src3: JSON.stringify(src3.slice(-20)) });
    await save(page);
    await closeDetail(page);
  }

  // ── tick a checkbox: only that line changes ──
  {
    await openCard(page, 'r_tasks');
    await page.locator(content).waitFor({ timeout: 8000 });
    const before = (await patches(page)).length;
    await page.locator(`${content} ul[data-type="taskList"] > li input[type="checkbox"]`).nth(1).click();
    await page.waitForTimeout(200);
    await save(page);
    const ps = await patches(page);
    const got = ps.at(-1)?.body?.description;
    record(vp, 'checkbox: ticking one writes only that line', {
      patched: ps.length === before + 1, markdown: got === '## 进展\n\n- [x] 第一步\n- [x] 第二步\n- [ ] 第三步',
    }, { got: JSON.stringify(got) });
    await closeDetail(page);
  }

  // ── paste an image + paste Markdown text; voice at the caret ──
  {
    await openCard(page, 'r_voice');
    await page.locator(content).waitFor({ timeout: 8000 });
    // voice: caret after 「明天」
    await caretAfter(page, '明天');
    await page.evaluate(() => { window.__flash.text = '上午'; });
    await page.locator(tid('voice-mic')).click();
    await page.waitForFunction(() => !!document.querySelector('[data-testid="voice-bar-elapsed"]'), null, { timeout: 8000 });
    await page.waitForTimeout(900);
    await page.locator(tid('voice-bar-done')).click();
    await page.waitForFunction(() => !document.querySelector('[data-testid="voice-bar"]'), null, { timeout: 8000 });
    await page.waitForTimeout(200);
    const voiceText = await page.locator(content).innerText();
    // paste PNG at the end
    await caretAfter(page, '');
    await page.locator(content).evaluate((el) => {
      const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      const bin = atob(b64); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const dt = new DataTransfer(); dt.items.add(new File([u8], 'paste.png', { type: 'image/png' }));
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await page.locator(`${content} ${tid('req-description-rich-image-f_up1')} img`).waitFor({ timeout: 10000 }).catch(() => {});
    const img = await page.locator(`${content} ${tid('req-description-rich-image-f_up1')} img`).evaluate(el => ({ src: el.src.slice(0, 5), w: el.naturalWidth })).catch(() => null);
    // paste Markdown text at the end
    await caretAfter(page, '');
    await page.keyboard.press('Enter');
    await page.locator(content).evaluate((el) => {
      const dt = new DataTransfer(); dt.setData('text/plain', '### 贴进来的标题\n\n- **粗** 项');
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await page.waitForTimeout(200);
    const pasted = await page.locator(content).evaluate(el => ({ h3: el.querySelector('h3')?.textContent, strong: el.querySelector('li strong')?.textContent, literal: el.innerText.includes('###') || el.innerText.includes('**') }));
    await shot(page, `desktop-${v.w}-rich-paste`);
    await save(page);
    const got = (await patches(page)).at(-1)?.body?.description;
    record(vp, 'voice + paste: 🎤 inserts at the caret; PNG uploads → ![…](/api/files/…) shown as image; Markdown text pastes as formatting', {
      voiceAtCaret: voiceText.startsWith('第一段:明天上午开会。'),
      imageShown: !!img && img.src === 'blob:' && img.w === 1,
      markdown: got === '第一段:明天上午开会。\n\n![paste.png](/api/files/f_up1)\n\n### 贴进来的标题\n\n- **粗** 项',
      pastedFormatted: pasted.h3 === '贴进来的标题' && pasted.strong === '粗' && !pasted.literal,
    }, { voiceText: voiceText.slice(0, 20), img, got: JSON.stringify(got) });
    await closeDetail(page);
  }

  // ── full screen: 富文本 tab, editable, back inline ──
  {
    await openCard(page, 'r_voice');
    await page.locator(content).waitFor({ timeout: 8000 });
    await page.locator(tid('req-description-fullscreen')).click();
    const fullContent = tid('req-description-full-rich-content');
    await page.locator(fullContent).waitFor({ timeout: 8000 });
    const tab = await page.locator(tid('req-description-full-mode-read')).innerText();
    const tools = { image: await page.locator(tid('req-description-full-image')).count(), mic: await page.locator(`${tid('req-description-full-toolbar')} ${tid('voice-mic')}`).count() };
    const inlineEditors = await page.locator(content).count();
    const fr = await rect(page, tid('req-description-full-rich'));
    const firstTool = await rect(page, tid('req-description-full-rich-tool-h1'));
    const body = await rect(page, fullContent);
    const toolText = firstTool ? firstTool.x + 5 : null;
    await page.locator(fullContent).click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('全屏里加的一段');
    await shot(page, `desktop-${v.w}-rich-full`);
    await page.locator(tid('req-description-full-close')).click();
    await page.locator(content).waitFor({ timeout: 8000 });
    const inlineText = await page.locator(content).innerText();
    record(vp, 'full screen: opens on 富文本 (editable, 🖼 🎤), only one rich editor, edits show inline after exit', {
      richTab: tab.includes('富文本'), tools: tools.image === 1 && tools.mic === 1, oneEditor: inlineEditors === 0,
      fills: !!fr && fr.w > v.w * 0.8, toolbarLinesUpWithText: toolText !== null && !!body && Math.abs(toolText - body.x) <= 1, keptInline: inlineText.includes('全屏里加的一段'),
    }, { tab, tools, fullW: fr && r1(fr.w), toolText: toolText && r1(toolText), bodyX: body && r1(body.x) });
    await closeDetail(page);
    await page.locator(tid('req-edit-save')).count() && await closeDetail(page);
  }

  // ── unsafe: raw HTML stays in 编辑 / 预览 ──
  {
    await page.reload();
    await page.locator('[data-testid="desktop-rail"] [aria-label="任务"], [data-testid="desktop-rail"] [aria-label="Tasks"]').first().click({ timeout: 30000 });
    await page.locator('[data-testid^="req-card-"]').first().waitFor({ timeout: 20000 });
    await openCard(page, 'r_html');
    const notice = await page.locator(tid('req-description-rich-unavailable')).count();
    const rich = await page.locator(content).count();
    const tabs = await page.locator(`${tid('req-description-mode')} [role="tab"]`).allInnerTexts();
    await shot(page, `desktop-${v.w}-rich-unsafe`);
    record(vp, 'unsafe: raw HTML → no rich editor, 编辑 / 预览 with the explanation', {
      notice: notice === 1, noRich: rich === 0, tabs: tabs.join('|') === '编辑|预览',
    }, { tabs });
  }

  record(vp, 'no page errors', { none: errors.length === 0 }, { errors: errors.slice(0, 3) });
  await ctx.close();
}
await browser.close();
server.close();
console.log(failures ? `FAIL ${failures}` : 'PASS');
process.exit(failures ? 1 : 0);
