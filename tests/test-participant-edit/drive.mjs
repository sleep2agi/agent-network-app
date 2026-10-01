// 参与人能改状态和检查项(hub agent-network#2201,viewer_can.edit_fields)+ 任务通知私信点开任务(meta.task_notice)
// —— 点真按钮、量真框、截下真请求体。Placeholder data only, served in-page by the Tauri stub in
// tests/test-layout-sweep/harness.mjs (no hub process, no port, no HOME touched).
// Not in CI: needs Playwright + Chromium and a web export.
//
//   WEB_DIR=<expo export dir> [OUT=<png dir>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] node tests/test-participant-edit/drive.mjs
//
// desktop 1440×900 (Tauri stub ⇒ mouse) and phone 390×844 (Android UA ⇒ touch), light + dark:
//   chip      参与人的卡: 「仅可改状态和检查项」, inside the card; 旧 Hub 的只读卡: 「只读」(unchanged)
//   drag      desktop: 参与人的卡 carries data-task-from (draggable), the old read-only card does not
//   detail    参与人: banner says what is allowed; status segment + 「更多」 + checklist respond (pointer-events auto),
//             title / roles / description / the rest are locked (pointer-events none); no 「保存修改」
//   requests  move → PATCH body exactly {"column":"doing"}; tick → PATCH …/checklist/i1 {"done":true};
//             add → PATCH body keys exactly [checklist]. Nothing else is ever sent.
//   old hub   the read-only card without edit_fields: whole form locked, status buttons aria-disabled, no request
//   dm        a 任务更新 DM (meta_json.task_notice) shows 「查看任务 ›」 in its bubble; tapping it opens that task
//   toast     a desktop_message SSE event with meta.task_notice shows 「查看任务 ›」 in the top toast; tapping opens the task
// Prints a measurement table. Exit 1 when any check fails or a viewport could not be opened.
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium, ANDROID_UA, zeroSizeText } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
if (OUT) mkdirSync(OUT, { recursive: true });

const fixture = () => {
  const at = (min) => new Date(Date.now() - min * 60000).toISOString();
  const me = { kind: 'user', id: 'u_tester' }, ua = { kind: 'user', id: 'u_a' };
  const R = (id, seq, name, o) => ({ id, seq, name, priority: 'normal', assignee: '', column: 'pool', owner: ua, participants: [], agent_owner: null, project_id: null, due: '', createdAt: at(3000), updatedAt: at(1), description: '示例描述', checklist: [], tags: [], parent_id: null, ...o });
  window.__tasksFixture = {
    meId: 'u_tester',
    requirements: [
      R('r1', 21, '示例任务一:我参与', { participants: [me], checklist: [{ id: 'i1', text: '写测试', done: false }, { id: 'i2', text: '发版', done: false }], viewer_can: { edit: false, delete: false, edit_fields: ['column', 'checklist'] } }),
      R('r2', 22, '示例任务二:只看项目', { checklist: [{ id: 'j1', text: '示例检查项', done: false }], viewer_can: { edit: false, delete: false } }),
      R('r3', 23, '示例任务三:我负责', { owner: me }),
    ],
    projects: [],
    people: [
      { kind: 'user', id: 'u_tester', networkId: 'net-sweep', name: 'tester' },
      { kind: 'user', id: 'u_a', networkId: 'net-sweep', name: '示例成员甲' },
    ],
    capabilities: ['agent_owner', 'description', 'checklist', 'requirement_seq'],
  };
  const notice = (id, seq, text, min) => ({ message_id: `dm_task_${id}`, content: text, title: '任务更新', direction: 'in', from_session: 'shili_jia', acked: 1, created_at: at(min), meta_json: JSON.stringify({ task_notice: { requirement_id: id, seq, network_id: 'net-sweep' } }) });
  window.__routeOverride = (u, bodyText, method) => {
    const p = u.pathname;
    const ck = /^\/api\/requirements\/([^/]+)\/checklist\/([^/]+)$/.exec(p);
    if (ck && bodyText) {
      const b = JSON.parse(bodyText);
      (window.__checklistPatches ||= []).push({ id: ck[1], item: ck[2], body: b });
      const row = window.__tasksFixture.requirements.find(r => r.id === decodeURIComponent(ck[1]));
      const it = row?.checklist.find(x => x.id === decodeURIComponent(ck[2]));
      if (!it) return null;
      it.done = b.done;
      return { ok: true, requirement: row };
    }
    if (p === '/api/networks/net-sweep/humans') return { ok: true, humans: [{ user_id: 'u_tester', username: 'tester' }, { user_id: 'u_a', username: 'shili_jia', display_name: '示例成员甲' }] };
    if (p === '/api/dm/threads') return { ok: true, threads: [{ other_user_id: 'u_a', last_at: at(2), unread: 0 }] };
    if (p === '/api/dm' && method !== 'POST') return { ok: true, messages: [notice('r3', 23, '示例成员甲 改了「示例任务三:我负责」:状态 需求池 → 进行中', 2), { message_id: 'dm_plain_1', content: '普通私信,没有任务', direction: 'in', from_session: 'shili_jia', acked: 1, created_at: at(5) }] };
    return undefined;
  };
};

