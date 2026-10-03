// #499 到期提醒气泡的「查看任务 ›」—— 真 App(expo web export)+ layout sweep 的页内 Tauri 桩
// (tests/test-layout-sweep/harness.mjs:不起 hub、不占端口、不碰 HOME)。Placeholder data only.
//
//   WEB_DIR=<expo export dir> [OUT=<png dir>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] node tests/test-due-reminder-link/drive.mjs
//
// 负责 Agent(示例-A)主动发来一条到期提醒(user_inbox:kind=task_due + meta.task_notice)和一条普通主动消息。
// desktop 1280×800(Tauri 桩 ⇒ 鼠标)/ phone 390×844(Android UA ⇒ 触屏),light + dark:
//   link      到期提醒的回复气泡里有「查看任务 ›」;普通主动消息的气泡里没有
//   geometry  链接在气泡内(左右下都不出界)、在正文下方、左边与正文左边对齐(±1px)、可点高度 ≥ 24px
//   open      点链接 → 切到任务页并打开那张任务(编辑面板里出现它的标题)
// 打印测量表。任何一项不过 exit 1。
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium, ANDROID_UA } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
if (OUT) mkdirSync(OUT, { recursive: true });

const TASK_NAME = '示例任务:到期提醒';
const DUE_TEXT = '任务#7「示例任务:到期提醒」已逾期 2 天,还没有完成。';
const PLAIN_TEXT = '普通主动消息:构建完成。';

const fixture = ({ taskName, dueText, plainText }) => {
  const at = (min) => new Date(Date.now() - min * 60000).toISOString();
  const meta = JSON.stringify({ task_notice: { requirement_id: 't7', seq: 7, network_id: 'net-sweep', due_reminder: 'overdue', due: '2026-09-24', overdue_days: 2 } });
  window.__userMessagesFixture = [
    { message_id: 'dm_due_1', from_session: '示例-A', kind: 'task_due', title: '任务已逾期', content: dueText, severity: 'warning', meta_json: meta, acked: 1, created_at: at(2) },
    { message_id: 'dm_plain_1', from_session: '示例-A', kind: 'agent_message', title: null, content: plainText, severity: 'info', meta_json: null, acked: 1, created_at: at(5) },
  ];
  window.__chatTasksFixture = [];
  const other = { kind: 'user', id: 'u_a' };
  window.__tasksFixture = {
    meId: 'u_tester',
    requirements: [
      { id: 't7', seq: 7, name: taskName, priority: 'normal', assignee: '', column: 'doing', owner: other, participants: [], agent_owner: null, project_id: null, due: '2026-09-24', createdAt: at(3000), updatedAt: at(1), description: '', checklist: [], tags: [], parent_id: null },
      { id: 't8', seq: 8, name: '示例任务:别的', priority: 'normal', assignee: '', column: 'pool', owner: other, participants: [], agent_owner: null, project_id: null, due: '', createdAt: at(2900), updatedAt: at(1), description: '', checklist: [], tags: [], parent_id: null },
    ],
    projects: [],
    people: [{ kind: 'user', id: 'u_tester', networkId: 'net-sweep', name: 'tester' }, { kind: 'user', id: 'u_a', networkId: 'net-sweep', name: '示例成员甲' }],
    capabilities: ['agent_owner', 'description', 'checklist', 'requirement_seq'],
  };
};

// 气泡 = 文本向上第一个有背景色且有圆角的祖先(同 test-chat-bubble-geometry)。
const measure = ({ dueText, plainText }) => {
  const bg = (el) => { const c = getComputedStyle(el).backgroundColor; return c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent'; };
  const bubbleOf = (el) => { let b = el; while (b && !(bg(b) && parseFloat(getComputedStyle(b).borderTopLeftRadius) > 0)) b = b.parentElement; return b; };
  const textEl = (s) => [...document.querySelectorAll('div, span')].filter(e => e.getClientRects().length && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.includes(s))).pop();
  const lineBox = (el) => { const r = document.createRange(); r.selectNodeContents(el); const rs = [...r.getClientRects()]; return { left: Math.min(...rs.map(x => x.left)), right: Math.max(...rs.map(x => x.right)), bottom: Math.max(...rs.map(x => x.bottom)) }; };
  const dueEl = textEl(dueText.slice(0, 8));
  const plainEl = textEl(plainText.slice(0, 6));
  const links = [...document.querySelectorAll('[data-testid="chat-open-task"]')].filter(e => e.getClientRects().length);
  if (!dueEl) return { error: 'due reminder text not found' };
  const bubble = bubbleOf(dueEl);
  const plainBubble = plainEl ? bubbleOf(plainEl) : null;
  const link = links.find(l => bubble && bubble.contains(l));
  const b = bubble.getBoundingClientRect();
  const lb = link ? link.getBoundingClientRect() : null;
  const linkText = link ? [...link.querySelectorAll('*')].concat(link).find(e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) : null;
  const tb = lineBox(dueEl);
  const ltb = linkText ? lineBox(linkText) : null;
  return {
    links: links.length,
    linkLabel: link ? link.textContent.trim() : '',
    linkInPlain: !!(plainBubble && plainBubble !== bubble && plainBubble.querySelector('[data-testid="chat-open-task"]')),
    bubble: { left: b.left, right: b.right, top: b.top, bottom: b.bottom },
    link: lb ? { left: lb.left, right: lb.right, top: lb.top, bottom: lb.bottom, h: lb.height } : null,
    linkTextLeft: ltb ? ltb.left : null,
    linkColor: linkText ? getComputedStyle(linkText).color : null,
    bodyText: tb,
  };
};

