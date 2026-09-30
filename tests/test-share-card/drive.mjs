// 分享图(方向 A「大字报」)的几何 —— 在 web 导出里量真的导出物,不靠眼睛。
// Not in CI: needs Playwright + Chromium and a web export. Hub data is placeholder, answered in-page by the Tauri stub in
// tests/test-layout-sweep/harness.mjs (window.__tasksFixture) — no hub process, no port, no HOME.
//
//   WEB_DIR=<expo export dir> [OUT=<png dir>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] node tests/test-share-card/drive.mjs
//
// Two exports, both sizes (1080×1920, 1080×1350), light + dark:
//   desktop (Canvas → PNG): every fillText is recorded with its ink box (measureText actualBoundingBox*), every panel
//     from its stroked outline. Checks: the PNG is exactly W×H; panels have equal left / right margins (72); every text
//     sits inside the panel it belongs to (or inside the 72 px side margins and above the 64 px bottom margin);
//     ≥ 8 task titles + 「… 还有 N 个」; no 「admin」 (the member without a display name shows as 「成员」); no 完成率.
//   phone (RN card, ShareCardNative — what react-native-view-shot captures on Android / iOS): the off-screen capture
//     card, laid out at 1080 px wide (deviceScaleFactor 1), is moved on-screen and measured the same way from the DOM:
//     each text element's box inside its panel, panels' margins equal, ellipsis only where the text has
//     text-overflow: ellipsis, ≥ 8 titles, no 「admin」.
//   both: no two texts painted over each other (a title running into the completer name on its row).
// OUT: the exported PNGs (desktop-*.png = the Canvas export, phone-*.png = the RN card at 1080 wide) + dialog shots.
// Exit 1 when any check fails.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { serveExport, initScript, findChromium, ANDROID_UA } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
if (OUT) mkdirSync(OUT, { recursive: true });

