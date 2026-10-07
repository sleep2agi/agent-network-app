// Chat time stamps are never cut (board #683). Owner 2026-10-07, iOS phone: the centred time pill
// read 「09:0」/「09:3」 and the author line read 「<agent> · 主动汇报 · 09:…」 — the last digits of
// the time were clipped / ellipsized.
//
// In the real app (expo web export + the layout sweep's in-page Tauri stub: no hub, no port, no
// HOME), at phone 375 / 390 and desktop, for two conversations — a normal alias and a very long
// placeholder alias with a very long foreign sender — every element that paints a 「HH:MM」 time:
//
//   (a) full      the time string (e.g. 09:30) is in the element, on ONE line
//   (b) unclipped the painted range of the time glyphs lies inside the element's visible box and
//                 every overflow-hidden ancestor (an ellipsized / clipped tail fails here)
//   (c) width     the time's visible width ≥ its intrinsic width (same font, nowrap, measured
//                 off-screen in the same page)
//   (d) priority  the box holding the time never overflows (scrollWidth ≤ clientWidth); on a
//                 long-name line the name is the part that is truncated (reported per row)
// The same checks run over every other small HH:MM text on screen (the conversation list's row time).
//
// Registered in tests/drives.json (stub: run by drives.yml). Native layout is covered by src/chat-time-visible.test.ts
// (same style fragments through Yoga).
//
//   WEB_DIR=<expo web export> [OUT=<png dir>] [TAG=before|after] [WIDTHS=375,390] \
//     [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] node tests/test-chat-time-visible/drive.mjs
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium, TEST_LOCALE } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
const TAG = process.env.TAG || 'run';
if (OUT) mkdirSync(OUT, { recursive: true });

const PHONE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36';
const widths = (process.env.WIDTHS || '375,390').split(',').map(Number);
const LAYOUTS = [
  ...widths.map(w => ({ name: `phone${w}`, w, h: 844, ua: PHONE_UA })),
  { name: 'desktop', w: 1300, h: 850, ua: undefined },
];
// Placeholder names only.
const LONG_ALIAS = '示例-超长节点名称用于验证时间不被截断-ABCDEFGHIJKLMNOP';
const LONG_SENDER = '示例-超长发送方名字用于验证截断的是名字而不是时间-0123456789';
const CHATS = [
  { alias: '示例-A', long: false },
  { alias: LONG_ALIAS, long: true },
];

const chatInit = ({ longAlias, longSender }) => {
  // Fixed wall-clock times today (page TZ), so the headers read 07:45 / 08:20 / 09:00 / 09:30.
  const at = (h, m) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); };
  const rows = (to, sender) => [
    { task_id: `t_tv_4_${to}`, from_name: sender, to_name: to, content: '确保示例节点正常运行', status: 'delivered', priority: 'normal', created_at: at(9, 30), updated_at: at(9, 30) },
    { task_id: `t_tv_2_${to}`, from_name: 'tester', to_name: to, content: '示例任务:检查一下构建', result: '示例回复:构建通过。', status: 'replied', priority: 'normal', created_at: at(8, 20), updated_at: at(8, 21), completed_at: at(8, 21) },
    { task_id: `t_tv_1_${to}`, from_name: 'scheduler', to_name: to, content: '每天早上汇报', status: 'delivered', priority: 'normal', created_at: at(7, 45), updated_at: at(7, 45) },
  ];
  window.__chatTasksFixture = [...rows('示例-A', 'scheduler'), ...rows(longAlias, longSender)];
  window.__chatTasksPaged = true; // the stub then filters by to_name: each conversation gets its own rows
  window.__userMessagesFixture = ['示例-A', longAlias].map((a, i) => ({ message_id: `dm_tv_${i}`, from_session: a, kind: 'message', title: '定时任务被卡住', content: '示例正文:上一次执行还没有完成,之后的执行都被跳过。', created_at: at(9, 0), status: 'unread' }));
};

