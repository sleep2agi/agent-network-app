// 部门群 / 群聊(RFC-042,看板 #457 第 4 步)—— 功能门、未读合并、列表排序、按权限出按钮、事件、接线。ck 风格,自执行。
import { readFileSync } from 'node:fs';
import {
  addableMembers, applyConversationTabToGroups, applyGroupEvent, canManageDeptGroup, canRemoveMember, conversationUnreadTotal,
  groupErrorText, groupMemberRows, groupRows, groupSendBody, groupThreadsOf, maxSeq, memberSourceLabel, parseGroupEvent, readTarget,
  senderOf, shownGroups, validGroupName,
} from './group-chat';
import { fetchConversationThreads, probeGroupSupport, resetGroupSupportForTest } from './group-chat-api';
import { unreadConversationCount } from './conversation-tab';
import { peopleRows } from './human-dm';

let p = 0, n = 0;
const ck = (name: string, ok: boolean) => { n++; if (ok) { p++; console.log(`  ✓ ${name}`); } else console.log(`  ✗ ${name}`); };

// —— 功能门:/api/dm/threads 有没有 group_threads ——
{
  ck('旧 Hub(没有 group_threads 键)→ null:群区块不画', groupThreadsOf({ ok: true, threads: [] }) === null);
  ck('group_threads 不是数组 → null', groupThreadsOf({ ok: true, threads: [], group_threads: {} }) === null && groupThreadsOf(null) === null && groupThreadsOf('x') === null);
  const empty = groupThreadsOf({ ok: true, threads: [], group_threads: [] });
  ck('有群功能、还不在任何群 → 空数组(不是 null)', Array.isArray(empty) && empty.length === 0);
  ck('坏项(没有 group_id)丢掉', groupThreadsOf({ group_threads: [{ name: 'x' }, null, { group_id: 'g1', name: '研发部' }] })!.length === 1);
}

// —— 功能门:探 GET …/chat-groups(假 fetch,不连任何 Hub)——
async function gateChecks() {
  const cfg = { serverUrl: 'http://hub.invalid', token: 'utok_placeholder', networkId: 'net1' } as any;
  const realFetch = globalThis.fetch;
  const calls: string[] = [];
  const respond = (status: number, body: unknown) => async (url: any) => { calls.push(String(url)); return new Response(body === undefined ? '' : JSON.stringify(body), { status }); };
  try {
    resetGroupSupportForTest();
    globalThis.fetch = respond(404, { ok: false, error: 'not found' }) as any;
    ck('404(旧 Hub)→ 没有群', (await probeGroupSupport(cfg, 'net1')) === false);
    const before = calls.length;
    ck('404 的结论被记住,不再探', (await probeGroupSupport(cfg, 'net1')) === false && calls.length === before);
    ck('探的是 …/chat-groups', calls[0]?.endsWith('/api/networks/net1/chat-groups'));
    resetGroupSupportForTest();
    globalThis.fetch = respond(405, { ok: false, error: 'method_not_allowed' }) as any;
    ck('405 → 没有群', (await probeGroupSupport(cfg, 'net1')) === false);
    resetGroupSupportForTest();
    globalThis.fetch = respond(500, { ok: false, error: 'boom' }) as any;
    ck('5xx → 先当没有(不画、不报错)', (await probeGroupSupport(cfg, 'net1')) === false);
    globalThis.fetch = respond(200, { ok: true, groups: [] }) as any;
    ck('5xx 不缓存:下次再探,2xx → 有群', (await probeGroupSupport(cfg, 'net1')) === true);
    resetGroupSupportForTest();
    globalThis.fetch = respond(200, { ok: true }) as any;
    ck('2xx 但没有 groups 数组 → 不算有', (await probeGroupSupport(cfg, 'net1')) === false);
    resetGroupSupportForTest();
    globalThis.fetch = respond(200, { ok: true, threads: [{ other_user_id: 'u_b', unread: 1 }], group_threads: [{ group_id: 'g1', name: '研发部', unread: 2 }] }) as any;
    const conv = await fetchConversationThreads(cfg, 'net1');
    ck('threads 一次拿私信和群', conv.threads.length === 1 && conv.groupThreads?.length === 1);
    const probes = calls.length;
    ck('看到 group_threads 就记下「有群」,部门页不必再探', (await probeGroupSupport(cfg, 'net1')) === true && calls.length === probes);
    globalThis.fetch = respond(200, { ok: true, threads: [] }) as any;
    ck('旧 Hub 的 threads → groupThreads = null', (await fetchConversationThreads(cfg, 'net2')).groupThreads === null);
  } finally {
    globalThis.fetch = realFetch;
    resetGroupSupportForTest();
  }
}

