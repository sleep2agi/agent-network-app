// Chat bubble geometry in the real app (expo web export + the layout sweep's in-page Tauri stub:
// no hub process, no port, no HOME). Owner 2026-09-30 (Android tablet, landscape, 0.2.161): a long
// markdown reply's bubble background ended a few lines early, the rest of the text ran out below it,
// and the reply's quote row (「scheduler: …」) was drawn on top of the body text.
//
// For every bubble in a synthetic chat — long markdown reply + quote, long markdown sent message,
// foreign message with a quote, short reply to a long request — at phone / tablet two-pane / desktop:
//
//   (a) bottom  bubble bottom ≥ bottom of its last text line
//   (b) right   bubble right ≥ right of its widest text line
//   (c) quote   the quote row does not intersect any body text line, and sits below the bubble
//   (d) list    items 1…12 of an ordered list share one text left edge; no marker reaches its text
//
// The web renderer is CSS, not Yoga, so this sweep is the "does the page look right" half; the
// native-layout half (the actual 0.2.161 defect) is src/bubble-layout.test.ts, which runs the same
// styles through Yoga. Not in CI (needs Playwright + Chromium).
//
//   WEB_DIR=<expo web export> [OUT=<png dir>] [TAG=before|after] \
//     [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] node tests/test-chat-bubble-geometry/drive.mjs
//
// Exit 1 when any check fails or any layout could not be opened.
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium, ANDROID_UA } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
const TAG = process.env.TAG || 'run';
if (OUT) mkdirSync(OUT, { recursive: true });

const PHONE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36';
const LAYOUTS = [
  { name: 'phone', w: 390, h: 844, ua: PHONE_UA },
  { name: 'tablet', w: 1280, h: 800, ua: ANDROID_UA },
  { name: 'desktop', w: 1300, h: 850, ua: undefined },
];

// Synthetic text only — shaped like the owner's screenshot: 【】 headings, bullets, long CJK lines.
const LONG_MD = [
  '【最新进展】',
  '',
  '- 示例版本 9.9.9 全平台发布完成。电脑端正式版已上线,镜像 VERSION=9.9.9,5 个平台的更新签名逐一核对通过,9 个安装文件的校验值和镜像一致,下载接口返回 9.9.9。',
  '- 看板已更新并回读确认:',
  '- #101 更新说明、#102 任务搜索、#103 日历视图 → 已完成(写明发布版本和 PR)。',
  '- #104 人员放上面 → 写进展「#105 已合入,随 9.9.10」。',
  '',
  '【下一轮目标 / 预计完成(东八区)】',
  '',
  '- 示例页面更新:14:10。',
  '- 9.9.10(连接复用 + 人员放上面 + 账号复制/编辑):安卓 APK 15:30。',
  '- 账号复制/编辑 PR:15:00。任务权限设计文档:16:00。',
  '- 苹果构建在安卓和电脑端都发完之后再排,优先级最低,预计今天晚些时候。',
  '',
  '收尾一段普通段落:以上时间都是预计,有变化会在这里同步,不另开消息。',
  '',
  // 12 numbered items: two-digit markers get the same hanging indent as one-digit ones
  ...Array.from({ length: 12 }, (_, i) => `${i + 1}. 第 ${i + 1} 步:核对示例清单里的这一项,确认无误后回写进展。`),
].join('\n');
const SCHED = '和示例-B 一起推进 (1) 示例网络支持任务页面支持用户自定义字段 (2) 看板状态回读 (3) 每轮汇报写清预计完成时间';

const chatInit = ({ md, sched }) => {
  const now = Date.now();
  const iso = (m) => new Date(now - m * 60000).toISOString();
  window.__chatTasksFixture = [
    // newest first
    { task_id: 't_geo_4', from_name: 'tester', to_name: '示例-A', content: sched, result: '收到,马上处理。', status: 'replied', priority: 'normal', created_at: iso(4), updated_at: iso(3), completed_at: iso(3) },
    { task_id: 't_geo_3', from_name: '示例-B', to_name: '示例-A', content: `「@示例-C: ${sched}」\n${md}`, status: 'delivered', priority: 'normal', created_at: iso(20), updated_at: iso(20) },
    { task_id: 't_geo_2', from_name: 'tester', to_name: '示例-A', content: md, status: 'delivered', priority: 'normal', created_at: iso(40), updated_at: iso(40) },
    { task_id: 't_geo_1', from_name: 'scheduler', to_name: '示例-A', content: sched, result: md, status: 'replied', priority: 'normal', created_at: iso(60), updated_at: iso(59), completed_at: iso(59) },
  ];
};

