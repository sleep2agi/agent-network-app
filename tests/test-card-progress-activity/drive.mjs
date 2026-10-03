// #506 任务卡片 / 列表行上不点开就能看到:检查项进度 + 最近动静。Placeholder data only, served in-page by the
// Tauri stub in tests/test-layout-sweep/harness.mjs (no hub process, no port, no HOME touched).
//
//   WEB_DIR=<expo export dir> [OUT=<png dir>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] node tests/test-card-progress-activity/drive.mjs
//
// desktop 1280×800 (mouse) and phone 390×844 (安卓 UA, touch), light + dark, zh(+ desktop light en):
//   board  卡片:「3/5」+ 细条(60%)、5/5 成功色、无检查项不画;最下一行「2 小时前 · 示例成员甲更新」/ Agent 带芯片图标 /
//          没人 →「3 天前更新」/ 没动过 →「创建」/ 旧 Hub 无 updatedAt → 不画;长名字只截名字、整行一行、不出卡片。
//   list   桌面表格:标题格里紧凑「3/5」胶囊(20 高,和优先级徽标 / 期限胶囊中线对齐);「更新时间」列时间后面跟更新者。
//          手机分组列表:紧凑「3/5」胶囊(不画条)+ 动静一行。
//   geometry  boundingBox 表:优先级徽标 / 期限胶囊 / 进度胶囊的中线和高度;动静行的左边和优先级徽标左边对齐。
//   last_event(Hub ≥ preview.97,agent-network#2308)r5–r7:「10 分钟前 · 示例成员甲评论了」+ 桌面端一行截断的评论预览(手机没有)/
//          Agent「把状态改成「进行中」」(动词不截、名字截、不露 doing)/ 没有操作者「1 小时前 · 改了优先级」;
//          桌面表格「更新时间」列同样写动词 + 预览(同一段文字,列窄在末尾截、不出格)。一行里时间 / 名字 / 动词 / 预览的中线差 ≤ 1px。
//          r1–r4 没有 last_event(= 旧 Hub)→ 照旧按 updatedAt(data-source=updatedAt)。
// Exit 1 on any failure.
import { mkdirSync, writeFileSync } from 'node:fs';
import { serveExport, initScript, findChromium, ANDROID_UA } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
if (OUT) mkdirSync(OUT, { recursive: true });

const fixture = () => {
  const at = (min) => new Date(Date.now() - min * 60000).toISOString();
  const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  const ua = { kind: 'user', id: 'u_a' }, agent = { kind: 'node', id: 'n_long' };
  const ck = (n, done) => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, text: `检查项 ${i + 1}`, done: i < done }));
  const R = (id, seq, name, o) => ({ id, seq, name, priority: 'normal', assignee: '', column: 'doing', owner: ua, participants: [], agent_owner: null, project_id: null, due: '', createdAt: at(10000), description: '', tags: [], parent_id: null, ...o });
  window.__tasksFixture = {
    meId: 'u_tester',
    requirements: [
      R('r1', 11, '示例任务一:有 3/5 检查项', { priority: 'high', due: today, checklist: ck(5, 3), updatedAt: at(120), updated_by: ua }),
      R('r2', 12, '示例任务二:检查项全部完成,Agent 刚动过', { checklist: ck(5, 5), updatedAt: at(5), updated_by: agent }),
      R('r3', 13, '示例任务三:没有检查项、不知道是谁改的', { priority: 'low', checklist: [], updatedAt: at(3 * 1440), updated_by: null }),
      // 精简列表行(view=summary):没有条目,只有计数;建了以后没人动过(updatedAt == createdAt)。
      R('r4', 14, '示例任务四:精简行 2/7', { priority: 'normal', checklist: undefined, checklist_count: { total: 7, done: 2 }, has_description: false, createdAt: at(600), updatedAt: at(600), updated_by: ua }),
      // last_event(#506):评论比 updated_at 新 / Agent 改状态 / 没有操作者。
      R('r5', 15, '示例任务五:有人评论了', { priority: 'high', due: today, checklist: ck(4, 1), updatedAt: at(300), updated_by: ua,
        last_event: { type: 'comment', field: null, actor: { id: 'u_a', kind: 'user', display_name: '示例成员甲' }, at: at(10), summary: '已经复现了,正在修;这是一条很长很长很长的评论,用来测桌面端一行截断的预览,不能把卡片撑宽,也不能换行。' } }),
      R('r6', 16, '示例任务六:Agent 改了状态', { checklist: [], updatedAt: at(30), updated_by: agent,
        last_event: { type: 'changed', field: 'column', actor: { id: 'n_long', kind: 'node', display_name: 'hub-name' }, at: at(30), summary: 'pool → doing' } }),
      R('r7', 17, '示例任务七:不知道是谁改的优先级', { priority: 'low', checklist: [], updatedAt: at(60), updated_by: null,
        last_event: { type: 'changed', field: 'priority', actor: null, at: at(60), summary: 'normal → low' } }),
    ],
    projects: [],
    people: [
      { kind: 'user', id: 'u_tester', networkId: 'net-sweep', name: 'tester' },
      { kind: 'user', id: 'u_a', networkId: 'net-sweep', name: '示例成员甲' },
      { kind: 'node', id: 'n_long', networkId: 'net-sweep', name: '示例-一个名字特别特别特别长的Agent节点-用来测截断' },
    ],
    capabilities: ['agent_owner', 'description', 'checklist', 'requirement_seq', 'list_summary', 'last_event'],
  };
};

