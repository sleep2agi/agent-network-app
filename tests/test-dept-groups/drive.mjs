// 部门群 / 群聊(RFC-042,看板 #457 第 4 步;Hub ≥ .93)—— 点真按钮、量真框。Placeholder data only (alice / bob /
// carol, 研发部 / 销售部), served in-page by the Tauri stub in tests/test-layout-sweep/harness.mjs plus a small in-page Hub
// below that answers like Hub .93 (group_threads on /api/dm/threads, …/chat-groups, …/departments/:dept/group).
// Three Hubs: `new` = §10 (Hub #2284: /health capabilities chat_groups, last_message previews, member username /
// display_name, viewer_can); `93` = group routes but none of the §10 fields (the app falls back: probe, time-only rows,
// names from /humans, local manage rule); `old` = the current production Hub: no group_threads key, 404 on every group route.
// No hub process, no port, no HOME touched. SSE answers 404, so the chat runs on its 8 s poll.
//
//   WEB_DIR=<expo export dir> [OUT=<png dir>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] node tests/test-dept-groups/drive.mjs
//
// desktop 1280×800 (mouse), light (+ dark list/chat):
//   list     侧栏「群聊」区块在「人员」上面;按最后一条时间排(研发部 > 销售部);研发部未读角标 2;「未读 N」比旧 Hub 多 1
//   chat     点研发部 → 右面板群聊:标题 / 「群聊 · 3 人」/ 收到的消息各带发信人名字;打开即 POST …/read {seq: 最新};
//            角标清掉;发一条 ⇒ POST …/messages { message, client_request_id };输入卡片左右 / 底边距量出来对称
//   dept     「管理本部门」→ 研发部:部门群卡片(成员 + 「部门 / 手动」标签,移出只在手动行);前端(没有群)→「创建部门群」⇒ POST
//   old-hub  旧 Hub:没有「群聊」区块、部门页没有部门群卡片、没有页面错误
// phone 390×844 (Android UA ⇒ touch), light (+ dark list/chat):
//   list     「群聊」区块在「人员」上面
//   chat     点研发部 → 推入整页群聊,左上角返回;输入行:输入框 / ＋ 的竖直中线、左右内边距量出来
//   dept     设置 →「管理本部门」→ 研发部 → 「部门群 ›」→ 整页:成员 + 来源标签 + 改群名 / 添加成员
//   old-hub  旧 Hub:没有「群聊」区块、部门页没有「部门群」入口
// Each step runs on its own, so a pre-change export shows every red. Exit 1 on any failure.
import { mkdirSync, writeFileSync } from 'node:fs';
import { serveExport, initScript, findChromium, ANDROID_UA } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
if (OUT) mkdirSync(OUT, { recursive: true });