// Runs in the page. mode 'real' = the day in the owner's screenshot (2 active days); 'rich' = 40 days of history
// (the 30-day chart and the heatmap come back). Placeholder names only.
const fixture = (mode) => {
  const D = 86400000;
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (ms) => { const x = new Date(ms); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  const perDay = (ago) => mode === 'real' ? (ago === 0 ? 57 : ago === 1 ? 98 : 0) : (ago > 40 ? 0 : ago === 0 ? 57 : ago === 1 ? 98 : ago % 5 === 3 ? 0 : 8 + (ago * 7) % 23);
  const daily = [];
  for (let i = 370; i >= 0; i--) { const d0 = new Date(today0); d0.setDate(d0.getDate() - i); daily.push({ date: ymd(d0.getTime()), n: perDay(i) }); }
  const people = [
    { kind: 'node', id: 'n_a', networkId: 'net-sweep', name: '示例助手 A', display_name: '' },
    // the hub's name falls back to the username when display_name is empty — this is the 「admin」 on the old card
    { kind: 'user', id: 'u_admin', networkId: 'net-sweep', name: 'admin', display_name: '' },
    { kind: 'node', id: 'n_b', networkId: 'net-sweep', name: '示例助手 B', display_name: '' },
    { kind: 'node', id: 'n_c', networkId: 'net-sweep', name: '示例-C', display_name: '' },
    { kind: 'node', id: 'n_d', networkId: 'net-sweep', name: '示例-D', display_name: '' },
  ];
  const titles = [
    '设置 → 关于 → 更新日志（可复制，发小红书 / 公众号）', '网络策略验收解锁 | 回读现役 catalog version 与 raw SHA', '排期锚 | spaced/runtime 控制器与门脚本批次开工窗',
    '分享图重做：大字报方向、按数据量决定画不画图、完成者用显示名、竖版与 4:5 两种尺寸都量几何', 'HCS 容量里程碑 | 现状与可承载估算', 'P1 排期锚：将 #220 排入 alpha 迭代', '手机端分享图导出 PNG，走系统分享面板', '同步流量下降：任务列表改为增量拉取',
    '仪表盘：今日完成时间线与完成榜', '成员在线状态：头像右下角显示在线点', 'Hub 升级 preview73，并演练回滚路径', '定时任务运行结果：连续跳过的折叠成一行',
    '任务搜索：支持按编号与标题模糊匹配', '安卓更新检查：新版本提示与下载线路', '聊天多图预览：左右滑动与保存原图', '节点日志查看器：按级别过滤与复制',
    '优先级 P0–P3 标签与排序', '甘特图视图：拖动改排期', '登录令牌过期提示与一键续期', '桌面托盘图标在深色菜单栏里看得清', '看板列宽可拖动并记住',
  ];
  const whoOf = (i) => i % 4 === 3 ? { kind: 'user', id: 'u_admin' } : i % 5 === 4 ? { kind: 'node', id: 'n_b' } : { kind: 'node', id: 'n_a' };
  const now = Date.now();
  const stats = (q) => {
    const from = q.get('from') ? Date.parse(q.get('from')) : -Infinity;
    const done = daily.filter(d => Date.parse(`${d.date}T12:00:00`) >= from || (from > 0 && d.date >= ymd(from))).reduce((a, d) => a + d.n, 0);
    // by_completer: the same 101 / 38 / 11 / 3 / 2 split as the screenshot, scaled to whatever the period holds.
    const split = [['node', 'n_a', 101], ['user', 'u_admin', 38], ['node', 'n_b', 11], ['node', 'n_c', 3], ['node', 'n_d', 2]];
    const base = 155;
    const by = split.map(([kind, id, n]) => ({ kind, id, n: Math.round((n / base) * done), spark: [] })).filter(x => x.n > 0);
    return {
      ok: true, networkId: 'net-sweep',
      totals: { done, done_approx: 0, created: done + 40, created_done: done, completion_rate: 0.36, doing: 165, pool: 0 },
      daily, by_project: [], by_completer: by, unattributed: 0,
      recent: titles.slice(0, Number(q.get('recent') || 20)).map((name, i) => ({ id: `r${i}`, seq: 900 - i, name, project_id: null, completed_at: new Date(now - (i * 23 + 2) * 60000).toISOString(), completed_at_approx: false, completed_by: whoOf(i), archived: false })),
    };
  };
  window.__tasksFixture = {
    requirements: [{ id: 'o1', seq: 1, name: '示例:进行中', priority: 'normal', assignee: '', column: 'doing', due: '', owner: null, participants: [], agent_owner: null, project_id: null, createdAt: new Date(now - D).toISOString(), updatedAt: new Date(now - D).toISOString(), description: '', checklist: [], tags: [], parent_id: null, completedAt: null, completedAtApprox: false, completedBy: null }],
    archived: [], projects: [], people,
    capabilities: ['agent_owner', 'description', 'checklist', 'projects', 'due_datetime', 'priority_lowest', 'start_date', 'tags', 'sub_requirements', 'requirement_seq', 'archived', 'search', 'paging', 'completed_at', 'stats'],
    stats, hasMore: false,
  };
};

// Runs in the page: record what the Canvas draws. Panels = stroked closed paths wider than 300 px (only panel() strokes
// those); texts = every fillText with its ink box. Keyed per canvas (each preview render is a new canvas).
const canvasProbe = () => {
  const P = CanvasRenderingContext2D.prototype;
  const logs = window.__canvasLogs = new Map();
  const logOf = (ctx) => { let l = logs.get(ctx.canvas); if (!l) logs.set(ctx.canvas, l = { w: ctx.canvas.width, h: ctx.canvas.height, panels: [], texts: [], at: performance.now() }); return l; };
  const paths = new WeakMap();
  const add = (ctx, x, y) => { const b = paths.get(ctx); if (!b) return; b.x0 = Math.min(b.x0, x); b.y0 = Math.min(b.y0, y); b.x1 = Math.max(b.x1, x); b.y1 = Math.max(b.y1, y); };
  const wrap = (name, fn) => { const orig = P[name]; P[name] = function (...a) { fn(this, a); return orig.apply(this, a); }; };
  wrap('beginPath', (ctx) => paths.set(ctx, { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }));
  wrap('moveTo', (ctx, [x, y]) => add(ctx, x, y));
  wrap('lineTo', (ctx, [x, y]) => add(ctx, x, y));
  wrap('arcTo', (ctx, [x1, y1, x2, y2]) => { add(ctx, x1, y1); add(ctx, x2, y2); });
  wrap('stroke', (ctx) => { const b = paths.get(ctx); if (b && b.x1 - b.x0 > 300) logOf(ctx).panels.push({ ...b }); });
  wrap('fillText', (ctx, [text, x, y]) => {
    const m = ctx.measureText(text);
    logOf(ctx).texts.push({ text: String(text), x0: x - m.actualBoundingBoxLeft, x1: x + m.actualBoundingBoxRight, y0: y - m.actualBoundingBoxAscent, y1: y + m.actualBoundingBoxDescent, base: y, font: ctx.font });
  });
};

let failures = 0;
const rows = [];
function record(vp, what, checks, detail = {}) {
  const ok = Object.values(checks).every(Boolean);
  if (!ok) failures++;
  const row = { vp, what, ...detail, ok, failed: Object.keys(checks).filter(k => !checks[k]).join(',') || '-' };
  rows.push(row);
  console.log(JSON.stringify(row));
}
const tid = (id) => `[data-testid="${id}"]`;
const r1 = (n) => Math.round(n * 10) / 10;
const pngSize = (buf) => (buf.length >= 24 && buf.toString('ascii', 12, 16) === 'IHDR' ? { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) } : null);

