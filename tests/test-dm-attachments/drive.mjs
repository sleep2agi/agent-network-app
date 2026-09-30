// 私信发图 —— 两个账号端到端(owner 2026-09-30「给人好像发不了图片」,macOS 桌面 0.2.162)。
// Not in CI: needs Playwright + Chromium, a web export, and a throwaway Hub with two synthetic users in one network.
// The Tauri stub forwards every plugin:http request to that Hub with real fetch; SSE (/events) answers 404 so the
// DM pane runs on its 8 s poll. Never point it at 127.0.0.1:9200.
//
//   HUB_JSON=<{ base, net, alice:{token,id}, bob:{token,id}, carol:{token,id} }> WEB_DIR=<expo export dir> \
//   OUT=<png dir> PLAYWRIGHT_MODULE=<…/playwright/index.mjs> node tests/test-dm-attachments/drive.mjs
//
// A hub seeded for it: register dm_alice / dm_bob / dm_carol, add bob and carol to alice's network with agent_access=all
// (a restricted member can't read network files anyway, which would make check 6 pass for the wrong reason), boot on a spare port
// (agent-network server/src: register + addNetworkMember + bootServer, HOME and COMMHUB_DB under mktemp -d).
//
// Desktop (1320×754), alice → bob:
//   1  ⌘V of a screenshot (clipboard file) lands in the DM draft as a thumbnail
//   2  dragging a file onto the DM pane adds a second thumbnail (drop overlay shows while dragging)
//   3  发送 ⇒ the Hub stores both attachments on the DM (GET /api/dm as bob), and alice's own bubble renders both
//      images from the Hub (authed <img>, naturalWidth > 0) — the pre-fix desktop DM drew them with the native-only
//      AuthedThumb, which never loads on web
// Desktop, bob:
//   4  bob's DM with alice renders both images (loaded), tapping one opens the image preview
// Phone (390×844), bob:
//   5  ＋ opens the WeChat panel with 相册 / 文件 inside the DM pane
// Hub ACL (agent-network DM files): with EXPECT_DM_ACL=1 (a Hub that knows ?purpose=dm):
//   6  carol, in the same network but not in the DM, gets 404 on the images; bob gets 200
// Exit 1 when any assertion fails. Against the pre-fix export 1–4 go red.
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { serveExport, findChromium, ANDROID_UA } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { WEB_DIR: WEB, OUT, HUB_JSON } = process.env;
if (!WEB || !OUT || !HUB_JSON) throw new Error('need WEB_DIR OUT HUB_JSON');
const hub = JSON.parse(readFileSync(HUB_JSON, 'utf8'));
if (/:9200\b/.test(hub.base)) throw new Error('refusing to drive the production hub port 9200');
mkdirSync(OUT, { recursive: true });
const web = await serveExport(WEB);
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const tid = (id) => `[data-testid="${id}"]`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
const record = (what, checks, detail = {}) => {
  const ok = Object.values(checks).every(Boolean);
  if (!ok) failures++;
  console.log(JSON.stringify({ what, ok, failed: Object.keys(checks).filter(k => !checks[k]).join(',') || '-', ...detail }));
};