const fixture = ({ hub }) => {
  const NET = 'net-sweep';
  const now = Date.now();
  const at = (minAgo) => new Date(now - minAgo * 60000).toISOString().replace('T', ' ').replace('Z', '');
  const humans = [
    { user_id: 'u_me', username: 'tester', display_name: null },
    { user_id: 'u_a', username: 'alice', display_name: 'Alice' },
    { user_id: 'u_b', username: 'bob', display_name: 'Bob' },
    { user_id: 'u_c', username: 'carol', display_name: 'Carol' },
  ];
  const store = {
    departments: [
      { id: 'd_rd', name: '研发部', parent_id: null, leader_user_id: 'u_me', sort: 0 },
      { id: 'd_fe', name: '前端', parent_id: 'd_rd', leader_user_id: null, sort: 0 },
      { id: 'd_sales', name: '销售部', parent_id: null, leader_user_id: null, sort: 1 },
    ],
    members: { u_me: 'd_rd', u_a: 'd_rd', u_b: 'd_fe', u_c: 'd_sales' },
    groups: {
      g_rd: { id: 'g_rd', network_id: NET, name: '研发部', department_id: 'd_rd', created_by: 'u_me', created_at: at(600), updated_at: at(600),
        members: [{ user_id: 'u_me', source: 'department', joined_at: at(600) }, { user_id: 'u_a', source: 'department', joined_at: at(600) }, { user_id: 'u_c', source: 'manual', joined_at: at(300) }],
        messages: [
          { seq: 1, message_id: 'gm_1', sender_user_id: 'u_a', from_session: 'alice', content: '示例:今天下午三点评审', created_at: at(30) },
          { seq: 2, message_id: 'gm_2', sender_user_id: 'u_me', from_session: 'tester', content: '收到', created_at: at(20) },
          { seq: 3, message_id: 'gm_3', sender_user_id: 'u_c', from_session: 'carol', content: '示例:我也来旁听', created_at: at(5) },
        ], unread: 2 },
      g_sales: { id: 'g_sales', network_id: NET, name: '销售部', department_id: 'd_sales', created_by: 'u_x', created_at: at(900), updated_at: at(900),
        members: [{ user_id: 'u_me', source: 'manual', joined_at: at(900) }, { user_id: 'u_c', source: 'department', joined_at: at(900) }],
        messages: [{ seq: 4, message_id: 'gm_4', sender_user_id: 'u_c', from_session: 'carol', content: '', attachments: 2, created_at: at(120) }], unread: 0 },
    },
  };
  window.__groupCalls = [];
  const modern = hub !== 'old';
  const polish = hub === 'new';
  // §10 fields: only on the `new` Hub.
  const nameOfUid = (uid) => { const h = humans.find(x => x.user_id === uid); return h ? (h.display_name || h.username) : uid; };
  const memberOut = (x) => polish ? { ...x, username: humans.find(h => h.user_id === x.user_id)?.username ?? x.user_id, display_name: humans.find(h => h.user_id === x.user_id)?.display_name ?? '' } : x;
  const lastMessage = (g) => { const x = g.messages[g.messages.length - 1]; return x ? { text: x.content ?? '', attachment_count: x.attachments ?? 0, sender_user_id: x.sender_user_id, sender_name: nameOfUid(x.sender_user_id), at: x.created_at } : null; };
  const viewerCan = (g) => ({ manage: g.department_id === 'd_rd' || g.department_id === 'd_fe', post: g.id !== 'g_sales' });
  const dir = (uid, m) => (m.sender_user_id === uid ? 'out' : 'in');
  const groupPublic = (g) => ({ id: g.id, network_id: NET, name: g.name, department_id: g.department_id, member_count: g.members.length, created_by: g.created_by, created_at: g.created_at, updated_at: g.updated_at, ...(polish ? { viewer_can: viewerCan(g) } : {}) });
  const lastAt = (g) => g.messages.length ? g.messages[g.messages.length - 1].created_at : null;
  const threads = () => Object.values(store.groups).filter(g => g.members.some(m => m.user_id === 'u_me'))
    .map(g => ({ group_id: g.id, name: g.name, department_id: g.department_id, last_at: lastAt(g), unread: g.unread, last_read_seq: 0, ...(polish ? { last_message: lastMessage(g) } : {}) }))
    .sort((a, b) => String(b.last_at ?? '').localeCompare(String(a.last_at ?? '')));
  const row = (g, m) => ({ ...m, group_id: g.id, network_id: NET, meta_json: m.attachments ? JSON.stringify({ attachments: Array.from({ length: m.attachments }, (_, i) => ({ type: 'file', file_id: `f_demo_${i}`, name: `示例-${i + 1}.pdf`, mime: 'application/pdf' })) }) : null, kind: 'group_message', direction: dir('u_me', m) });
  window.__healthReads = 0;
  window.__routeOverride = (u, body, method) => {
    const p = u.pathname;
    if (p === '/health') { window.__healthReads++; return polish ? { status: 'ok', capabilities: ['status_node_id', 'node_permission_mode', 'chat_groups'] } : { status: 'ok' }; }
    if (p === '/api/auth/me') return { ok: true, user: { user_id: 'u_me', username: 'tester', role: 'user' }, current_network: NET, networks: [{ network_id: NET, network_name: '示例网络', member_role: 'member', agent_access: 'granted', task_access: 'scoped', managed_department_ids: ['d_rd', 'd_fe'] }] };
    if (p === `/api/networks/${NET}/humans`) return { ok: true, humans };
    if (p === '/api/dm/threads') return modern ? { ok: true, threads: [{ other_user_id: 'u_a', last_at: at(40), unread: 1 }], group_threads: threads() } : { ok: true, threads: [{ other_user_id: 'u_a', last_at: at(40), unread: 1 }] };
    if (p === '/api/dm') return { ok: true, messages: [] };
    if (p === `/api/networks/${NET}/departments`) return { ok: true,
      departments: store.departments.map(d => ({ ...d, member_count: Object.values(store.members).filter(x => x === d.id).length, viewer_can: { manage: d.id === 'd_fe', create_child: d.id === 'd_rd' || d.id === 'd_fe' } })),
      members: Object.entries(store.members).map(([user_id, department_id]) => ({ user_id, department_id })) };
    if (!modern && (p.includes('/chat-groups') || /\/departments\/[^/]+\/group$/.test(p))) return null; // 旧 Hub:404
    if (p === `/api/networks/${NET}/chat-groups`) { window.__groupCalls.push({ method, path: p }); } 
    if (p === `/api/networks/${NET}/chat-groups`) return { ok: true, network_id: NET, groups: Object.values(store.groups).map(g => ({ ...groupPublic(g), is_member: true, unread: g.unread, last_message_at: lastAt(g) })) };
    let m = /^\/api\/networks\/[^/]+\/departments\/([^/]+)\/group$/.exec(p);
    if (m) {
      const dept = decodeURIComponent(m[1]);
      window.__groupCalls.push({ method, path: p, body: body ? JSON.parse(body) : null });
      let g = Object.values(store.groups).find(x => x.department_id === dept);
      if (method === 'POST') {
        if (g) return { ok: false, error: 'department_group_exists', group_id: g.id };
        const d = store.departments.find(x => x.id === dept);
        g = store.groups[`g_${dept}`] = { id: `g_${dept}`, network_id: NET, name: d.name, department_id: dept, created_by: 'u_me', created_at: at(0), updated_at: at(0),
          members: Object.entries(store.members).filter(([, x]) => x === dept).map(([user_id]) => ({ user_id, source: 'department', joined_at: at(0) })).concat(d.leader_user_id ? [] : []), messages: [], unread: 0 };
        return { ok: true, group: groupPublic(g), members: g.members.map(memberOut) };
      }
      return g ? { ok: true, group: groupPublic(g), members: g.members.map(memberOut), is_member: g.members.some(x => x.user_id === 'u_me') } : null;
    }
    m = /^\/api\/networks\/[^/]+\/chat-groups\/([^/]+)(?:\/(members|messages|read)(?:\/([^/]+))?)?$/.exec(p);
    if (m) {
      const g = store.groups[decodeURIComponent(m[1])];
      if (!g) return null;
      const b = body ? JSON.parse(body) : null;
      if (method !== 'GET') window.__groupCalls.push({ method, path: p, body: b });
      if (m[2] === 'messages' && method === 'GET') return { ok: true, group_id: g.id, messages: g.messages.slice().reverse().map(x => row(g, x)), next_before: null, unread: g.unread };
      if (m[2] === 'messages' && method === 'POST') {
        const seq = Math.max(0, ...Object.values(store.groups).flatMap(x => x.messages.map(y => y.seq))) + 1;
        const msg = { seq, message_id: `gm_c_${b.client_request_id}`, sender_user_id: 'u_me', from_session: 'tester', content: b.message, created_at: at(0) };
        if (!g.messages.some(x => x.message_id === msg.message_id)) g.messages.push(msg);
        return { ok: true, group_id: g.id, message: row(g, msg), duplicate: false, delivered_to: 1 };
      }
      if (m[2] === 'read') { g.unread = 0; return { ok: true, group_id: g.id, last_read_seq: b?.seq ?? 0, unread: 0 }; }
      if (m[2] === 'members' && method === 'POST') { const mem = { user_id: b.user_id, source: 'manual', joined_at: at(0) }; g.members.push(mem); return { ok: true, member: memberOut(mem) }; }
      if (m[2] === 'members' && method === 'DELETE') { g.members = g.members.filter(x => x.user_id !== decodeURIComponent(m[3])); return { ok: true, removed: m[3] }; }
      if (!m[2] && method === 'PATCH') { g.name = b.name; return { ok: true, group: groupPublic(g) }; }
      if (!m[2]) return { ok: true, group: groupPublic(g), members: g.members.map(memberOut), is_member: true };
    }
    return undefined;
  };
};