// After the harness stub: a user token (so the app opens the user event stream) and a handle on that stream,
// so the drive can push one desktop_message the way the hub does.
const streamHook = () => {
  const orig = window.__TAURI_INTERNALS__.invoke;
  window.__ue = { handlers: [], streams: [] };
  window.__TAURI_INTERNALS__.invoke = async (cmd, args) => {
    if (cmd === 'load_active_desktop_profile') { const prof = JSON.parse(await orig(cmd, args)); prof.token = 'utok_placeholder'; return JSON.stringify(prof); }
    if (cmd === 'plugin:event|listen' && args?.event === 'user-event-stream') { window.__ue.handlers.push(args.handler); return window.__ue.handlers.length; }
    if (cmd === 'start_user_event_stream') { window.__ue.streams.push(args.streamId); return null; }
    if (cmd === 'stop_user_event_stream') return null;
    return orig(cmd, args);
  };
  window.__pushUserEvent = (event) => {
    for (const h of window.__ue.handlers) for (const s of window.__ue.streams) window[`_${h}`]?.({ event: 'user-event-stream', id: 1, payload: { kind: 'event', stream_id: s, event } });
  };
};

const rows = [];
const measures = [];
let failures = 0;
function record(where, what, checks, detail = {}) {
  const ok = Object.values(checks).every(Boolean);
  if (!ok) failures++;
  const row = { where, what, ...detail, ok, failed: Object.keys(checks).filter(k => !checks[k]).join(',') || '-' };
  rows.push(row);
  console.log(JSON.stringify(row));
}
const r1 = (n) => Math.round(n * 10) / 10;
const tid = (id) => `[data-testid="${id}"]`;
const bb = async (page, sel) => { const l = page.locator(sel).first(); return (await l.count()) && await l.isVisible() ? l.boundingBox() : null; };
const measure = (where, el, b) => { if (b) measures.push({ where, el, x: r1(b.x), y: r1(b.y), w: r1(b.width), h: r1(b.height) }); };
const inside = (a, b) => !!(a && b) && a.x >= b.x - 0.5 && a.y >= b.y - 0.5 && a.x + a.width <= b.x + b.width + 0.5 && a.y + a.height <= b.y + b.height + 0.5;
// What a locked block may NOT contain: inputs, rich-text editors, buttons / pickers, icon glyphs (chevrons, calendar,
// toolbar icons all come from the Ionicons font). It must contain plain label + value rows only.
const lockedJunk = (page, id) => page.evaluate((s) => {
  const root = document.querySelector(s);
  if (!root) return ['missing'];
  const out = [];
  for (const el of root.querySelectorAll('*')) {
    if (!el.getClientRects().length) continue;
    const tag = el.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || el.isContentEditable) out.push(tag);
    const role = el.getAttribute('role');
    if (role && /button|combobox|checkbox|radio|link|toolbar|textbox/.test(role)) out.push(`role=${role}`);
    if (/ionicons/i.test(getComputedStyle(el).fontFamily) && el.textContent.trim()) out.push('icon');
  }
  return out;
}, `[data-testid="${id}"]`);
const pe = (page, id) => page.evaluate((s) => { const el = document.querySelector(s); return el ? getComputedStyle(el).pointerEvents : null; }, tid(id));

const VIEWPORTS = {
  desktop: { w: 1440, h: 900, ua: undefined },
  phone: { w: 390, h: 844, ua: ANDROID_UA },
};