/** In the page: every element that paints a HH:MM time, with the checks' raw numbers. */
const measure = ({ longSender, longAlias }) => {
  const TIME = /\d{2}:\d{2}/;
  const out = [];
  const clipBox = (el) => {
    const b = el.getBoundingClientRect();
    let L = b.left, R = b.right, T = b.top, B = b.bottom;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const r = a.getBoundingClientRect();
      L = Math.max(L, r.left); R = Math.min(R, r.right); T = Math.max(T, r.top); B = Math.min(B, r.bottom);
    }
    return { L, R, T, B };
  };
  const natural = (el, s) => {
    const cs = getComputedStyle(el);
    const span = document.createElement('span');
    span.textContent = s;
    // longhands: the `font` shorthand reads as '' once font-variant-numeric is set (tabular-nums)
    Object.assign(span.style, { position: 'absolute', left: '-9999px', top: '0', whiteSpace: 'nowrap', fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight, fontStyle: cs.fontStyle, letterSpacing: cs.letterSpacing, fontVariantNumeric: cs.fontVariantNumeric });
    document.body.appendChild(span);
    const w = span.getBoundingClientRect().width;
    span.remove();
    return w;
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const m = TIME.exec(n.textContent);
    if (!m) continue;
    const el = n.parentElement;
    if (!el.getClientRects().length) continue;
    // only chat chrome: the author line / time pill (not bubble bodies, not the agent list)
    const fontSize = parseFloat(getComputedStyle(el).fontSize);
    if (fontSize > 13) continue;
    const inChat = !!el.closest('[data-testid^="chat-item-"]');
    const r = document.createRange();
    r.setStart(n, m.index); r.setEnd(n, m.index + 5);
    const rects = [...r.getClientRects()].filter(q => q.width > 0);
    const rr = r.getBoundingClientRect();
    // the element that owns the visible box: walk up to the first block-level box (RN-web Text = div)
    let box = el; while (box && getComputedStyle(box).display === 'inline') box = box.parentElement;
    const cb = clipBox(box);
    const cs = getComputedStyle(box);
    // text-overflow: ellipsis clips at the content box
    const contentR = box.getBoundingClientRect().right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);
    const visR = Math.min(cb.R, cs.overflowX !== 'visible' ? contentR : Infinity);
    const visibleW = Math.max(0, Math.min(rr.right, visR) - Math.max(rr.left, cb.L));
    const pill = getComputedStyle(box).backgroundColor !== 'rgba(0, 0, 0, 0)' || getComputedStyle(box.parentElement).backgroundColor !== 'rgba(0, 0, 0, 0)' && box.parentElement.getBoundingClientRect().width < 200;
    // the author line row (for the priority check): the line's text elements other than the time's
    const line = box.parentElement;
    const nameEl = [...line.querySelectorAll('div[dir="auto"], span')].find(e => e !== box && !e.contains(box) && e.textContent.trim() && !TIME.test(e.textContent)) || null;
    const combined = box.textContent;
    out.push({
      kind: !inChat ? 'list' : pill ? 'pill' : 'header',
      text: combined.slice(0, 80),
      time: m[0],
      lines: rects.length,
      timeLeft: rr.left, timeRight: rr.right, visR, clipL: cb.L,
      visibleW, naturalW: natural(box, m[0]),
      boxW: box.getBoundingClientRect().width,
      boxScrollW: box.scrollWidth, boxClientW: box.clientWidth,
      nameTrunc: nameEl ? nameEl.scrollWidth > nameEl.clientWidth + 0.5 : null,
      nameText: nameEl ? nameEl.textContent.slice(0, 40) : null,
      hasLong: combined.includes(longSender.slice(0, 8)) || combined.includes(longAlias.slice(0, 8)) || (nameEl && (nameEl.textContent.includes(longSender.slice(0, 8)) || nameEl.textContent.includes(longAlias.slice(0, 8)))),
    });
  }
  return out;
};