/** Two texts painted on top of each other (e.g. a title running into the completer name on its row): horizontal overlap
 *  > 1 px and vertical overlap ≥ half the shorter box (adjacent lines whose boxes graze each other are not a collision). */
function collisions(texts) {
  const out = [];
  const ts = texts.filter(t => t.text.trim() && t.x1 - t.x0 > 0);
  for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) {
    const a = ts[i], b = ts[j];
    const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
    const oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    if (ox > 1 && oy >= 0.5 * Math.min(a.y1 - a.y0, b.y1 - b.y0)) out.push(`overlap: "${a.text.slice(0, 16)}" × "${b.text.slice(0, 16)}" by ${r1(ox)} px`);
  }
  return out;
}

/** Geometry verdict shared by both exports. panels / texts in card px. */
function verdict(W, H, panels, texts) {
  const issues = [];
  const lefts = panels.map(p => p.x0), rights = panels.map(p => W - p.x1);
  for (const t of texts) {
    if (!t.text.trim()) continue;
    const home = panels.find(p => t.base >= p.y0 && t.base <= p.y1);
    const box = home ?? { x0: 72, x1: W - 72, y0: 0, y1: H - 64 };
    if (t.x0 < box.x0 - 0.5 || t.x1 > box.x1 + 0.5 || t.y0 < box.y0 - 0.5 || t.y1 > box.y1 + 0.5) issues.push(`${home ? 'outside panel' : 'outside margins'}: "${t.text.slice(0, 24)}" x ${r1(t.x0)}..${r1(t.x1)} y ${r1(t.y0)}..${r1(t.y1)} in ${r1(box.x0)}..${r1(box.x1)} / ${r1(box.y0)}..${r1(box.y1)}`);
  }
  issues.push(...collisions(texts));
  return {
    issues, panels: panels.length,
    marginL: panels.length ? `${r1(Math.min(...lefts))}–${r1(Math.max(...lefts))}` : '-',
    marginR: panels.length ? `${r1(Math.min(...rights))}–${r1(Math.max(...rights))}` : '-',
    equal: panels.length > 0 && Math.max(...lefts.map((l, i) => Math.abs(l - rights[i]))) <= 1,
  };
}

const { url, close } = await serveExport(WEB);
const browser = await chromium.launch({ headless: true, executablePath: findChromium(), args: ['--disable-web-security'] });

async function openDash(page, phone) {
  await page.goto(phone ? `${url}?safeAreaSim=0,0,0,0` : url);
  if (!phone) await page.locator('[data-testid="desktop-rail"] [aria-label="任务"]').first().click({ timeout: 30000 });
  else { await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 30000 }); await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'tasks' })); }
  await page.locator(tid('tasks-view-dashboard')).first().click({ timeout: 20000 });
  await page.locator(tid('task-dashboard')).first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(1500);
  await page.locator(tid('dash-period-week')).first().click().catch(() => {});
  await page.waitForTimeout(800);
}