/** In the page: every bubble (the painted box around message text) with its text lines and quote row. */
const measure = () => {
  const bg = (el) => { const c = getComputedStyle(el).backgroundColor; return c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent'; };
  const lineRects = (el) => {
    const out = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim()) continue;
      // skip overlays drawn over the bubble on purpose (hover copy / more buttons: icon glyphs)
      let abs = false;
      for (let p = n.parentElement; p && p !== el; p = p.parentElement) if (getComputedStyle(p).position === 'absolute') { abs = true; break; }
      if (abs) continue;
      const r = document.createRange(); r.selectNodeContents(n);
      for (const q of r.getClientRects()) if (q.width > 0 && q.height > 0) out.push({ top: q.top, bottom: q.bottom, left: q.left, right: q.right });
    }
    return out;
  };
  // sent rows are justify-content: flex-end (bubble-layout.ts sentRow)
  const sideOf = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const cs = getComputedStyle(p); if (cs.flexDirection === 'row' && cs.width === getComputedStyle(p.parentElement).width) return cs.justifyContent === 'flex-end' ? 'sent' : 'recv'; } return '?'; };
  const scroller = [...document.querySelectorAll('div')].find(d => d.scrollHeight > d.clientHeight + 50 && /最新进展|收到/.test(d.textContent) && getComputedStyle(d).overflowY !== 'visible');
  const bubbles = [];
  const seen = new Set();
  // a bubble = nearest painted, rounded ancestor of a message's first text line
  for (const t of document.querySelectorAll('div[dir="auto"], span')) {
    if (!/^(【最新进展】|收到,马上处理。)$/.test(t.textContent.trim())) continue;
    let b = t.parentElement;
    while (b && !(bg(b) && parseFloat(getComputedStyle(b).borderTopLeftRadius) > 0)) b = b.parentElement;
    if (!b || seen.has(b)) continue;
    seen.add(b);
    const box = b.getBoundingClientRect();
    const lines = lineRects(b);
    // the quote row is the bubble's next sibling (inside the same pressable)
    let chip = null;
    for (let s = b.nextElementSibling; s; s = s.nextElementSibling) if (s.textContent.trim()) { chip = s; break; }
    const cb = chip ? chip.getBoundingClientRect() : null;
    const hits = cb ? lines.filter(l => l.left < cb.right && l.right > cb.left && l.top < cb.bottom && l.bottom > cb.top).length : 0;
    // ordered-list markers ("1." … "12.") and the text beside each
    const markers = [...b.querySelectorAll('div[dir="auto"], span')].filter(el => /^\d+\.$/.test(el.textContent.trim()) && el.nextElementSibling);
    const markerRows = markers.map(el => ({ n: el.textContent.trim(), right: Math.max(...lineRects(el).map(r => r.right)), textLeft: el.nextElementSibling.getBoundingClientRect().left }));
    bubbles.push({
      markerRows,
      label: `${sideOf(b)}:${t.textContent.trim().slice(0, 8)}${chip ? `+quote(${chip.textContent.trim().slice(0, 6)})` : ''}`,
      box: { top: box.top, bottom: box.bottom, left: box.left, right: box.right, width: box.width },
      textBottom: Math.max(...lines.map(l => l.bottom)),
      textRight: Math.max(...lines.map(l => l.right)),
      chip: cb ? { top: cb.top, bottom: cb.bottom, text: chip.textContent.trim().slice(0, 16) } : null,
      hits,
    });
  }
  return { bubbles, scroller: !!scroller };
};

