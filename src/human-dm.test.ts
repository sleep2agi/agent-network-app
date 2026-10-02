// 人与人私信(hub agent-network#2086)—— 客户端纯逻辑 + 接线。ck 风格,自执行。
import { readFileSync } from 'node:fs';
import {
  dmAttachments, dmSendBody, dmUnreadTotal, isHumanDmNotice, isImageAttachment, mergeDm, newClientRequestId,
  PEOPLE_GROUP_KEY, peopleRows, shownPeople, stripHumanDms, unackedIncomingIds, type DmMessage,
} from './human-dm';
import { pinyinMatch } from './lib/pinyin';
import { parseCollapsed, toggleCollapsed } from './agents-list';
import { agentUnreadCounts, latestMessageAtByAgent } from './agent-unread-counts';
import { proactiveItemsForAgent } from './proactive-messages';
import { initialUnreadState } from './unread-ledger';
import { canAddAdminsIn, manageableNetworks, type AuthMe } from './user-admin';

let p = 0, n = 0;
const ck = (name: string, ok: boolean) => { n++; if (ok) { p++; console.log(`  ✓ ${name}`); } else console.log(`  ✗ ${name}`); };

// —— 人员列表 ——
{
  const humans = [
    { user_id: 'u_me', username: 'me' },
    { user_id: 'u_b', username: 'bob', display_name: 'Bob' },
    { user_id: 'u_c', username: 'carol', display_name: '' },
    { user_id: 'u_d', username: 'dave' },
  ];
  const threads = [
    { other_user_id: 'u_c', last_at: '2026-09-29 08:00:00.100', unread: 0 },
    { other_user_id: 'u_d', last_at: '2026-09-29 07:00:00', unread: 2 },
  ];
  const rows = peopleRows(humans, threads, 'u_me');
  ck('不含自己', !rows.some(r => r.user_id === 'u_me'));
  ck('有未读的在最前,然后按最近一条,再按名字', rows.map(r => r.username).join(',') === 'dave,carol,bob');
  ck('显示名为空 → 用户名', rows.find(r => r.username === 'carol')!.name === 'carol' && rows.find(r => r.username === 'bob')!.name === 'Bob');
  ck('未读数来自 threads', rows.find(r => r.username === 'dave')!.unread === 2 && dmUnreadTotal(rows) === 2);
  ck('只有自己一个人 → 空(区块不出现)', peopleRows([{ user_id: 'u_me', username: 'me' }], [], 'u_me').length === 0);
  ck('还不知道自己是谁 → 不过滤(调用方要等 selfUserId 到了再算)', peopleRows(humans, [], undefined).length === 4);
}

// —— 会话消息 ——
{
  const a: DmMessage = { message_id: 'm1', content: 'hi', direction: 'out', created_at: '2026-09-29 08:00:00.100' };
  const b: DmMessage = { message_id: 'm2', content: 'yo', direction: 'in', created_at: '2026-09-29 08:00:00.200', acked: 0 };
  const merged = mergeDm([a], [b, { ...a, content: 'hi!' }]);
  ck('合并去重、后到的覆盖', merged.length === 2 && merged.find(m => m.message_id === 'm1')!.content === 'hi!');
  ck('新的在前(毫秒级 created_at 也排得出)', merged[0].message_id === 'm2');
  ck('打开即读只 ack 对方发来、未读的', JSON.stringify(unackedIncomingIds(merged)) === '["m2"]');
  ck('自己发的、乐观中的不 ack', unackedIncomingIds([{ message_id: 'x', direction: 'in', pending: true }, { message_id: 'y', direction: 'out' }]).length === 0);
  const withAtt: DmMessage = { message_id: 'm3', direction: 'in', meta_json: JSON.stringify({ attachments: [{ type: 'file', file_id: 'f123456789', name: 'a.png', mime: 'image/png' }, { nope: 1 }] }) };
  ck('附件从 meta_json 取,坏项丢掉', dmAttachments(withAtt).length === 1 && isImageAttachment(dmAttachments(withAtt)[0]));
  ck('坏 meta_json 不抛', dmAttachments({ meta_json: '{oops' }).length === 0);
  const body = dmSendBody({ networkId: 'net', toUserId: 'u_b', message: 'hello', attachments: [{ file_id: 'f1', name: 'x.pdf', mime: 'application/pdf' }], clientRequestId: 'dmc_1' });
  ck('发送体:to_user_id / 附件 / client_request_id', body.to_user_id === 'u_b' && body.attachments?.[0].file_id === 'f1' && body.attachments?.[0].type === 'file' && body.client_request_id === 'dmc_1' && body.network_id === 'net');
  ck('没附件不带 attachments 键', !('attachments' in dmSendBody({ networkId: 'n', toUserId: 'u', message: 'm', clientRequestId: 'c' })));
  ck('client_request_id 每次不同', newClientRequestId(1, 0.1) !== newClientRequestId(1, 0.2));
  ck('SSE 私信判定', isHumanDmNotice({ kind: 'human_dm' }) && !isHumanDmNotice({ kind: 'agent_message' }) && !isHumanDmNotice(null));
}