const tid = (id) => `[data-testid="${id}"]`;
let failures = 0, rows = 0;
const measurements = [];
const record = (where, what, checks, extra = {}) => {
  const ok = Object.values(checks).every(Boolean);
  rows++; if (!ok) failures++;
  console.log(JSON.stringify({ where, what, ok, failed: Object.keys(checks).filter(k => !checks[k]).join(',') || '-', ...extra }));
};
const calls = (page) => page.evaluate(() => window.__groupCalls.slice());
const has = async (page, id) => (await page.locator(tid(id)).count()) > 0;
const box = async (page, sel) => page.locator(sel).first().boundingBox();
const r1 = (v) => Math.round(v * 10) / 10;

const web = await serveExport(WEB);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });

async function open(kind, theme, hub) {
  const phone = kind === 'phone';
  const ctx = await browser.newContext(phone
    ? { viewport: { width: 390, height: 844 }, userAgent: ANDROID_UA, hasTouch: true, colorScheme: theme, deviceScaleFactor: 2, locale: 'zh-CN' }
    : { viewport: { width: 1280, height: 800 }, colorScheme: theme, deviceScaleFactor: 1, locale: 'zh-CN' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).split('\n')[0]));
  await page.addInitScript(initScript, { theme });
  await page.addInitScript(fixture, { hub });
  await page.addInitScript(() => { try { localStorage.setItem('anet.language.v1', 'zh'); } catch {} });
  await page.goto(`${web.url}?safeAreaSim=${phone ? '32,0,24,0' : '0,0,0,0'}`);
  return { ctx, page, errors };
}
const tabCount = async (page) => {
  const n = page.locator(tid('conversation-tab-unread-count'));
  return (await n.count()) ? Number((await n.innerText()).trim()) || 0 : 0;
};