// —— 列表排序 + 未读合并 ——
{
  const rows = groupRows([
    { group_id: 'g_a', name: '前端组', last_at: '2026-10-03 08:00:00.100', unread: 0 },
    { group_id: 'g_b', name: '研发部', last_at: '2026-10-03 09:00:00.000', unread: 3 },
    { group_id: 'g_c', name: '销售部', last_at: null, unread: 0 },
    { group_id: 'g_d', name: '', last_at: '2026-10-03 08:00:00.200', unread: '2' as any },
  ]);
  ck('按最后一条时间倒序,没消息的最后(毫秒级也排得出)', rows.map(r => r.group_id).join() === 'g_b,g_d,g_a,g_c');
  ck('没有群名 → 用 group_id(不是空行)', rows.find(r => r.group_id === 'g_d')!.name === 'g_d');
  ck('未读数规整成非负整数', rows.find(r => r.group_id === 'g_d')!.unread === 2 && groupRows([{ group_id: 'x', name: 'x', unread: -4 }])[0].unread === 0);
  ck('null / undefined → 空', groupRows(null).length === 0 && groupRows(undefined).length === 0);
  const people = peopleRows([{ user_id: 'u_me', username: 'me' }, { user_id: 'u_b', username: 'alice' }, { user_id: 'u_c', username: 'bob' }],
    [{ other_user_id: 'u_b', unread: 2 }, { other_user_id: 'u_c', unread: 1 }], 'u_me');
  ck('总未读 = 私信未读 + 群未读(按条数)', conversationUnreadTotal(people, rows) === 2 + 1 + 3 + 2);
  ck('没有群 → 只有私信', conversationUnreadTotal(people, []) === 3);
  ck('「未读 N」:群也算会话(有未读的群各算 1 个)', unreadConversationCount([], { counts: {} }, [...people, ...rows]) === 2 + 2);
  ck('未读视图:只留有未读的群 + 正打开的那个', applyConversationTabToGroups(rows, 'unread', 'g_c').map(r => r.group_id).join() === 'g_b,g_d,g_c');
  ck('「全部」原样(同一个数组)', applyConversationTabToGroups(rows, 'all') === rows);
  ck('搜索按群名(匹配器由调用方给)', shownGroups(rows, '研发', (t, q) => t.includes(q)).map(r => r.group_id).join() === 'g_b' && shownGroups(rows, ' ', () => false).length === 4);
}

// —— 实时事件 ——
{
  const ev = parseGroupEvent({ type: 'group_message', group_id: 'g_a', group_name: '前端组', message_id: 'gm_1', seq: 7, from: 'alice', from_user_id: 'u_b', created_at: '2026-10-03 10:00:00.000', unread: 4 });
  ck('group_message 解析', ev?.type === 'group_message' && ev.seq === 7 && ev.unread === 4 && ev.from === 'alice');
  ck('group_read 解析', parseGroupEvent({ type: 'group_read', group_id: 'g_a', last_read_seq: 7, unread: 0 })?.type === 'group_read');
  ck('别的类型 / 缺 group_id / 缺 message_id → null', parseGroupEvent({ type: 'desktop_message', group_id: 'g' }) === null && parseGroupEvent({ type: 'group_message', message_id: 'm' }) === null && parseGroupEvent({ type: 'group_message', group_id: 'g' }) === null && parseGroupEvent(null) === null);
  const rows = groupRows([
    { group_id: 'g_a', name: '前端组', last_at: '2026-10-03 08:00:00', unread: 0 },
    { group_id: 'g_b', name: '研发部', last_at: '2026-10-03 09:00:00', unread: 1 },
  ]);
  const next = applyGroupEvent(rows, ev!)!;
  ck('新消息:用 Hub 给的我的未读数,并按时间顶到最前', next[0].group_id === 'g_a' && next[0].unread === 4);
  const read = applyGroupEvent(next, { type: 'group_read', group_id: 'g_a', last_read_seq: 7, unread: 0 })!;
  ck('已读事件(别的设备读了)→ 角标清掉,顺序不变', read[0].group_id === 'g_a' && read[0].unread === 0);
  ck('列表里没有的群来了消息 → null(调用方整表重拉)', applyGroupEvent(rows, { ...ev!, group_id: 'g_new' }) === null);
  ck('没有的群的已读事件 → 原样', applyGroupEvent(rows, { type: 'group_read', group_id: 'g_new', last_read_seq: 1, unread: 0 }) === rows);
  ck('没变化 → 同一个数组(不触发重画)', applyGroupEvent(read, { type: 'group_read', group_id: 'g_a', last_read_seq: 7, unread: 0 }) === read);
}