const rows = [];
const geo = [];
let failures = 0;
function record(where, what, checks, detail = {}) {
  const ok = Object.values(checks).every(Boolean);
  if (!ok) failures++;
  const row = { where, what, ...detail, ok, failed: Object.keys(checks).filter(k => !checks[k]).join(',') || '-' };
  rows.push(row);
  console.log(JSON.stringify(row));
}
const tid = (id) => `[data-testid="${id}"]`;
const VIEWPORTS = {
  desktop: { w: 1280, h: 800 },
  phone: { w: 390, h: 844, ua: ANDROID_UA },
};
const RUNS = [];
for (const [name, V] of Object.entries(VIEWPORTS)) for (const theme of ['light', 'dark']) RUNS.push({ name, V, theme, lang: 'zh' });
RUNS.push({ name: 'desktop', V: VIEWPORTS.desktop, theme: 'light', lang: 'en' });

// One card / row → boxes of its parts (viewport px, rounded to 0.5).
const measure = (page, rootSel) => page.evaluate((sel) => {
  const root = document.querySelector(sel);
  if (!root) return null;
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); const h = (v) => Math.round(v * 2) / 2; return { x: h(b.x), y: h(b.y), w: h(b.width), h: h(b.height), cy: h(b.y + b.height / 2), right: h(b.right), bottom: h(b.bottom) }; };
  const q = (s) => root.querySelector(s);
  const act = q('[data-testid="task-card-activity"]');
  const name = q('[data-testid="task-card-activity-name"]');
  const prog = q('[data-testid="task-checklist-progress"]');
  const bar = q('[data-testid="task-checklist-bar"]');
  const compact = q('[data-testid="task-checklist-compact"]') || q('[data-testid^="task-row-checklist-"]');
  const prioText = q('[data-testid="task-prio-badge"]');
  const verb = q('[data-testid="task-card-activity-verb"]');
  const preview = q('[data-testid="task-card-activity-preview"]');
  const trunc = (el) => (el ? el.scrollWidth > el.clientWidth + 0.5 : null);
  return {
    card: r(root), prio: r(q('[data-testid="task-prio-badge"]')), due: r(q('[data-testid="task-due"]')),
    prog: r(prog), progText: prog?.textContent.match(/\d+\/\d+/)?.[0] ?? null, /* textContent also holds the icon-font glyph */ progComplete: (prog || compact)?.getAttribute('data-complete') ?? null,
    barRatio: bar ? bar.getBoundingClientRect().width / bar.parentElement.getBoundingClientRect().width : null,
    barColor: bar ? getComputedStyle(bar).backgroundColor : null,
    compact: r(compact), compactText: compact?.textContent.match(/\d+\/\d+/)?.[0] ?? null,
    act: r(act), actText: act?.textContent.replace(/\u00a0/g, ' ') ?? null, actActor: act?.getAttribute('data-actor') ?? null, actVerb: act?.getAttribute('data-verb') ?? null,
    actAgentIcon: !!q('[data-testid="task-card-activity-agent"]'), actSource: act?.getAttribute('data-source') ?? null,
    ago: r(q('[data-testid="task-card-activity-ago"]')), name: r(name), verb: r(verb), verbText: verb?.textContent.replace(/\u00a0/g, ' ').trim() ?? null, verbTruncated: trunc(verb),
    preview: r(preview), previewText: preview?.textContent ?? null, previewTruncated: trunc(preview),
    nameTruncated: name ? name.scrollWidth > name.clientWidth + 0.5 : null,
    title: r(q('[data-testid^="task-title-"]') ? q('[data-testid^="task-title-"] div[dir="auto"]') || q('[data-testid^="task-title-"]') : null),
    prioLabel: prioText?.textContent ?? null,
  };
}, rootSel);