const web = await serveExport(WEB);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
const rows = [];
let failed = 0;
const r1 = (n) => Math.round(n * 10) / 10;
for (const L of LAYOUTS) {
  const ctx = await browser.newContext({ viewport: { width: L.w, height: L.h }, ...(L.ua ? { userAgent: L.ua } : {}), colorScheme: 'light', deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  try {
    await page.addInitScript(chatInit, { md: LONG_MD, sched: SCHED });
    await page.addInitScript(initScript, { theme: 'light' });
    await page.goto(`${web.url}${L.ua ? '?safeAreaSim=32,0,24,0' : ''}`);
    await page.getByText('示例-A', { exact: true }).first().waitFor({ timeout: 20000 });
    await page.getByText('示例-A', { exact: true }).first().click();
    await page.getByText('【最新进展】', { exact: true }).first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(800);
    // walk the (inverted) list from the newest message to the oldest, measuring each screenful
    const all = new Map();
    for (let step = 0; step < 12; step++) {
      const m = await page.evaluate(measure);
      for (const b of m.bubbles) {
        // off-screen rows are still laid out (geometry is valid); a bubble taller than the phone screen never fits whole
        const vis = b.box.bottom > b.box.top;
        const key = `${b.label}@${r1(b.box.width)}#${b.textRight - b.box.left | 0}`;
        if (vis && !all.has(key)) all.set(key, b);
      }
      if (OUT && step === 0) await page.screenshot({ path: `${OUT}/bubble-${L.name}-${TAG}.png` });
      await page.mouse.move(L.w * 0.75, L.h / 2);
      await page.mouse.wheel(0, -350);
      await page.waitForTimeout(250);
    }
    if (!all.size) throw new Error('no bubble found — nothing measured');
    for (const b of all.values()) {
      const a = b.box.bottom + 0.5 >= b.textBottom;
      const r = b.box.right + 0.5 >= b.textRight;
      const c = !b.chip || (b.hits === 0 && b.chip.top + 0.5 >= b.box.bottom);
      const lefts = b.markerRows.map(m => m.textLeft);
      const d = !b.markerRows.length || (Math.max(...lefts) - Math.min(...lefts) <= 0.5 && b.markerRows.every(m => m.right <= m.textLeft + 0.5));
      if (b.markerRows.length) rows.push({ layout: L.name, bubble: `${b.label} markers ×${b.markerRows.length}`, w: '-', a: d ? 'PASS' : 'FAIL', b: '-', c: '-', note: `(d) text left ${[...new Set(lefts.map(r1))].join('/')} · widest marker right ${r1(Math.max(...b.markerRows.map(m => m.right)))}` });
      if (!(a && r && c && d)) failed++;
      rows.push({ layout: L.name, bubble: b.label, w: r1(b.box.width), a: a ? 'PASS' : 'FAIL', b: r ? 'PASS' : 'FAIL', c: c ? 'PASS' : 'FAIL',
        note: `bubbleBottom=${r1(b.box.bottom)} textBottom=${r1(b.textBottom)} bubbleRight=${r1(b.box.right)} textRight=${r1(b.textRight)}${b.chip ? ` quoteTop=${r1(b.chip.top)} hits=${b.hits}` : ''}` });
    }
    const kinds = new Set([...all.values()].map(b => b.label));
    if (kinds.size < 4) { failed++; rows.push({ layout: L.name, bubble: '-', w: '-', a: 'FAIL', b: '-', c: '-', note: `only ${[...kinds].join(',')} measured` }); }
  } catch (err) {
    failed++;
    rows.push({ layout: L.name, bubble: '-', w: '-', a: 'FAIL', b: '-', c: '-', note: `NOT RUN: ${String(err.message || err).split('\n')[0].slice(0, 100)}` });
  }
  await ctx.close();
}
await browser.close(); web.close();

console.log(`\n| layout | bubble | width | (a) bottom | (b) right | (c) quote | measured |\n|---|---|---|---|---|---|---|`);
for (const r of rows) console.log(`| ${r.layout} | ${r.bubble} | ${r.w} | ${r.a} | ${r.b} | ${r.c} | ${r.note} |`);
console.log(`\n${TAG}: ${rows.length} rows, ${failed} failing`);
process.exit(failed || !rows.length ? 1 : 0);