// —— 群聊页:已读 / 发送体 / 发信人 ——
{
  ck('maxSeq 不算本地乐观那条', maxSeq([{ seq: 3 }, { seq: 9 }, {}]) === 9 && maxSeq([]) === 0);
  ck('有更新的才标已读,只前进', readTarget([{ seq: 5 }], 0) === 5 && readTarget([{ seq: 5 }], 5) === null && readTarget([{ seq: 4 }], 5) === null);
  const body = groupSendBody({ message: 'hi', attachments: [{ file_id: 'f1', name: 'a.png', mime: 'image/png', size: 10 }], clientRequestId: 'dmc_1' });
  ck('发送体:message / 附件 / client_request_id(没有 to_user_id、network_id)', body.message === 'hi' && body.attachments?.[0].type === 'file' && body.client_request_id === 'dmc_1' && !('to_user_id' in body) && !('network_id' in body));
  ck('没附件不带 attachments 键', !('attachments' in groupSendBody({ message: 'm', clientRequestId: 'c' })));
  const ppl = [{ user_id: 'u_b', username: 'alice', display_name: 'Alice' }];
  ck('发信人:按 user_id 找显示名', senderOf({ sender_user_id: 'u_b', from_session: 'alice' }, ppl).name === 'Alice');
  ck('人员表里没有 → 用消息里的用户名', senderOf({ sender_user_id: 'u_x', from_session: 'carol' }, ppl).name === 'carol');
}

// —— 部门页:按权限出按钮 ——
{
  ck('owner / admin(非负责人模式)→ 能管任何部门的群', canManageDeptGroup(null, 'd_rd'));
  const managed = new Set(['d_fe', 'd_fe1']);
  ck('负责人:本部门子树能管', canManageDeptGroup(managed, 'd_fe') && canManageDeptGroup(managed, 'd_fe1'));
  ck('负责人:子树以外不能管(按钮不出现)', !canManageDeptGroup(managed, 'd_rd') && !canManageDeptGroup(managed, 'd_sales'));
  ck('负责人:解除关联的群(无部门)只归管理员', !canManageDeptGroup(managed, null) && canManageDeptGroup(null, null));
  ck('不是负责人(managed 空)→ 什么都管不了', !canManageDeptGroup(new Set(), 'd_fe'));
  const g = { department_id: 'd_fe' };
  ck('部门来的人不能手动移出(Hub 409 department_member)', !canRemoveMember({ source: 'department' }, g));
  ck('手动拉的人能移出', canRemoveMember({ source: 'manual' }, g));
  ck('群已解除关联 → 部门来的也能移', canRemoveMember({ source: 'department' }, { department_id: null }));
  const rows = groupMemberRows(
    [{ user_id: 'u_z', source: 'manual' }, { user_id: 'u_b', source: 'department' }, { user_id: 'u_a', source: 'department' }, { user_id: 'u_gone', source: 'manual' }],
    g,
    [{ user_id: 'u_a', username: 'alice' }, { user_id: 'u_b', username: 'bob', display_name: 'Bob' }, { user_id: 'u_z', username: 'zed' }],
  );
  ck('成员:部门来的在前、手动在后,各自按名字', rows.map(r => r.username).join() === 'alice,bob,u_gone,zed');
  ck('来源标签:部门 / 手动', rows[0].sourceLabel === '部门' && rows[3].sourceLabel === '手动' && memberSourceLabel('weird') === '手动');
  ck('移出按钮只在手动行', rows.filter(r => r.removable).map(r => r.username).join() === 'u_gone,zed');
  ck('找不到的人显示 user_id(不是空行)', rows.find(r => r.user_id === 'u_gone')!.name === 'u_gone');
  ck('添加成员只列不在群里的人', addableMembers([{ user_id: 'u_a' }, { user_id: 'u_q' }], [{ user_id: 'u_a' }]).map(x => x.user_id).join() === 'u_q');
  ck('群名 1–40 字(按字符)', validGroupName(' 研发部 ') && !validGroupName('   ') && validGroupName('部'.repeat(40)) && !validGroupName('部'.repeat(41)));
  ck('错误码 → 人话', groupErrorText('department_member').includes('部门') && groupErrorText('group_manage_denied').includes('权限') && groupErrorText('x_unknown') === 'x_unknown');
}