// ── desktop ──
const desktopUnread = {};
for (const [theme, hub] of [['light', 'new'], ['light', '93'], ['light', 'old'], ['dark', 'new']]) {
  const where = `desktop/${theme}${hub === 'old' ? '/old-hub' : hub === '93' ? '/hub93' : ''}`;
  const { ctx, page, errors } = await open('desktop', theme, hub);
  const shot = async (n) => { if (OUT) await page.screenshot({ path: `${OUT}/desktop-${theme}${hub === 'old' ? '-oldhub' : hub === '93' ? '-hub93' : ''}-${n}.png` }); };
  const step = async (what, fn) => { try { await fn(); } catch (e) { record(where, what, { ran: false }, { error: String(e).split('\n')[0] }); await shot(`FAIL-${what}`); } };
  await step('list', async () => {
    await page.locator(tid('desktop-rail')).waitFor({ timeout: 20000 });
    await page.locator(tid('people-section')).waitFor({ timeout: 15000 });
    await page.waitForTimeout(800);
    if (hub !== '93') desktopUnread[hub] = await tabCount(page);
    if (hub === 'old') {
      await shot('1-list');
      record(where, 'old Hub: no 群聊 section', { absent: !(await has(page, 'groups-section')) }, { unreadTab: desktopUnread.old });
      return;
    }
    const groups = await box(page, tid('groups-section'));
    const people = await box(page, tid('people-section'));
    const order = await page.locator('[data-testid^="group-row-"]').evaluateAll(els => els.map(e => e.getAttribute('data-testid')));
    const badge = (await page.locator(tid('group-unread-g_rd')).innerText().catch(() => '')).trim();
    const subRd = (await page.locator(tid('group-subtitle-g_rd')).innerText()).trim();
    const subSales = (await page.locator(tid('group-subtitle-g_sales')).innerText()).trim();
    const probed = (await calls(page)).some(c => c.path.endsWith('/chat-groups') && c.method === 'GET');
    await shot('1-list');
    record(where, '群聊 above 人员, sorted by last message, unread badge', {
      above: !!groups && !!people && groups.y + groups.height <= people.y + 0.5 && Math.abs(groups.x - people.x) <= 0.5,
      order: order.join() === 'group-row-g_rd,group-row-g_sales',
      badge: badge === '2',
    }, { order: order.join(), badge });
    record(where, hub === 'new' ? 'previews from last_message (text / [附件] N)' : '.93 Hub (no last_message): rows show the time', hub === 'new'
      ? { rd: subRd === 'Carol: 示例:我也来旁听', sales: subSales === 'Carol: [附件] 2' }
      : { rdTime: /^\d{1,2}:\d\d$/.test(subRd), salesTime: /^\d{1,2}:\d\d$/.test(subSales) }, { subRd, subSales });
    // 功能门:列表已经从 group_threads 知道这个 Hub 有群,部门页不再探接口(/health 能力位 vs 试探的取舍在
    // src/group-chat.test.ts 里用假 fetch 逐条测,这里不重复)。
    await page.locator(tid('manage-dept-entry')).click();
    await page.locator(tid('org-desktop')).waitFor({ timeout: 8000 });
    await page.locator(tid('dept-group-section')).waitFor({ timeout: 5000 });
    const probedAfter = (await calls(page)).some(c => c.path.endsWith('/chat-groups') && c.method === 'GET');
    record(where, 'gate: dept card shows without probing …/chat-groups (learnt from group_threads)', { noProbe: !probed && !probedAfter });
    await page.locator(tid('manage-dept-desktop-close')).click();
    await page.waitForTimeout(300);
  });
  if (hub !== 'old') {
    await step('chat', async () => {
      if (await has(page, 'manage-dept-desktop')) throw new Error('dept dialog still open');
      await page.locator(tid('group-row-g_rd')).click();
      await page.locator(tid('dm-pane')).waitFor({ timeout: 8000 });
      await page.locator(tid('dm-bubble')).first().waitFor({ timeout: 8000 });
      await page.waitForTimeout(800);
      const title = (await page.locator(tid('dm-header-title')).innerText()).trim();
      const subtitle = (await page.locator(tid('dm-header-subtitle')).innerText()).trim();
      const text = await page.locator(tid('dm-list')).innerText();
      const read = (await calls(page)).find(c => c.method === 'POST' && c.path.endsWith('/chat-groups/g_rd/read'));
      const badgeGone = !(await has(page, 'group-unread-g_rd')) || (await page.locator(tid('group-unread-g_rd')).innerText()).trim() === '';
      record(where, 'group chat pane: header, senders, mark read on view, badge cleared', {
        title: title === '研发部', subtitle: subtitle === '群聊 · 3 人', senders: text.includes('Alice') && text.includes('Carol'), read: !!read && read.body?.seq === 3, badgeGone,
      }, { title, subtitle, read: read && JSON.stringify(read.body) });
      await page.locator(tid('dm-input')).fill('示例:好的');
      await page.locator(tid('dm-desktop-send')).click();
      await page.waitForTimeout(800);
      const sent = (await calls(page)).find(c => c.method === 'POST' && c.path.endsWith('/chat-groups/g_rd/messages'));
      // 输入卡片:左右 / 底边距对称;发送按钮和 ＋ 在工具栏里竖直居中对齐。
      const pane = await box(page, tid('dm-pane'));
      const card = await box(page, tid('dm-desktop-composer'));
      const plus = await box(page, tid('dm-desktop-plus'));
      const send = await box(page, tid('dm-desktop-send'));
      const left = card.x - pane.x, right = pane.x + pane.width - (card.x + card.width), bottom = pane.y + pane.height - (card.y + card.height);
      const dCenter = Math.abs((plus.y + plus.height / 2) - (send.y + send.height / 2));
      measurements.push({ where, surface: 'desktop composer card', left: r1(left), right: r1(right), bottom: r1(bottom), cardH: r1(card.height), plusSendCenterDelta: r1(dCenter) });
      await shot('2-chat');
      record(where, 'send: POST { message, client_request_id }; composer card aligned', {
        sent: !!sent && sent.body?.message === '示例:好的' && /^dmc_/.test(sent.body?.client_request_id ?? '') && !('to_user_id' in (sent.body ?? {})),
        bubble: (await page.locator(tid('dm-list')).innerText()).includes('示例:好的'),
        symmetric: Math.abs(left - right) <= 1, bottomEqSides: Math.abs(bottom - left) <= 1, centered: dCenter <= 1,
      }, { left: r1(left), right: r1(right), bottom: r1(bottom), dCenter: r1(dCenter) });
      // viewer_can.post = false(new Hub 的销售部)→ 没有输入栏;.93 没有 viewer_can → 照常有。
      await page.locator(tid('group-row-g_sales')).click();
      await page.waitForTimeout(1200);
      const readOnly = await has(page, 'group-readonly');
      const composer = await has(page, 'dm-desktop-composer');
      if (hub === 'new') await shot('2b-readonly');
      record(where, hub === 'new' ? 'viewer_can.post=false hides the input bar' : 'no viewer_can (.93) → input bar stays', hub === 'new' ? { readOnly, noComposer: !composer } : { composer, noReadOnly: !readOnly });
    });
  }
  if (theme === 'light') {
    await step('dept', async () => {
      if (!(await has(page, 'manage-dept-desktop'))) await page.locator(tid('manage-dept-entry')).click();
      await page.locator(tid('org-desktop')).waitFor({ timeout: 8000 });
      await page.waitForTimeout(800);
      if (hub === 'old') {
        await shot('3-dept');
        record(where, 'old Hub: no 部门群 card', { absent: !(await has(page, 'dept-group-section')) });
        return;
      }
      await page.locator(tid('dept-group-detail')).waitFor({ timeout: 5000 });
      const src = async (u) => (await page.locator(tid(`dept-group-source-${u}`)).innerText()).trim();
      const removeOnManual = await has(page, 'dept-group-remove-carol');
      const noRemoveOnDept = !(await has(page, 'dept-group-remove-alice')) && !(await has(page, 'dept-group-remove-tester'));
      await shot('3-dept-group');
      record(where, 'dept group card: members with 部门 / 手动, remove only on manual, rename / add', {
        alice: (await src('alice')) === '部门', carol: (await src('carol')) === '手动', removeOnManual, noRemoveOnDept,
        rename: await has(page, 'dept-group-rename'), add: await has(page, 'dept-group-add'),
        names: (await page.locator(tid('dept-group-members')).innerText()).includes('Carol'),
      });
      await page.locator(tid('dept-group-add')).click();
      await page.locator(tid('dept-group-add-bob')).click();
      await page.waitForTimeout(600);
      const added = (await calls(page)).find(c => c.method === 'POST' && c.path.endsWith('/chat-groups/g_rd/members'));
      record(where, 'add member ⇒ POST { user_id }, shows as 手动', { body: added?.body?.user_id === 'u_b', manual: (await src('bob')) === '手动' });
      await page.locator(tid('org-tree-d_fe')).click();
      await page.locator(tid('dept-group-create')).waitFor({ timeout: 5000 });
      await shot('4-dept-create');
      await page.locator(tid('dept-group-create')).click();
      await page.locator(tid('dept-group-detail')).waitFor({ timeout: 5000 });
      const created = (await calls(page)).find(c => c.method === 'POST' && c.path.endsWith('/departments/d_fe/group'));
      record(where, '创建部门群 ⇒ POST …/departments/d_fe/group, then the card shows it', { post: !!created, name: (await page.locator(tid('dept-group-name')).innerText()).trim() === '前端' });
    });
  }
  record(where, 'page errors', { none: errors.length === 0 }, errors.length ? { errors: errors.slice(0, 3) } : {});
  await ctx.close();
}
record('desktop', '「未读 N」counts the unread group (new Hub = old Hub + 1)', { plusOne: desktopUnread.new === (desktopUnread.old ?? -9) + 1 }, { old: desktopUnread.old, new: desktopUnread.new });