const web = await serveExport(WEB);
const browser = await chromium.launch({ headless: true, executablePath: findChromium(), args: ['--no-sandbox'] });
const rows = [];
let failed = 0;
const r1 = (n) => Math.round(n * 10) / 10;
for (const L of LAYOUTS) {
  for (const C of CHATS) {
    const ctx = await browser.newContext({ viewport: { width: L.w, height: L.h }, ...(L.ua ? { userAgent: L.ua } : {}), colorScheme: 'light', deviceScaleFactor: 2, locale: TEST_LOCALE, timezoneId: 'Asia/Shanghai' });
    const page = await ctx.newPage();
    const label = `${L.name}/${C.long ? 'long-name' : 'normal'}`;
    try {
      await page.addInitScript(chatInit, { longAlias: LONG_ALIAS, longSender: LONG_SENDER });
      await page.addInitScript(initScript, { theme: 'light' });
      // the long alias must exist in the roster: append it to the stub's /api/status answer
      await page.addInitScript(({ longAlias }) => {
        Object.defineProperty(window, '__routeOverride', { configurable: true, get: () => (u, body, method) => {
          if (u.pathname === '/api/status') return { ok: true, files_capable: true, sessions: [{ alias: longAlias, status: 'idle', agent: 'claude-code', runtime: 'agent-node', node_id: 'n_tv_long', updated_at: new Date().toISOString() }, { alias: '示例-A', status: 'idle', agent: 'claude-code', runtime: 'agent-node', node_id: 'n_sweep_a', updated_at: new Date().toISOString() }] };
          return undefined;
        }, set: () => {} });
      }, { longAlias: LONG_ALIAS });
      await page.goto(`${web.url}${L.ua ? '?safeAreaSim=32,0,24,0' : ''}`);
      await page.getByText(C.alias, { exact: true }).first().waitFor({ timeout: 20000 });
      await page.waitForTimeout(600);
      const all = new Map();
      // the conversation list first (phone: its own screen; desktop: the left pane)
      for (const e of await page.evaluate(measure, { longSender: LONG_SENDER, longAlias: LONG_ALIAS })) all.set(`${e.kind}|${e.text}|list`, e);
      if (OUT) await page.screenshot({ path: `${OUT}/683-${TAG}-${L.name}-${C.long ? 'long' : 'normal'}-list.png` });
      await page.getByText(C.alias, { exact: true }).first().click();
      await page.getByText('确保示例节点正常运行', { exact: true }).first().waitFor({ timeout: 15000 });
      await page.waitForTimeout(800);
      for (let step = 0; step < 6; step++) {
        for (const e of await page.evaluate(measure, { longSender: LONG_SENDER, longAlias: LONG_ALIAS })) {
          const k = `${e.kind}|${e.text}`;
          if (!all.has(k)) all.set(k, e);
        }
        if (OUT && step === 0) await page.screenshot({ path: `${OUT}/683-${TAG}-${L.name}-${C.long ? 'long' : 'normal'}.png` });
        await page.mouse.move(L.w * 0.5, L.h / 2);
        await page.mouse.wheel(0, -300);
        await page.waitForTimeout(250);
      }
      if (!all.size) throw new Error('no time element found');
      const kinds = new Set([...all.values()].map(e => e.kind));
      if (!kinds.has('pill') || !kinds.has('header')) { failed++; rows.push({ label, kind: '-', text: '-', ok: 'FAIL', note: `only ${[...kinds].join(',')} found` }); }
      for (const e of all.values()) {
        const a = e.lines === 1;
        const b = e.timeRight <= e.visR + 0.5 && e.timeLeft >= e.clipL - 0.5;
        const c = e.visibleW + 0.5 >= e.naturalW;
        // (d) whatever is cut on this line, it is not the box that holds the time
        const d = e.boxScrollW <= e.boxClientW + 0.5;
        const ok = a && b && c && d;
        if (!ok) failed++;
        rows.push({ label, kind: e.kind, text: e.text, ok: ok ? 'PASS' : 'FAIL',
          note: `time=${e.time} lines=${e.lines} visibleW=${r1(e.visibleW)} naturalW=${r1(e.naturalW)} timeRight=${r1(e.timeRight)} visibleRight=${r1(e.visR)}${e.hasLong ? ` nameTruncated=${e.nameTrunc}` : ''}${a ? '' : ' [a]'}${b ? '' : ' [b]'}${c ? '' : ' [c]'}${d ? '' : ' [d]'}` });
      }
    } catch (err) {
      failed++;
      rows.push({ label, kind: '-', text: '-', ok: 'FAIL', note: `NOT RUN: ${String(err.message || err).split('\n')[0].slice(0, 120)}` });
    }
    await ctx.close();
  }
}
await browser.close(); web.close();

console.log(`\n| layout | kind | text | result | measured |\n|---|---|---|---|---|`);
for (const r of rows) console.log(`| ${r.label} | ${r.kind} | ${r.text.replace(/\|/g, '/')} | ${r.ok} | ${r.note} |`);
console.log(`\n${TAG}: ${rows.length} rows, ${failed} failing`);
process.exit(failed || !rows.length ? 1 : 0);