// —— 接线(源码文本:这些屏 import react-native,这里不渲染)——
{
  const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
  const agents = read('./AgentsScreen.tsx');
  ck('会话列表:群区块只在 groups 非 null(Hub 给了 group_threads)时画', /const groupsVisible = !!groups && /.test(agents) && /\{groupsVisible \? \(/.test(agents));
  ck('会话列表:没传 onOpenGroup → 不取群', agents.includes('setGroups(onOpenGroup && conv.groupThreads ? groupRows(conv.groupThreads) : null)'));
  ck('「未读 N」把群一起算', agents.includes('[...(onOpenPerson ? people : []), ...(groups ?? [])]'));
  ck('实时事件就地改未读,不认识的群整表重拉', agents.includes('applyGroupEvent(rows, ev)') && agents.includes('if (missing) void loadPeople();'));
  const org = read('./OrgChart.tsx');
  ck('部门页(手机):入口要过功能门 + 权限', org.includes('{groupsOn && id && canManageDeptGroup(head?.managed ?? null, id) ? ('));
  ck('部门页(桌面):卡片要过功能门 + 权限', org.includes('{dept && groupsOn && canManageDeptGroup(head?.managed ?? null, dept.id) ? ('));
  const panel = read('./DeptGroupPanel.tsx');
  ck('面板:没群又管不了 → 不画', panel.includes("if (state.kind === 'none' && !canManage) return null;"));
  ck('面板:改名 / 添加成员 / 移出 都要 canManage', panel.includes("{canManage && mode === 'view' ? (") && panel.includes('{canManage && m.removable ? button('));
  ck('面板:手机 / 桌面两套(desktop 分支;手机页传 desktop={false},桌面卡片传 desktop)', panel.includes('if (desktop) {') && org.includes('people={people} desktop={false} />') && org.includes('people={people} desktop />'));
  const listener = read('./DesktopMessageListener.tsx');
  ck('SSE:group_message / group_read 进群总线,不弹顶部提示', /const groupEvent = parseGroupEvent\(raw\);\s*if \(groupEvent\) \{ emitGroupChat\(groupEvent\); return; \}/.test(listener));
  const chat = read('./DmChatScreen.tsx');
  ck('群聊复用私信页:发送走群接口、带 client_request_id', chat.includes('sendGroupMessage(cfg, networkId, groupId, groupSendBody({ message: text, attachments: uploaded, clientRequestId: clientId }))'));
  ck('群聊打开即读(只前进)', chat.includes('readTarget(rows, readMarked.current)') && chat.includes('markGroupRead(cfg, networkId, groupId, target)'));
  ck('群聊收到 group_message 才重拉', chat.includes("ev?.type === 'group_message' && ev.group_id === groupId"));
  const app = read('../App.tsx');
  ck('三种布局都接了群聊页(手机推入 / 双栏右侧 / 桌面右面板)', (app.match(/group=\{groupRefOf\(screen\)\}/g) ?? []).length === 3);
}

await gateChecks();
console.log(`\n${p}/${n} passed`);
process.exit(p === n ? 0 : 1);