const web = await serveExport(WEB);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
for (const { name, V, theme, lang } of RUNS) {
  const where = `${name}/${theme}/${lang}`;
  const ctx = await browser.newContext({ viewport: { width: V.w, height: V.h }, ...(V.ua ? { userAgent: V.ua, hasTouch: true } : {}), colorScheme: theme, deviceScaleFactor: 2, locale: lang === 'zh' ? 'zh-CN' : 'en-US' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message.split('\n')[0]));
  const shot = async (n) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}-${theme}-${lang}-${n}.png` }); };
  const guarded = async (step, fn) => {
    try { await fn(); } catch (e) {
      failures++;
      console.log(JSON.stringify({ where, step, error: String(e).split('\n')[0] }));
      if (OUT) await page.screenshot({ path: `${OUT}/${name}-${theme}-${lang}-FAIL-${step}.png` }).catch(() => {});
    }
  };
  const view = async (k) => {
    const seg = page.locator(tid(`tasks-view-${k}`)).first();
    if (await seg.count() && await seg.isVisible()) { await (V.ua ? seg.tap() : seg.click()); await page.waitForTimeout(500); }
  };
  try {
    await page.addInitScript(initScript, { theme });
    await page.addInitScript(fixture);
    await page.addInitScript((l) => { try { localStorage.setItem('anet.language.v1', l); } catch {} }, lang);
    await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
    await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 20000 });
    await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'tasks' }));
    await page.waitForTimeout(400);
    await view('board');
    await page.locator(tid('req-card-r1')).first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(500);
    const noHScroll = () => page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 0.5);

    await guarded('board', async () => {
      const m = {};
      for (const id of ['r1', 'r2', 'r3', 'r4']) {
        // 手机分页看板一页一列:全在「进行中」那一页。
        await page.locator(tid(`req-card-${id}`)).first().scrollIntoViewIfNeeded().catch(() => {});
        m[id] = await measure(page, tid(`req-card-${id}`));
      }
      await shot('board');
      const zh = lang === 'zh';
      const inCard = (c) => !!c.act && c.act.x >= c.card.x && c.act.right <= c.card.right - 13.5 && c.act.bottom <= c.card.bottom;
      record(where, 'board cards: progress, activity line, truncation', {
        r1Progress: m.r1.progText === '3/5' && Math.abs(m.r1.barRatio - 0.6) < 0.02 && m.r1.progComplete === '0',
        r2Complete: m.r2.progText === '5/5' && m.r2.progComplete === '1' && /rgb\((34, 197, 94|21, 128, 61)\)/.test(m.r2.barColor),
        r3NoProgress: m.r3.prog === null,
        r4Summary: m.r4.progText === '2/7',
        r1Human: m.r1.actActor === 'user' && m.r1.actText === (zh ? '2 小时前 · 示例成员甲更新' : '2h ago · 示例成员甲 updated') && !m.r1.actAgentIcon,
        r2Agent: m.r2.actActor === 'agent' && m.r2.actAgentIcon && m.r2.nameTruncated === true,
        r3Anon: m.r3.actActor === 'none' && m.r3.actText === (zh ? '3 天前更新' : 'Updated 3d ago'),
        r4Created: m.r4.actVerb === 'created',
        noEventFallback: ['r1', 'r2', 'r3', 'r4'].every(id => m[id].actSource === 'updatedAt'),
        oneLine: ['r1', 'r2', 'r3', 'r4'].every(id => m[id].act && m[id].act.h <= 17),
        insideCard: ['r1', 'r2', 'r3', 'r4'].every(id => inCard(m[id])),
        noHScroll: await noHScroll(),
      }, { r1: m.r1.actText, r2: m.r2.actText, r3: m.r3.actText, r4: m.r4.actText });
      for (const id of ['r1', 'r2', 'r4']) {
        const c = m[id];
        geo.push({ where, view: 'board', id, prioCy: c.prio?.cy, dueCy: c.due?.cy ?? '-', prioH: c.prio?.h, dueH: c.due?.h ?? '-', progX: c.prog?.x, prioX: c.prio?.x, actX: c.act?.x, actH: c.act?.h, actGapAbove: c.act && c.prog ? Math.round((c.act.y - c.prog.bottom) * 2) / 2 : '-', cardH: c.card.h });
      }
      const c = m.r1;
      record(where, 'board geometry: P-badge ↔ due chip same centre/height; progress + activity start at the badge left edge', {
        prioDueCentre: !!c.due && Math.abs(c.prio.cy - c.due.cy) <= 0.5,
        prioDueHeight: !!c.due && c.prio.h === c.due.h,
        progLeft: Math.abs(c.prog.x - c.prio.x) <= 0.5,
        actLeft: Math.abs(c.act.x - c.prio.x) <= 0.5,
        actGap: c.act.y - c.prog.bottom >= 4 && c.act.y - c.prog.bottom <= 8,
      }, { prioCy: c.prio.cy, dueCy: c.due?.cy, progX: c.prog.x, prioX: c.prio.x, actX: c.act.x, gap: c.act.y - c.prog.bottom });
    });

    await guarded('board-events', async () => {
      const m = {};
      for (const id of ['r5', 'r6', 'r7']) {
        await page.locator(tid(`req-card-${id}`)).first().scrollIntoViewIfNeeded().catch(() => {});
        m[id] = await measure(page, tid(`req-card-${id}`));
      }
      await page.locator(tid('req-card-r5')).first().scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(200);
      m.r5 = await measure(page, tid('req-card-r5'));
      await shot('board-events');
      const zh = lang === 'zh', desk = !V.ua;
      const inCard = (c) => !!c.act && c.act.x >= c.card.x && c.act.right <= c.card.right - 13.5 && c.act.bottom <= c.card.bottom && (!c.preview || c.preview.right <= c.card.right - 13.5);
      const cy1 = (c) => [c.ago, c.name, c.verb, c.preview].filter(Boolean).every(b => Math.abs(b.cy - c.verb.cy) <= 1);
      record(where, 'board cards with last_event: comment / agent status / no actor', {
        r5Comment: m.r5.actSource === 'event' && m.r5.actVerb === 'commented' && m.r5.actText.startsWith(zh ? '10 分钟前 · 示例成员甲评论了' : '10m ago · 示例成员甲 commented'),
        r5Preview: desk ? (!!m.r5.preview && m.r5.previewTruncated === true && m.r5.previewText.startsWith(zh ? '：已经复现了' : ': 已经复现了')) : m.r5.preview === null,
        r5VerbWhole: m.r5.verbTruncated === false && m.r5.nameTruncated === false, // 预览只吃剩下的宽度,不挤名字
        r6Agent: m.r6.actActor === 'agent' && m.r6.actAgentIcon && m.r6.verbText === (zh ? '把状态改成「进行中」' : 'moved to In progress') && m.r6.verbTruncated === false && m.r6.nameTruncated === true,
        r6NoRawId: !/\bdoing\b|pool/.test(m.r6.actText),
        r7Anon: m.r7.actActor === 'none' && m.r7.actSource === 'event' && m.r7.actText === (zh ? '1 小时前 · 改了优先级' : '1h ago · changed priority'),
        oneLine: ['r5', 'r6', 'r7'].every(id => m[id].act && m[id].act.h <= 17),
        insideCard: ['r5', 'r6', 'r7'].every(id => inCard(m[id])),
        centreLine: ['r5', 'r6'].every(id => cy1(m[id])),
        noHScroll: await noHScroll(),
      }, { r5: m.r5.actText, r6: m.r6.verbText, r7: m.r7.actText });
      const c = m.r5;
      geo.push({ where, view: 'board-event', id: 'r5', prioCy: c.prio?.cy, dueCy: c.due?.cy, prioH: c.prio?.h, dueH: c.due?.h, progX: c.prog?.x, prioX: c.prio?.x, actX: c.act?.x, agoCy: c.ago?.cy, nameCy: c.name?.cy, verbCy: c.verb?.cy, previewCy: c.preview?.cy ?? '-', actRight: c.act?.right, cardRight: c.card.right, actGapAbove: c.act && c.prog ? Math.round((c.act.y - c.prog.bottom) * 2) / 2 : '-' });
      record(where, 'board geometry (last_event card): badge / due same centre; progress + activity at badge left; activity gap 4–8', {
        prioDueCentre: !!c.due && Math.abs(c.prio.cy - c.due.cy) <= 0.5,
        progLeft: Math.abs(c.prog.x - c.prio.x) <= 0.5,
        actLeft: Math.abs(c.act.x - c.prio.x) <= 0.5,
        actGap: c.act.y - c.prog.bottom >= 4 && c.act.y - c.prog.bottom <= 8,
      }, { prioCy: c.prio.cy, dueCy: c.due?.cy, actX: c.act.x, prioX: c.prio.x, gap: c.act.y - c.prog.bottom });
    });

    await guarded('list', async () => {
      await view('list');
      await page.locator(tid('req-row-r1')).first().waitFor({ timeout: 6000 });
      await page.waitForTimeout(400);
      const m = {};
      for (const id of ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7']) {
        await page.locator(tid(`req-row-${id}`)).first().scrollIntoViewIfNeeded().catch(() => {});
        m[id] = await measure(page, tid(`req-row-${id}`));
      }
      await page.locator(tid('req-row-r1')).first().scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(200);
      await shot('list');
      if (!V.ua) {
        const upd = await page.evaluate(() => ['r1', 'r2', 'r3'].map(id => document.querySelector(`[data-testid="task-time-${id}-updated"]`)?.textContent ?? null));
        record(where, 'desktop table: compact 3/5 chip in the title cell; updater after the time', {
          r1Chip: m.r1.compactText === '3/5' && m.r1.compact.h === 20,
          r2Complete: m.r2.compactText === '5/5' && m.r2.progComplete === '1',
          r3None: m.r3.compact === null,
          r4Summary: m.r4.compactText === '2/7',
          noBar: m.r1.prog === null,
          updater: !!upd[0] && upd[0].includes('示例成员甲') && !!upd[1] && upd[1].includes('示例-一个名字') && !!upd[2] && !upd[2].includes('·'),
          noHScroll: await noHScroll(),
        }, { updated: upd.join(' | ') });
        const cell = (id) => page.evaluate((id) => {
          const q = (s) => document.querySelector(`[data-testid="task-time-${id}-updated${s}"]`);
          const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x, right: b.right, cy: Math.round((b.y + b.height / 2) * 2) / 2, h: b.height }; };
          const cellBox = q('')?.parentElement?.getBoundingClientRect();
          const pv = q('-preview');
          const ln = q('-line');
          return { text: q('')?.textContent.replace(/\u00a0/g, ' ') ?? null, by: r(q('-by')), verb: r(q('-verb')), verbText: q('-verb')?.textContent.replace(/\u00a0/g, ' ').trim() ?? null,
            preview: r(pv), line: r(ln), lineTrunc: ln ? ln.scrollWidth > ln.clientWidth + 0.5 : null, cellRight: cellBox ? cellBox.right : null };
        }, id);
        const t5 = await cell('r5'), t6 = await cell('r6'), t7 = await cell('r7');
        const zh = lang === 'zh';
        record(where, 'desktop table with last_event: 「time · who did what」+ comment preview, one centre line', {
          r5: !!t5.text && t5.text.includes('示例成员甲') && t5.verbText === (zh ? '评论了' : 'commented') && !!t5.preview && !!t5.line && t5.line.right <= t5.cellRight + 0.5 && t5.lineTrunc === true,
          r6: t6.verbText === (zh ? '把状态改成「进行中」' : 'moved to In progress') && !/doing/.test(t6.text ?? ''),
          r7: t7.by === null && t7.verbText === (zh ? '改了优先级' : 'changed priority'),
          centre: [t5, t6].every(c => c.by && c.verb && Math.abs(c.by.cy - c.verb.cy) <= 1) && Math.abs(t5.preview.cy - t5.verb.cy) <= 1,
          noHScroll: await noHScroll(),
        }, { r5: t5.text, r6: t6.text, r7: t7.text });
        geo.push({ where, view: 'table-event', id: 'r5', byCy: t5.by?.cy, verbCy: t5.verb?.cy, previewCy: t5.preview?.cy, lineRight: t5.line?.right, cellRight: t5.cellRight });
        const c = m.r1;
        geo.push({ where, view: 'table', id: 'r1', chipCy: c.compact?.cy, titleCy: c.title?.cy, prioCy: c.prio?.cy, dueCy: c.due?.cy, chipH: c.compact?.h, prioH: c.prio?.h, dueH: c.due?.h, rowH: c.card.h });
        record(where, 'table geometry: progress chip / P-badge / due chip share one centre line and height 20', {
          chipPrio: Math.abs(c.compact.cy - c.prio.cy) <= 0.5,
          chipDue: Math.abs(c.compact.cy - c.due.cy) <= 0.5,
          chipTitle: Math.abs(c.compact.cy - c.title.cy) <= 1,
          heights: c.compact.h === 20 && c.prio.h === 20 && c.due.h === 20,
        }, { chipCy: c.compact.cy, prioCy: c.prio.cy, dueCy: c.due.cy, titleCy: c.title.cy });
      } else {
        record(where, 'phone list rows: compact chip (no bar) + activity line', {
          r1Chip: m.r1.compactText === '3/5' && m.r1.prog === null,
          r2Complete: m.r2.compactText === '5/5' && m.r2.progComplete === '1',
          r3None: m.r3.compact === null,
          activity: ['r1', 'r2', 'r3', 'r4'].every(id => !!m[id].act && m[id].act.h <= 17 && m[id].act.right <= m[id].card.right),
          agentTrunc: m.r2.nameTruncated === true,
          eventRows: m.r5.actVerb === 'commented' && m.r5.preview === null && m.r6.verbText === (lang === 'zh' ? '把状态改成「进行中」' : 'moved to In progress') && m.r6.verbTruncated === false && m.r7.actActor === 'none',
          eventRowsInside: ['r5', 'r6', 'r7'].every(id => !!m[id].act && m[id].act.h <= 17 && m[id].act.right <= m[id].card.right),
          noHScroll: await noHScroll(),
        });
        const c = m.r1;
        geo.push({ where, view: 'phone-list', id: 'r1', prioCy: c.prio?.cy, dueCy: c.due?.cy, chipX: c.compact?.x, prioX: c.prio?.x, actX: c.act?.x, chipH: c.compact?.h, prioH: c.prio?.h, dueH: c.due?.h, rowH: c.card.h });
        record(where, 'phone list geometry: chip / activity left = P-badge left; chip height = badge height', {
          chipLeft: Math.abs(c.compact.x - c.prio.x) <= 0.5,
          actLeft: Math.abs(c.act.x - c.prio.x) <= 0.5,
          heights: c.compact.h === c.prio.h && c.prio.h === c.due.h,
          prioDue: Math.abs(c.prio.cy - c.due.cy) <= 0.5,
        });
      }
    });
    record(where, 'page errors', { none: errors.length === 0 }, { errors: errors.slice(0, 3).join(' | ') || '-' });
  } catch (e) {
    failures++;
    console.log(JSON.stringify({ where, error: String(e).split('\n')[0] }));
    if (OUT) await page.screenshot({ path: `${OUT}/${name}-${theme}-${lang}-FAIL.png` }).catch(() => {});
  }
  await ctx.close();
}
await browser.close();
web.close();
console.log('\n# geometry (px, viewport coords)');
console.table(geo);
if (OUT) writeFileSync(`${OUT}/geometry.json`, JSON.stringify(geo, null, 2));
console.log(failures ? `\n${failures} check group(s) failed` : `\nall ${rows.length} check groups passed`);
process.exit(failures ? 1 : 0);