// —— 私信不能变成幽灵 agent ——
{
  const body = {
    ok: true,
    messages: [
      { message_id: 'dm1', from_session: 'alice', kind: 'human_dm', content: 'hi', acked: 0, created_at: '2026-09-29 08:00:00' },
      { message_id: 'a1', from_session: 'agent-x', kind: 'agent_message', content: 'report', acked: 0, created_at: '2026-09-29 07:00:00' },
    ],
    unread: 2,
    pending_count: 2,
    unread_by_agent: { alice: 1, 'agent-x': 1, carol: 3 },
    unread_total: 5,
  };
  const s = stripHumanDms(body, new Set(['carol']));
  ck('messages 里去掉 human_dm 行', s.messages.length === 1 && s.messages[0].message_id === 'a1');
  ck('unread_by_agent 去掉本页私信发信人 + 已知人类', JSON.stringify(s.unread_by_agent) === '{"agent-x":1}');
  ck('unread_total 减掉被去掉的', s.unread_total === 1);
  ck('unread / pending_count 相应减掉,不为负', s.unread === 0 && s.pending_count === 0);
  ck('原对象不被改', body.messages.length === 2 && body.unread_by_agent.alice === 1);
  const old = { messages: [{ message_id: 'a1', from_session: 'agent-x' }], unread: 1 };
  ck('旧 hub(没有私信)→ 原样返回同一个对象', stripHumanDms(old, new Set()) === old);
  // 下游:角标 / 新消息分组 / 主动消息都拿到干净的 body
  const snap = { serverBody: s, ledger: initialUnreadState(), replyRows: [], replyUsername: 'me', replyWatermarks: {} } as any;
  const counts = agentUnreadCounts(snap);
  ck('角标里没有人名', !('alice' in counts) && !('carol' in counts) && counts['agent-x'] === 1);
  ck('「新消息」分组的时间里没有人名', !('alice' in latestMessageAtByAgent(snap)));
  ck('agent 会话的主动消息里没有私信', proactiveItemsForAgent(s.messages as any, 'alice').length === 0);
  const raw = agentUnreadCounts({ ...snap, serverBody: body });
  ck('反证:不剥的话 alice 会变成一个 agent 角标', raw.alice === 1);
}

// —— 新建用户:网络可选 ——
{
  const me: AuthMe = { user: { role: 'user' }, networks: [
    { network_id: 'n_own', network_name: 'mine', member_role: 'owner' },
    { network_id: 'n_team', network_name: 'team', member_role: 'admin' },
    { network_id: 'n_other', network_name: 'other', member_role: 'member' },
  ] };
  const choices = manageableNetworks(me, 'n_team');
  ck('只列我是 owner / admin 的网络', choices.map(c => c.network_id).sort().join(',') === 'n_own,n_team');
  ck('当前网络排第一', choices[0].network_id === 'n_team');
  const admin: AuthMe = { user: { role: 'admin' }, networks: [{ network_id: 'n_own', member_role: 'owner' }] };
  const all = manageableNetworks(admin, 'n_own', [{ network_id: 'n_x', network_name: 'x', name: 'X' }, { network_id: 'n_own', network_name: 'own' }]);
  ck('Hub 管理员 = GET /api/networks 的全部', all.length === 2 && all[0].network_id === 'n_own' && all[1].name === 'X');
  ck('Hub 管理员但 /api/networks 没取到 → 退回自己管的', manageableNetworks(admin, 'n_own', null).length === 1);
  ck('admin 角色:owner 网络能建管理员,admin 网络不能', canAddAdminsIn(me, 'n_own') && !canAddAdminsIn(me, 'n_team'));
}