const web = await serveExport(WEB);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
for (const [name, V] of Object.entries(VIEWPORTS)) {
  for (const theme of ['light', 'dark']) {
    const where = `${name}/${theme}`;
    const ctx = await browser.newContext({ viewport: { width: V.w, height: V.h }, ...(V.ua ? { userAgent: V.ua, hasTouch: true } : {}), colorScheme: theme, deviceScaleFactor: 2, locale: 'zh-CN' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message.split('\n')[0]));
    const press = (loc) => (V.ua ? loc.tap() : loc.click());
    const shot = async (n) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}-${theme}-${n}.png` }); };
    const patches = () => page.evaluate(() => ({ card: window.__tasksPatches || [], item: window.__checklistPatches || [] }));
    const closeDetail = async () => {
      const close = page.locator(tid(name === 'phone' ? 'req-detail-close' : 'req-detail-close-x')).first();
      if (await close.count() && await close.isVisible()) await press(close); else await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
    };
    let step = 'load';
    try {
      await page.addInitScript(initScript, { theme });
      await page.addInitScript(streamHook);
      await page.addInitScript(fixture);
      await page.addInitScript(() => { try { localStorage.setItem('anet.language.v1', 'zh'); } catch {} });
      await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
      await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 20000 });
      await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'tasks' }));
      await page.locator(tid('tasks-view')).first().waitFor({ timeout: 15000 });
      await page.locator(tid('req-card-r1')).first().waitFor({ timeout: 10000 });
      await page.waitForTimeout(600);

      step = 'chips';
      const c1 = await bb(page, tid('req-card-r1')), c2 = await bb(page, tid('req-card-r2'));
      const t1 = await bb(page, `${tid('req-card-r1')} ${tid('task-read-only-tag')}`), t2 = await bb(page, `${tid('req-card-r2')} ${tid('task-read-only-tag')}`);
      measure(where, 'card r1(参与人)', c1); measure(where, 'chip r1', t1); measure(where, 'card r2(旧只读)', c2); measure(where, 'chip r2', t2);
      // innerText carries the lock glyph on its own line first; the label is the last line.
      const txt = async (id) => (await page.locator(`${tid(id)} ${tid('task-read-only-tag')}`).first().innerText().catch(() => '')).split('\n').map(x => x.trim()).filter(Boolean).pop() ?? '';
      const from = (id) => page.locator(tid(`req-card-${id}`)).first().getAttribute('data-task-from');
      const chipChecks = {
        partialText: (await txt('req-card-r1')) === '仅可改状态和检查项',
        oldText: (await txt('req-card-r2')) === '只读',
        chipInsideCard: inside(t1, c1) && inside(t2, c2),
        chipNotClipped: (await zeroSizeText(page, tid('req-card-r1'))).length === 0,
        r3NoChip: (await page.locator(`${tid('req-card-r3')} ${tid('task-read-only-tag')}`).count()) === 0,
      };
      if (name === 'desktop') { chipChecks.partialDraggable = (await from('r1')) === 'pool'; chipChecks.oldNotDraggable = (await from('r2')) === null; }
      record(where, 'chips', chipChecks, { r1: await txt('req-card-r1'), r2: await txt('req-card-r2') });
      await shot('board');

      step = 'open r1';
      await press(page.locator(tid('req-card-r1')).first());
      await page.locator(tid('req-detail-read-only')).first().waitFor({ timeout: 5000 });
      await page.waitForTimeout(300);
      const banner = await bb(page, tid('req-detail-read-only')), moveGroup = await bb(page, tid('req-move-group'));
      measure(where, '详情 banner', banner); measure(where, '状态 segment', moveGroup);
      await shot('detail-participant');
      const more = page.locator(tid('req-more-toggle')).first();
      if (!(await page.locator(tid('req-checklist')).count())) { await press(more); await page.waitForTimeout(300); }
      await page.locator(tid('req-checklist-wrap')).first().scrollIntoViewIfNeeded();
      const ckWrap = await bb(page, tid('req-checklist-wrap'));
      measure(where, '检查项(滚到可见)', ckWrap);
      const bannerText = (await page.locator(tid('req-detail-read-only')).first().innerText()).trim();
      record(where, 'detail locks', {
        bannerSaysAllowed: bannerText.includes('仅可改状态和检查项'),
        fieldsOpen: (await pe(page, 'req-detail-fields')) === 'auto',
        statusOpen: (await pe(page, 'req-move-group')) === 'auto' && (await page.locator(tid('req-move-doing')).first().getAttribute('aria-disabled')) !== 'true',
        checklistOpen: (await pe(page, 'req-checklist-wrap')) === 'auto',
        moreToggleWorks: (await page.locator(tid('req-checklist')).count()) === 1,
        titleLocked: (await pe(page, 'req-locked-title')) === 'none',
        mainLocked: (await pe(page, 'req-locked-main')) === 'none',
        moreLocked: (await pe(page, 'req-locked-more')) === 'none',
        restLocked: (await pe(page, 'req-locked-rest')) === 'none',
        noSave: (await page.locator(tid('req-edit-save')).count()) === 0,
        titleIsText: (await page.locator(tid('req-edit-name')).count()) === 0 && (await page.locator(tid('req-locked-name')).first().innerText()).trim() === '示例任务一:我参与',
        valueRows: (await Promise.all(['owner', 'agent', 'due', 'description'].map(k => page.locator(tid(`req-locked-row-${k}`)).count()))).every(n => n === 1),
        bannerInDrawer: !!banner && banner.y >= 0 && !!moveGroup && moveGroup.y > banner.y + banner.height,
      }, { bannerText });
      const junk = {};
      for (const id of ['req-locked-title', 'req-locked-main', 'req-locked-more', 'req-locked-rest']) junk[id] = await lockedJunk(page, id);
      record(where, 'locked blocks are value-only (no input / chevron / toolbar / chips)', Object.fromEntries(Object.entries(junk).map(([k, v]) => [k, v.length === 0])), { junk: JSON.stringify(junk) });
      for (const k of ['owner', 'due', 'description', 'priority', 'participants']) measure(where, `locked row ${k}`, await bb(page, tid(`req-locked-row-${k}`)));
      await shot('detail-participant-checklist');

      step = 'requests';
      await press(page.locator(tid('req-checklist-item-i1')).first());
      await page.waitForTimeout(400);
      await page.locator(tid('req-checklist-input')).first().fill('回归');
      await press(page.locator(tid('req-checklist-add')).first());
      await page.waitForTimeout(400);
      await press(page.locator(tid('req-move-doing')).first());
      await page.waitForTimeout(600);
      const sent = await patches();
      const bodies = sent.card.map(b => JSON.stringify(b));
      record(where, 'request bodies', {
        tick: sent.item.length === 1 && sent.item[0].id === 'r1' && sent.item[0].item === 'i1' && JSON.stringify(sent.item[0].body) === '{"done":true}',
        add: sent.card.some(b => Object.keys(b).join() === 'checklist' && b.checklist.some(x => x.text === '回归')),
        move: bodies.includes('{"column":"doing"}'),
        onlyAllowedKeys: sent.card.every(b => Object.keys(b).every(k => k === 'column' || k === 'checklist')),
        noError: !(await page.locator(tid('req-checklist-error')).count()),
      }, { card: bodies.join(' | '), item: JSON.stringify(sent.item) });
      await shot('detail-after-edit');
      await closeDetail();

      step = 'open r2';
      if (name === 'phone') { await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'tasks' })); await page.waitForTimeout(300); }
      await press(page.locator(tid('req-card-r2')).first());
      await page.locator(tid('req-detail-read-only')).first().waitFor({ timeout: 5000 });
      await page.waitForTimeout(300);
      const before = (await patches()).card.length;
      const oldBanner = (await page.locator(tid('req-detail-read-only')).first().innerText()).trim();
      record(where, 'old hub read-only', {
        bannerUnchanged: oldBanner.includes('没有编辑权限'),
        wholeFormLocked: (await pe(page, 'req-detail-fields')) === 'none',
        statusDisabled: (await page.locator(tid('req-move-doing')).first().getAttribute('aria-disabled')) === 'true',
        noPerBlockWrappers: (await page.locator(tid('req-locked-title')).count()) === 0,
        noSave: (await page.locator(tid('req-edit-save')).count()) === 0,
        noRequest: (await patches()).card.length === before,
      }, { oldBanner });
      await shot('detail-old-readonly');
      await closeDetail();

      step = 'dm';
      await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'dm', alias: 'shili_jia', userId: 'u_a', displayName: '示例成员甲' }));
      await page.locator(tid('dm-open-task')).first().waitFor({ timeout: 8000 });
      await page.waitForTimeout(300);
      const link = await bb(page, tid('dm-open-task'));
      const bubble = await page.locator(tid('dm-bubble')).filter({ has: page.locator(tid('dm-open-task')) }).first().boundingBox();
      measure(where, '私信 查看任务', link); measure(where, '私信 bubble', bubble);
      record(where, 'dm link', {
        onlyOnNotice: (await page.locator(tid('dm-open-task')).count()) === 1,
        insideBubble: inside(link, bubble),
        tapTarget: !!link && link.height >= 24,
        text: (await page.locator(tid('dm-open-task')).first().innerText()).trim() === '查看任务 ›',
      });
      await shot('dm');
      await press(page.locator(tid('dm-open-task')).first());
      await page.locator(tid('req-edit-name')).first().waitFor({ timeout: 8000 });
      await page.waitForTimeout(400);
      record(where, 'dm opens task', { r3: (await page.locator(tid('req-edit-name')).first().inputValue()) === '示例任务三:我负责' });
      await shot('dm-opened-task');
      await closeDetail();

      step = 'toast';
      await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'agents' }));
      await page.waitForTimeout(500);
      const streams = await page.evaluate(() => window.__ue.streams.length);
      // A plain agent toast with a long body: same layout fix applies to every toast (the old row squeezed the title).
      await page.evaluate(() => window.__pushUserEvent({ type: 'desktop_message', scope: 'user', message_id: `plain_${Date.now()}`, kind: 'agent_message', from: '示例-A', title: '构建完成', message: '示例-A:构建已经完成,全部检查通过,产物已经上传到示例存储,可以开始下一步验证了。', severity: 'success', network_id: 'net-sweep' }));
      await page.locator(tid('desktop-message-title')).first().waitFor({ timeout: 5000 });
      await page.waitForTimeout(400);
      const plain = await page.evaluate(() => { const el = document.querySelector('[data-testid="desktop-message-title"]'); return { text: el?.textContent, full: !!el && el.scrollWidth <= el.clientWidth + 0.5, w: el ? Math.round(el.getBoundingClientRect().width * 10) / 10 : 0 }; });
      record(where, 'plain toast title', { full: plain.text === '构建完成' && plain.full }, plain);
      await shot('toast-plain');
      await page.evaluate(() => window.__pushUserEvent({ type: 'desktop_message', scope: 'user', message_id: `dm_task_toast_${Date.now()}`, kind: 'human_dm', from: 'shili_jia', title: '任务更新', message: '示例成员甲 改了「示例任务一:我参与」:检查项「写测试」已完成', severity: 'info', network_id: 'net-sweep', created_at: new Date().toISOString(), meta: { task_notice: { requirement_id: 'r1', seq: 21, network_id: 'net-sweep' } } }));
      await page.locator(tid('desktop-message-open-task')).first().waitFor({ timeout: 5000 });
      await page.waitForTimeout(400); // past the 140 ms fade-in
      const toastLook = await page.evaluate(() => {
        const t = document.querySelector('[data-testid="desktop-message-notice"]');
        const title = document.querySelector('[data-testid="desktop-message-title"]');
        const bg = getComputedStyle(t).backgroundColor;
        const alpha = /rgba\(([^)]+)\)/.exec(bg) ? Number(/rgba\(([^)]+)\)/.exec(bg)[1].split(',')[3]) : 1;
        let op = 1; for (let a = t; a && a !== document.body; a = a.parentElement) op *= Number(getComputedStyle(a).opacity);
        return { bg, alpha, op, title: title?.textContent, titleW: title ? Math.round(title.getBoundingClientRect().width * 10) / 10 : 0, titleFull: !!title && title.scrollWidth <= title.clientWidth + 0.5 };
      });
      const toast = await bb(page, tid('desktop-message-notice')), open = await bb(page, tid('desktop-message-open-task'));
      measure(where, 'toast', toast); measure(where, 'toast 查看任务', open);
      record(where, 'toast', { opaque: toastLook.alpha === 1 && toastLook.op === 1, titleFull: toastLook.title === '任务更新' && toastLook.titleFull, streamOpened: streams > 0, openInsideToast: inside(open, toast), withinViewport: !!toast && toast.x >= 0 && toast.x + toast.width <= V.w + 0.5 }, { streams, ...toastLook });
      await shot('toast');
      await press(page.locator(tid('desktop-message-notice')).locator('[role="button"]').first());
      await page.locator(tid('req-detail-read-only')).first().waitFor({ timeout: 8000 });
      await page.waitForTimeout(400);
      record(where, 'toast opens task', { r1: (await page.locator(tid('req-locked-name')).first().innerText()).trim() === '示例任务一:我参与', toastGone: (await page.locator(tid('desktop-message-notice')).count()) === 0 });
      await shot('toast-opened-task');

      record(where, 'page errors', { none: errors.length === 0 }, { errors: errors.join(' | ') });
    } catch (e) {
      failures++;
      console.log(JSON.stringify({ where, step, error: String(e).split('\n')[0] }));
      if (OUT) await page.screenshot({ path: `${OUT}/${name}-${theme}-FAIL-${step.replace(/\s+/g, '-')}.png` }).catch(() => {});
    }
    await ctx.close();
  }
}
await browser.close();
web.close();
console.log('\nmeasurements (CSS px):');
console.table(measures);
console.log(failures ? `\n${failures} check group(s) failed` : `\nall ${rows.length} check groups passed`);
process.exit(failures ? 1 : 0);