const initScript = ({ profile }) => {
  let rid = 0; const reqs = new Map(); const bodies = new Map();
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
    transformCallback: (cb) => { const id = Math.floor(Math.random() * 1e9); window[`_${id}`] = cb; return id; },
    convertFileSrc: (p) => p,
    invoke: async (cmd, args) => {
      (window.__calls ||= []).push({ cmd, args });
      switch (cmd) {
        case 'load_active_desktop_profile': return JSON.stringify(profile);
        case 'save_desktop_profile': return args.sessionJson;
        case 'read_desktop_profile_file': return null;
        case 'get_theme_preference': return 'light';
        case 'plugin:event|listen': return 0;
        case 'plugin:http|fetch': { const id = ++rid; reqs.set(id, args.clientConfig); return id; }
        case 'plugin:http|fetch_send': {
          const c = reqs.get(args.rid);
          let status = 404, statusText = 'Not Found', headers = [['content-type', 'application/json']], buf = new TextEncoder().encode('{"ok":false}');
          if (!new URL(c.url).pathname.startsWith('/events')) {
            const r = await fetch(c.url, { method: c.method, headers: c.headers, body: c.data ? new Uint8Array(c.data) : undefined });
            status = r.status; statusText = r.statusText; headers = Array.from(r.headers.entries()); buf = new Uint8Array(await r.arrayBuffer());
          }
          const id = ++rid; bodies.set(id, { buf, sent: false });
          return { status, statusText, url: c.url, headers, rid: id };
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

const browser = await chromium.launch({ executablePath: findChromium(), args: ['--disable-web-security'] });
const open = async (who, { phone = false } = {}) => {
  const ctx = await browser.newContext(phone
    ? { viewport: { width: 390, height: 844 }, userAgent: ANDROID_UA, isMobile: true, hasTouch: true }
    : { viewport: { width: 1320, height: 754 }, userAgent: MAC_UA });
  const profile = { serverUrl: hub.base, token: hub[who].token, username: `dm_${who}`, profileId: `p-${who}`, displayName: `dm_${who}`, networkId: hub.net };
  await ctx.addInitScript(initScript, { profile });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log(JSON.stringify({ who, pageerror: String(e).slice(0, 200) })));
  await page.goto(web.url);
  return { ctx, page };
};
const openDm = async (page, peer) => {
  const row = page.locator(tid(`person-row-dm_${peer}`)).first();
  await row.waitFor({ timeout: 30_000 });
  await row.click();
  await page.locator(tid('dm-pane')).waitFor({ timeout: 15_000 });
};
// A real PNG made in the page (distinct colour per file), handed to the app as a File.
const makePng = (color) => new Promise(res => {
  const c = document.createElement('canvas'); c.width = 64; c.height = 48;
  const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, 64, 48);
  c.toBlob(b => res(new File([b], 'image.png', { type: 'image/png' })), 'image/png');
});
// Newest bubble only (the list is inverted: the first match in DOM order is the latest message), so reruns against
// the same hub don't count earlier sends.
const loadedImgs = (page, scope) => page.evaluate(sel => [...(document.querySelector(sel)?.querySelectorAll('img') ?? [])]
  .filter(i => i.complete && i.naturalWidth > 0 && /^blob:/.test(i.currentSrc || i.src)).length, scope);

// ── alice (desktop): paste + drop + send ─────────────────────────────────────
const alice = await open('alice');
await openDm(alice.page, 'bob');
await alice.page.evaluate(async (mk) => {
  const file = await (0, eval)(`(${mk})`)('#e4572e');
  const dt = new DataTransfer(); dt.items.add(file);
  window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, makePng.toString());
await sleep(300);
const afterPaste = await alice.page.locator(tid('dm-draft-thumb')).count();
record('1 paste → draft thumbnail', { oneThumb: afterPaste === 1 }, { thumbs: afterPaste });

const overlaySeen = await alice.page.evaluate(async (mk) => {
  const file = await (0, eval)(`(${mk})`)('#2e86e4');
  const pane = document.querySelector('[data-testid="dm-list"]') || document.querySelector('[data-testid="dm-pane"]');
  const dt = new DataTransfer(); dt.items.add(file);
  pane.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 50));
  const seen = !!document.querySelector('[data-testid="dm-drop-overlay"]');
  pane.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  return seen;
}, makePng.toString());
await sleep(300);
const afterDrop = await alice.page.locator(tid('dm-draft-thumb')).count();
record('2 drop → second thumbnail', { overlay: overlaySeen, twoThumbs: afterDrop === 2 }, { thumbs: afterDrop });
await alice.page.screenshot({ path: join(OUT, '1-alice-draft.png') });

// Fail complete, not fast: when the draft never filled (the pre-fix build), send the same two images through the Hub
// REST API as alice so the rendering checks (3's sender bubble, 4) still run and show their own verdict.
const seededViaRest = afterDrop === 0;
if (seededViaRest) {
  const ids = [];
  for (const color of ['e4572e', '2e86e4']) {
    const png = await alice.page.evaluate(async ([mk, c]) => {
      const f = await (0, eval)(`(${mk})`)(`#${c}`);
      return [...new Uint8Array(await f.arrayBuffer())];
    }, [makePng.toString(), color]);
    const form = new FormData(); form.append('file', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'image.png');
    const up = await (await fetch(`${hub.base}/api/upload?network_id=${hub.net}`, { method: 'POST', body: form, headers: { Authorization: `Bearer ${hub.alice.token}` } })).json();
    ids.push(up.file_id);
  }
  await fetch(`${hub.base}/api/dm`, { method: 'POST', headers: { Authorization: `Bearer ${hub.alice.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ network_id: hub.net, to_user_id: hub.bob.id, message: '', attachments: ids.map(file_id => ({ type: 'file', file_id, name: 'image.png', mime: 'image/png' })) }) });
} else {
  await alice.page.locator(tid('dm-desktop-send')).click();
}
let stored = [];
for (let i = 0; i < 40 && stored.length < 2; i++) {
  await sleep(500);
  const r = await fetch(`${hub.base}/api/dm?network_id=${hub.net}&with=${hub.alice.id}`, { headers: { Authorization: `Bearer ${hub.bob.token}` } });
  const body = await r.json();
  const m = body.messages?.[0];
  stored = m?.meta_json ? (JSON.parse(m.meta_json).attachments ?? []) : [];
}
let aliceLoaded = 0;
for (let i = 0; i < 30 && aliceLoaded < 2; i++) { await sleep(500); aliceLoaded = await loadedImgs(alice.page, tid('dm-msg-out')); }
record('3 send → hub stores both, sender bubble renders both from hub', { sentFromUi: !seededViaRest, stored2: stored.length === 2, rendered2: aliceLoaded === 2, noError: !(await alice.page.locator(tid('dm-error')).count()) }, { stored: stored.length, aliceLoaded });
await alice.page.screenshot({ path: join(OUT, '2-alice-sent.png') });

// ── bob (desktop): sees both, taps to preview ────────────────────────────────
const bob = await open('bob');
await openDm(bob.page, 'alice');
let bobLoaded = 0;
for (let i = 0; i < 40 && bobLoaded < 2; i++) { await sleep(500); bobLoaded = await loadedImgs(bob.page, tid('dm-msg-in')); }
await bob.page.screenshot({ path: join(OUT, '3-bob-received.png') });
// Tauri desktop previews in its own 「图片预览」 window (image-window.ts); anything else falls back to the in-app viewer.
let viewer = false;
if (bobLoaded) {
  await bob.page.locator(`${tid('dm-msg-in')} [aria-label^="预览 "]`).first().click();
  for (let i = 0; i < 10 && !viewer; i++) {
    await sleep(300);
    const calls = await bob.page.evaluate(() => (window.__calls || []).map(c => ({ cmd: c.cmd, args: c.args })));
    const created = calls.find(c => c.cmd === 'plugin:webview|create_webview_window' && /imageViewer=1/.test(JSON.stringify(c.args)));
    viewer = !!created || (await bob.page.locator(tid('image-viewer')).count()) > 0;
  }
  await bob.page.screenshot({ path: join(OUT, '4-bob-preview.png') });
}
record('4 receiver renders both images and taps into the preview', { rendered2: bobLoaded === 2, preview: viewer }, { bobLoaded });

// ── bob (phone): ＋ panel ────────────────────────────────────────────────────
const phone = await open('bob', { phone: true });
await openDm(phone.page, 'alice');
await phone.page.locator(`${tid('dm-input-row')} ${tid('composer-plus')}`).click({ timeout: 10_000 }).catch(() => {});
await sleep(300);
const panel = await phone.page.locator(tid('dm-plus-panel')).count();
const cells = await phone.page.locator(`${tid('dm-plus-album')}, ${tid('dm-plus-file')}`).count();
await phone.page.screenshot({ path: join(OUT, '5-phone-plus.png') });
record('5 phone ＋ opens the album / file panel', { panel: panel === 1, cells: cells === 2 }, { panel, cells });

// ── 6: a member outside the DM ──────────────────────────────────────────────
{
  const ids = stored.map(a => a.file_id);
  const st = async (who, id) => (await fetch(`${hub.base}/api/files/${id}`, { headers: { Authorization: `Bearer ${hub[who].token}` } })).status;
  const carol = await Promise.all(ids.map(id => st('carol', id)));
  const bobS = await Promise.all(ids.map(id => st('bob', id)));
  const checks = { bobReads: bobS.every(s => s === 200) };
  if (process.env.EXPECT_DM_ACL === '1') checks.carol404 = carol.length === 2 && carol.every(s => s === 404);
  record('6 member outside the DM cannot fetch the images', checks, { carol, bob: bobS, enforced: process.env.EXPECT_DM_ACL === '1' });
}

await browser.close();
web.close();
if (failures) { console.error(`FAILED ${failures}`); process.exit(1); }
console.log('ok');