// —— 接线 ——
{
  const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
  const api = read('./api.ts');
  ck('唯一取数口剥掉私信', api.includes('.then(body => stripHumanDms(body))') || api.includes('.then(body => stripSystemNotices(stripHumanDms(body)))'));
  const listener = read('./DesktopMessageListener.tsx');
  ck('SSE 私信通知人员列表与会话', listener.includes('isHumanDmNotice(result.notice)') && listener.includes('emitHumanDm('));
  const agents = read('./AgentsScreen.tsx');
  ck('人员区块:/humans + /dm/threads,记录人类用户名', agents.includes('fetchHumans(cfg, cfg.networkId)') && agents.includes('fetchConversationThreads(') && agents.includes('noteHumanUsernames('));
  const dm = read('./DmChatScreen.tsx');
  ck('会话:读 /api/dm、ack、上传后发', dm.includes('fetchDmMessages(') && dm.includes('ackUserMessages(cfg, ids)') && dm.includes("uploadImage(cfg, prepared, { networkId, purpose: 'dm' })") && dm.includes('sendDm('));
  const app = read('../App.tsx');
  ck('三种布局都能打开私信', (app.match(/<DmChatScreen [^\n]*peer=\{dmPeerOf\(screen\)\}/g) || []).length === 3 && (app.match(/onOpenPerson=\{p => setScreen\(dmScreenFor\(p\)\)\}/g) || []).length === 3);
  const panel = read('./UserManagementPanel.tsx');
  ck('新建用户:网络可选并按所选网络提交', panel.includes('manageableNetworks(me, networkId, allNetworks)') && panel.includes('network_id: targetNet'));
}

// —— 人员区块在列表最上面(Vincent 2026-09-30「这个人员放太下面了」)——
{
  const rows = peopleRows([
    { user_id: 'u_a', username: 'chuqi' }, { user_id: 'u_b', username: 'chengshi' }, { user_id: 'u_c', username: 'vansin', display_name: '张三' },
  ], [], 'u_me');
  const all = shownPeople(rows, '', [], pinyinMatch);
  ck('人员:不搜索时全部显示,可折叠,标题人数 = 全部', all.visible && all.rows.length === 3 && all.total === 3 && all.collapsible && !all.collapsed);
  const folded = shownPeople(rows, '', [PEOPLE_GROUP_KEY], pinyinMatch);
  ck('人员:折叠后只剩标题(人数照旧)', folded.visible && folded.rows.length === 0 && folded.total === 3 && folded.collapsed);
  ck('人员:折叠状态与 agent 分组同存、可来回切', toggleCollapsed(toggleCollapsed([], PEOPLE_GROUP_KEY), PEOPLE_GROUP_KEY).length === 0 && parseCollapsed(JSON.stringify([PEOPLE_GROUP_KEY, '群星'])).includes(PEOPLE_GROUP_KEY));
  ck('人员:折叠键不会和分组名撞上(不可见字符开头)', PEOPLE_GROUP_KEY.charCodeAt(0) === 0);
  const hit = shownPeople(rows, 'cheng', [PEOPLE_GROUP_KEY], pinyinMatch);
  ck('人员:搜索按用户名过滤,且搜索时无视折叠、不可折叠', hit.rows.map(r => r.username).join() === 'chengshi' && !hit.collapsible && hit.total === 1);
  ck('人员:搜索支持显示名 + 拼音(zs → 张三)', shownPeople(rows, 'zs', [], pinyinMatch).rows.map(r => r.user_id).join() === 'u_c');
  ck('人员:搜不到 → 整块不画', !shownPeople(rows, 'zzzz', [], pinyinMatch).visible);
  ck('人员:没有人 → 整块不画', !shownPeople([], '', [], pinyinMatch).visible);

  const agents = readFileSync(new URL('./AgentsScreen.tsx', import.meta.url), 'utf8');
  // 列表头里人员前面可能还有「管理本部门」入口(#485,只给部门负责人)和群聊区块(RFC-042),条件因此是 `groupsVisible || peopleShown.visible || …`。
  const header = agents.indexOf('ListHeaderComponent={groupsVisible || peopleShown.visible');
  const footer = agents.indexOf('ListFooterComponent={');
  ck('顺序:人员在 ListHeaderComponent(列表最上面、分组之前)', header > 0 && agents.indexOf('testID="people-section"') > header && agents.indexOf('testID="people-section"') < footer);
  ck('顺序:footer 里不再有人员', !agents.slice(footer).includes('people-section') && !agents.slice(footer).includes('renderPersonRow'));
  ck('人员标题可折叠(与分组同一个 toggleGroup,键 PEOPLE_GROUP_KEY)', agents.includes('onPress={() => toggleGroup(PEOPLE_GROUP_KEY)}'));
  ck('人员随搜索框过滤(同一个 pinyinMatch)', agents.includes('shownPeople(onOpenPerson ? applyConversationTabToPeople(people, effectiveTab, selectedPerson) : [], query, collapsed, pinyinMatch)'));
  ck('更紧凑对齐:人员展开时第一行 = 第一个人(按部门分组时加上第一个部门小标题)', agents.includes('publishListFirstRowTop(top + peopleHeaderHRef.current + (peopleGroups ? peopleGroupHeadHRef.current ?? 0 : 0))') && agents.includes('const top = listYRef.current + groupsOffset;'));
}

console.log(`\n${p}/${n} passed`);
if (p !== n) process.exit(1);