const summary = [];
for (const mode of ['real', 'rich']) {
  const themes = mode === 'real' ? ['light', 'dark'] : ['light'];
  // ── desktop: the Canvas export ──
  for (const theme of themes) {
    const vp = `desktop ${mode} ${theme}`;
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme, deviceScaleFactor: 1, timezoneId: 'Asia/Shanghai', locale: 'zh-CN' });
    const page = await ctx.newPage();
    page.on('pageerror', e => console.log('PAGEERROR', e.message.split('\n')[0]));
    await page.addInitScript(fixture, mode);
    await page.addInitScript(canvasProbe);
    await page.addInitScript(initScript, { theme });
    try { await openDash(page, false); } catch (e) { record(vp, 'open', { opened: false }, { error: String(e).split('\n')[0] }); await ctx.close(); continue; }
    await page.locator(tid('dash-share')).first().click();
    await page.locator(tid('dash-share-preview') + ' img').first().waitFor({ timeout: 15000 });
    await page.locator(tid(`dash-theme-${theme}`)).first().click();
    for (const size of ['portrait', 'feed']) {
      if (mode === 'rich' && size === 'feed') continue;
      const H = size === 'portrait' ? 1920 : 1350;
      await page.locator(tid(`dash-size-${size}`)).first().click();
      await page.waitForTimeout(900);
      const png = await page.evaluate(async () => {
        const src = document.querySelector('[data-testid="dash-share-preview"] img')?.src;
        if (!src) return null;
        const buf = new Uint8Array(await (await fetch(src)).arrayBuffer());
        let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        return btoa(s);
      });
      const buf = png ? Buffer.from(png, 'base64') : Buffer.alloc(0);
      const dim = pngSize(buf);
      const name = `desktop-${size === 'portrait' ? '1080x1920' : '1080x1350'}-${theme}${mode === 'rich' ? '-rich-history' : ''}.png`;
      if (OUT && dim) writeFileSync(join(OUT, name), buf);
      const log = await page.evaluate((h) => { const all = [...window.__canvasLogs.values()].filter(l => l.h === h && l.texts.length).sort((a, b) => b.at - a.at); return all[0] ?? null; }, H);
      const v = log ? verdict(1080, H, log.panels, log.texts) : { issues: ['no canvas log'], panels: 0, marginL: '-', marginR: '-', equal: false };
      const texts = log?.texts.map(t => t.text) ?? [];
      // title rows = the texts drawn at the title size inside the panel that holds 「最近完成的任务」
      const tp = log && log.panels.find(p => log.texts.some(t => t.text === '最近完成的任务' && t.base >= p.y0 && t.base <= p.y1));
      const titleRows = tp ? log.texts.filter(t => t.base > tp.y0 + 70 && t.base <= tp.y1 && new RegExp(`(^|\\s)${size === 'portrait' ? 28 : 26}px `).test(t.font)).length : 0;
      const more = texts.find(t => /^… 还有 \d+ 个$/.test(t)) ?? null;
      const ellipsised = texts.filter(t => t.endsWith('…')).length;
      if (OUT) await page.screenshot({ path: join(OUT, `desktop-dialog-${size}-${theme}${mode === 'rich' ? '-rich' : ''}.png`) });
      record(vp, `canvas ${size}`, {
        png: !!dim && dim.w === 1080 && dim.h === H,
        marginsEqual: v.equal,
        noOverflow: v.issues.length === 0,
        eightTitles: titleRows >= 9 && !!more,
        memberNotAdmin: !texts.some(t => t.includes('admin')) && texts.some(t => t.includes('成员')),
        noRate: !texts.some(t => t.includes('完成率') || t === '36%'),
        charts: mode === 'real' ? !texts.some(t => t.includes('近 30 天') || t.includes('近 7 天') || t.includes('全年')) : texts.some(t => t.includes('近 30 天')),
      }, { png: dim && `${dim.w}x${dim.h}`, panels: v.panels, marginL: v.marginL, marginR: v.marginR, texts: texts.length, titleRows, more, ellipsised, issues: v.issues.slice(0, 4) });
      summary.push({ file: name, marginL: v.marginL, marginR: v.marginR, texts: texts.length, issues: v.issues.length, titleRows, more, ellipsised });
    }
    await ctx.close();
  }
  if (mode === 'rich') continue;
  // ── phone: the RN card (what react-native-view-shot captures on Android / iOS) ──
  for (const theme of themes) {
    const vp = `phone ${mode} ${theme}`;
    const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme, deviceScaleFactor: 1, timezoneId: 'Asia/Shanghai', locale: 'zh-CN', userAgent: ANDROID_UA, hasTouch: true });
    const pp = await pctx.newPage();
    pp.on('pageerror', e => console.log('PAGEERROR', e.message.split('\n')[0]));
    await pp.addInitScript(fixture, mode);
    await pp.addInitScript(initScript, { theme });
    try { await openDash(pp, true); } catch (e) { record(vp, 'open', { opened: false }, { error: String(e).split('\n')[0] }); await pctx.close(); continue; }
    await pp.evaluate(() => { window.__anetDashNativeCard = true; });
    await pp.locator(tid('dash-share')).first().click();
    await pp.locator(tid('share-card-capture')).first().waitFor({ state: 'attached', timeout: 10000 });
    await pp.locator(tid(`dash-theme-${theme}`)).first().click();
    for (const size of ['portrait', 'feed']) {
      const H = size === 'portrait' ? 1920 : 1350;
      await pp.locator(tid(`dash-size-${size}`)).first().click();
      await pp.waitForTimeout(600);
      if (OUT) await pp.screenshot({ path: join(OUT, `phone-dialog-${size}-${theme}.png`) });
      // bring the off-screen capture card on-screen (its wrapper sits at left -20000) and measure it at 1080 px. The viewport
      // stays phone-sized (a wider one would switch the app to the desktop layout and unmount the dialog).
      await pp.evaluate(() => { const c = document.querySelector('[data-testid="share-card-capture"]'); const w = c.parentElement.parentElement; w.style.left = '0px'; w.style.top = '0px'; w.style.zIndex = '99999'; });
      await pp.waitForTimeout(300);
      const m = await pp.evaluate(() => {
        const card = document.querySelector('[data-testid="share-card-capture"]');
        const cb = card.getBoundingClientRect();
        const rel = (b) => ({ x0: b.left - cb.left, x1: b.right - cb.left, y0: b.top - cb.top, y1: b.bottom - cb.top });
        const panelEls = [...card.querySelectorAll('[data-testid="share-card-panel"], [data-testid="share-card-titles"]')];
        const panels = panelEls.map(e => rel(e.getBoundingClientRect()));
        const texts = [];
        let clippedNoEllipsis = 0, ellipsised = 0;
        for (const el of card.querySelectorAll('*')) {
          const own = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim()).map(n => n.textContent).join('');
          if (!own) continue;
          // the painted text: a Range over the text nodes (not the element box, which may be wider than the glyphs)
          const range = document.createRange(); range.selectNodeContents(el);
          const rb = range.getBoundingClientRect();
          const eb = el.getBoundingClientRect();
          const clip = { left: Math.max(rb.left, eb.left), right: Math.min(rb.right, eb.right), top: Math.max(rb.top, eb.top), bottom: Math.min(rb.bottom, eb.bottom) };
          const r = rel(clip);
          const pe = el.closest('[data-testid="share-card-panel"], [data-testid="share-card-titles"]');
          const cs = getComputedStyle(el);
          if (el.scrollWidth > el.clientWidth + 1) { if (cs.textOverflow === 'ellipsis') ellipsised++; else clippedNoEllipsis++; }
          texts.push({ text: el.textContent, leaf: !el.querySelector('*'), ...r, base: pe ? rel(pe.getBoundingClientRect()).y0 + 1 : r.y1, inPanel: !!pe, panel: pe ? rel(pe.getBoundingClientRect()) : null });
        }
        return { w: cb.width, h: cb.height, panels, texts, clippedNoEllipsis, ellipsised, titles: [...card.querySelectorAll('[data-testid="share-card-title"]')].map(e => e.textContent) };
      });
      // text → its own panel (DOM ancestry, not y-range)
      const issues = [];
      for (const t of m.texts) {
        const box = t.panel ?? { x0: 72, x1: 1080 - 72, y0: 0, y1: H - 64 };
        if (t.x0 < box.x0 - 0.5 || t.x1 > box.x1 + 0.5 || t.y0 < box.y0 - 0.5 || t.y1 > box.y1 + 0.5) issues.push(`${t.panel ? 'outside panel' : 'outside margins'}: "${t.text.slice(0, 24)}" x ${r1(t.x0)}..${r1(t.x1)} y ${r1(t.y0)}..${r1(t.y1)}`);
      }
      // nested Text (the big number row) paints inside its parent's box: only leaf texts take part in the collision check
      // DOM boxes are the font's content area (1.448 em for Noto Sans CJK), much taller than the ink: a 250 px number's box
      // reaches up over the line above it. Collide on the approximate ink band instead (ascent 1.16 em, glyphs 0.88 em
      // above / 0.12 em below the baseline); containment above still uses the full box.
      const ink = (t) => { const em = (t.y1 - t.y0) / 1.448; return { ...t, y0: t.y0 + 0.28 * em, y1: t.y0 + 1.28 * em }; };
      issues.push(...collisions(m.texts.filter(t => t.leaf).map(ink)));
      const lefts = m.panels.map(p => p.x0), rights = m.panels.map(p => 1080 - p.x1);
      const marginL = `${r1(Math.min(...lefts))}–${r1(Math.max(...lefts))}`, marginR = `${r1(Math.min(...rights))}–${r1(Math.max(...rights))}`;
      const name = `phone-${size === 'portrait' ? '1080x1920' : '1080x1350'}-${theme}.png`;
      if (OUT) {
        // shoot only the card: the dialog and the tab bar would otherwise paint over its top-left corner
        await pp.evaluate(() => { document.body.style.visibility = 'hidden'; document.querySelector('[data-testid="share-card-capture"]').style.visibility = 'visible'; });
        await pp.locator(tid('share-card-capture')).first().screenshot({ path: join(OUT, name) });
        await pp.evaluate(() => { document.body.style.visibility = ''; document.querySelector('[data-testid="share-card-capture"]').style.visibility = ''; });
      }
      const allText = m.texts.map(t => t.text).join('\n');
      const more = m.titles.find(t => /^… 还有 \d+ 个$/.test(t)) ?? null;
      record(vp, `rn card ${size}`, {
        size: Math.abs(m.w - 1080) < 1 && Math.abs(m.h - H) < 1,
        marginsEqual: m.panels.length > 0 && Math.max(...lefts.map((l, i) => Math.abs(l - rights[i]))) <= 1,
        noOverflow: issues.length === 0 && m.clippedNoEllipsis === 0,
        eightTitles: m.titles.length >= 9 && !!more,
        memberNotAdmin: !allText.includes('admin') && allText.includes('成员'),
        noRate: !allText.includes('完成率'),
      }, { card: `${r1(m.w)}x${r1(m.h)}`, panels: m.panels.length, marginL, marginR, texts: m.texts.length, titles: m.titles.length, more, ellipsised: m.ellipsised, issues: issues.slice(0, 4) });
      summary.push({ file: name, marginL, marginR, texts: m.texts.length, issues: issues.length + m.clippedNoEllipsis, titleRows: m.titles.length, more, ellipsised: m.ellipsised });
      await pp.evaluate(() => { const c = document.querySelector('[data-testid="share-card-capture"]'); const w = c.parentElement.parentElement; w.style.left = '-20000px'; });
      await pp.waitForTimeout(200);
    }
    await pctx.close();
  }
}

await browser.close();
close();
if (OUT) writeFileSync(join(OUT, 'measurements.json'), JSON.stringify({ rows, summary }, null, 2));
console.log('\n| file | margin L | margin R | texts | out of card | title rows (incl. 还有 N 个) | ellipsised |');
console.log('|---|---|---|---|---|---|---|');
for (const s of summary) console.log(`| ${s.file} | ${s.marginL} | ${s.marginR} | ${s.texts} | ${s.issues} | ${s.titleRows} (${s.more ?? '-'}) | ${s.ellipsised} |`);
console.log(`\n${rows.length - failures}/${rows.length} checks passed`);
process.exit(failures ? 1 : 0);