const VIEWS = { desktop: { w: 1280, h: 800 }, phone: { w: 390, h: 844, ua: ANDROID_UA } };
const web = await serveExport(WEB);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
const rows = [];
let failures = 0;
const r1 = (n) => (n === null || n === undefined ? '-' : Math.round(n * 10) / 10);
for (const [kind, V] of Object.entries(VIEWS)) for (const theme of ['light', 'dark']) {
  const where = `${kind}/${theme}`;
  const ctx = await browser.newContext({ viewport: { width: V.w, height: V.h }, ...(V.ua ? { userAgent: V.ua, hasTouch: true } : {}), colorScheme: theme, deviceScaleFactor: 2, locale: 'zh-CN' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message.split('\n')[0]));
  try {
    await page.addInitScript(initScript, { theme });
    await page.addInitScript(fixture, { taskName: TASK_NAME, dueText: DUE_TEXT, plainText: PLAIN_TEXT });
    await page.addInitScript(() => { try { localStorage.setItem('anet.language.v1', 'zh'); } catch {} });
    await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
    await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 20000 });
    await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'chat', alias: '示例-A' }));
    await page.getByText(DUE_TEXT.slice(0, 8)).first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(800);
    const m = await page.evaluate(measure, { dueText: DUE_TEXT, plainText: PLAIN_TEXT });
    if (OUT) await page.screenshot({ path: `${OUT}/${kind}-${theme}-chat.png` });
    if (m.error) throw new Error(m.error);
    const checks = {
      oneLink: m.links === 1,
      label: m.linkLabel === '查看任务 ›',
      notOnPlain: !m.linkInPlain,
      inside: !!m.link && m.link.left >= m.bubble.left - 0.5 && m.link.right <= m.bubble.right + 0.5 && m.link.bottom <= m.bubble.bottom + 0.5,
      belowText: !!m.link && m.link.top >= m.bodyText.bottom - 0.5,
      leftAligned: m.linkTextLeft !== null && Math.abs(m.linkTextLeft - m.bodyText.left) <= 1,
      tapHeight: !!m.link && m.link.h >= 24 - 0.5,
    };
    // 点链接 → 任务页打开 t7(编辑面板里有它的标题,且不再是会话页)
    const link = page.locator('[data-testid="chat-open-task"]').first();
    if (V.ua) await link.tap(); else await link.click();
    let opened = false;
    try {
      await page.waitForFunction((name) => [...document.querySelectorAll('input, textarea, div, span')].some(e => e.getClientRects().length && ((e.value ?? '') === name) && e.getBoundingClientRect().width > 0), TASK_NAME, { timeout: 8000 });
      opened = true;
    } catch { opened = false; }
    if (OUT) await page.screenshot({ path: `${OUT}/${kind}-${theme}-opened.png` });
    checks.opensTask = opened;
    checks.noPageErrors = errors.length === 0;
    const ok = Object.values(checks).every(Boolean);
    if (!ok) failures++;
    rows.push({ where, ok, failed: Object.keys(checks).filter(k => !checks[k]).join(',') || '-',
      bubble: `${r1(m.bubble.left)}–${r1(m.bubble.right)} / bottom ${r1(m.bubble.bottom)}`,
      link: m.link ? `${r1(m.link.left)}–${r1(m.link.right)} top ${r1(m.link.top)} h ${r1(m.link.h)}` : '-',
      textLeft: `${r1(m.bodyText.left)} vs link ${r1(m.linkTextLeft)}`, textBottom: r1(m.bodyText.bottom), color: m.linkColor, errors: errors.join(' | ') || '-' });
  } catch (e) {
    failures++;
    rows.push({ where, ok: false, failed: `NOT RUN: ${String(e.message || e).split('\n')[0].slice(0, 120)}` });
    if (OUT) await page.screenshot({ path: `${OUT}/${kind}-${theme}-FAIL.png` }).catch(() => {});
  }
  await ctx.close();
}
await browser.close();
web.close();

console.log('\n| where | ok | failed | bubble x / bottom | link box | text left vs link left | text bottom | link colour | page errors |\n|---|---|---|---|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.where} | ${r.ok ? 'PASS' : 'FAIL'} | ${r.failed} | ${r.bubble ?? '-'} | ${r.link ?? '-'} | ${r.textLeft ?? '-'} | ${r.textBottom ?? '-'} | ${r.color ?? '-'} | ${r.errors ?? '-'} |`);
console.log(`\n${rows.length} views, ${failures} failing`);
process.exit(failures || !rows.length ? 1 : 0);