// ── phone ──
for (const [theme, hub] of [['light', 'new'], ['light', 'old'], ['dark', 'new']]) {
  const where = `phone/${theme}${hub === 'old' ? '/old-hub' : ''}`;
  const { ctx, page, errors } = await open('phone', theme, hub);
  const shot = async (n) => { if (OUT) await page.screenshot({ path: `${OUT}/phone-${theme}${hub === 'old' ? '-oldhub' : ''}-${n}.png` }); };
  const step = async (what, fn) => { try { await fn(); } catch (e) { record(where, what, { ran: false }, { error: String(e).split('\n')[0] }); await shot(`FAIL-${what}`); } };
  await step('list', async () => {
    await page.locator(tid('people-section')).waitFor({ timeout: 20000 });
    await page.waitForTimeout(800);
    await shot('1-list');
    if (hub === 'old') { record(where, 'old Hub: no 群聊 section', { absent: !(await has(page, 'groups-section')) }); return; }
    const groups = await box(page, tid('groups-section'));
    const people = await box(page, tid('people-section'));
    const subRd = (await page.locator(tid('group-subtitle-g_rd')).innerText()).trim();
    const time = await has(page, 'group-time-g_rd');
    record(where, '群聊 above 人员; preview + time on the row (WeChat)', { above: !!groups && !!people && groups.y + groups.height <= people.y + 0.5, preview: subRd === 'Carol: 示例:我也来旁听', time }, { subRd });
  });
  if (hub !== 'old') {
    await step('chat', async () => {
      await page.locator(tid('group-row-g_rd')).tap();
      await page.locator(tid('dm-pane')).waitFor({ timeout: 8000 });
      await page.locator(tid('dm-bubble')).first().waitFor({ timeout: 8000 });
      await page.waitForTimeout(800);
      const back = await has(page, 'dm-header-back');
      const noList = !(await page.locator(tid('groups-section')).isVisible().catch(() => false));
      const rowB = await box(page, tid('dm-input-row'));
      const input = await box(page, tid('dm-input'));
      const slot = await box(page, tid('composer-right-slot'));
      const plus = await box(page, tid('composer-plus'));
      const leftPad = input.x - rowB.x, rightPad = rowB.x + rowB.width - (slot.x + slot.width);
      const dCenter = Math.abs((input.y + input.height / 2) - (plus.y + plus.height / 2));
      measurements.push({ where, surface: 'phone input row', leftPad: r1(leftPad), rightPad: r1(rightPad), inputH: r1(input.height), plusH: r1(plus.height), inputPlusCenterDelta: r1(dCenter) });
      await shot('2-chat');
      record(where, 'phone: pushed full-screen group chat with back; input row aligned', {
        back, noList, title: (await page.locator(tid('dm-header-title')).innerText()).trim() === '研发部',
        centered: dCenter <= 1, symmetric: Math.abs(leftPad - rightPad) <= 1,
      }, { leftPad: r1(leftPad), rightPad: r1(rightPad), dCenter: r1(dCenter) });
      await page.locator(tid('dm-header-back')).tap();
      await page.locator(tid('people-section')).waitFor({ timeout: 5000 });
    });
  }
  if (theme === 'light') {
    await step('dept', async () => {
      await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'settings' }));
      await page.locator(tid('settings-row-manageDepartment')).tap();
      await page.locator(tid('org-phone')).waitFor({ timeout: 8000 });
      await page.waitForTimeout(800);
      if (hub === 'old') { await shot('3-dept'); record(where, 'old Hub: no 部门群 entry', { absent: !(await has(page, 'org-group-entry')) }); return; }
      await page.locator(tid('org-group-entry')).tap();
      await page.locator(tid('dept-group-detail')).waitFor({ timeout: 5000 });
      await page.waitForTimeout(300);
      await shot('3-dept-group');
      record(where, 'phone: 部门群 page with sources and manage buttons', {
        title: (await page.locator(tid('org-title')).innerText()).trim() === '部门群',
        sources: (await page.locator(tid('dept-group-source-alice')).innerText()).trim() === '部门' && (await page.locator(tid('dept-group-source-carol')).innerText()).trim() === '手动',
        rename: await has(page, 'dept-group-rename'), add: await has(page, 'dept-group-add'),
      });
      await page.locator(tid('dept-group-rename')).tap();
      await page.locator(tid('dept-group-name-input')).fill('研发部大群');
      await page.locator(tid('dept-group-rename-save')).tap();
      await page.waitForTimeout(600);
      const patch = (await calls(page)).find(c => c.method === 'PATCH');
      record(where, 'rename ⇒ PATCH { name }', { body: patch?.body?.name === '研发部大群', shown: (await page.locator(tid('dept-group-name')).innerText()).trim() === '研发部大群' });
    });
  }
  record(where, 'page errors', { none: errors.length === 0 }, errors.length ? { errors: errors.slice(0, 3) } : {});
  await ctx.close();
}

await browser.close();
web.close();
console.log('\nmeasurements:');
for (const m of measurements) console.log(JSON.stringify(m));
if (OUT) writeFileSync(`${OUT}/measurements.json`, JSON.stringify(measurements, null, 2));
console.log(failures ? `\n${failures}/${rows} rows failed` : `\nall ${rows} rows passed`);
process.exit(failures || rows === 0 ? 1 : 0);
