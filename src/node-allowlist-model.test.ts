import { setLanguagePreference } from './i18n';
import {
  ALWAYS_TOOLS, ANY_PERSON_ENTRY, PERMISSION_REASON_CODES, STRICT_ENTRY, allowlistErrorText, allowlistText, deptChoices, deptEntry, entryLabel, isAlwaysTool, isStrict,
  listHasNode, mergeDraft, nodeChoices, normalizeInbox, parseAllowlistInput, permissionReasonText, setStrict, toggleEntry, toggleNode,
  withoutAlwaysTools, withoutItem,
} from './node-allowlist-model';
let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log(`PASS: ${n}`); } else console.log(`FAIL: ${n}`); };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

setLanguagePreference('zh');
ck('null = 不限制(不是空名单)', allowlistText(null) === '不限制' && allowlistText(undefined) === '不限制');
// Hub 的合法取值只有 null 与非空数组：GET 永远不返回 []，PUT [] 会拿到 400 empty_allowlist_ambiguous。
ck('空数组按「不限制」显示(与 Hub 语义一致)', allowlistText([]) === '不限制');
ck('有内容时列出,可换显示名', allowlistText(['a', 'b']) === 'a、b' && allowlistText(['n_1'], e => e === 'n_1' ? 'alpha' : e) === 'alpha');
ck('只剩 !strict = 只有它自己', allowlistText([STRICT_ENTRY]) === '只有它自己');
ck('空白输入 = 清空(返回 null)', parseAllowlistInput('   ') === null);
ck('逗号/空格/顿号都能拆', same(parseAllowlistInput('a, b、c d'), ['a', 'b', 'c', 'd']));
ck('去重', same(parseAllowlistInput('a,a'), ['a']));
ck('草稿合并进现有名单,不替换', same(mergeDraft(['a'], 'b, a'), ['a', 'b']) && mergeDraft(null, ' ') === null);
ck('保活类工具被识别', ALWAYS_TOOLS.every(isAlwaysTool) && !isAlwaysTool('send_task'));
ck('保活类不能被移除', same(withoutAlwaysTools(['send_task', 'get_inbox']), ['send_task']));
ck('去掉最后一项 ⇒ null(Hub 拒收 [])', withoutItem(['a'], 'a') === null && same(withoutItem(['a', 'b'], 'a'), ['b']));

// ── 原因码:每个都有可执行说明,含收件白名单的 sender_not_allowed ──
ck('原因码各有可执行说明', PERMISSION_REASON_CODES.every(c => (permissionReasonText(c) ?? '').length > 10) && PERMISSION_REASON_CODES.includes('sender_not_allowed'));
ck('未知码原样带出', (permissionReasonText('weird_code') ?? '').includes('weird_code'));
ck('没有码 = null', permissionReasonText(null) === null && permissionReasonText('') === null);

// ── 节点候选:来自网络的节点列表,去掉自己,别名优先 ──
const nodes = [{ node_id: 'n_self', alias: 'me' }, { node_id: 'n_b', alias: 'beta' }, { node_id: 'n_a', alias: 'alpha' }, { node_id: 'n_x', alias: null }, { node_id: 'n_a2', alias: 'alpha' }];
const choices = nodeChoices(nodes, { node_id: 'n_self', alias: 'me' });
ck('候选去掉自己、同别名只留一项、按名字排序', same(choices.map(c => c.key), ['alpha', 'beta', 'n_x']));
const alpha = choices[0];
ck('按别名或 node_id 写的都算在名单里', listHasNode(['alpha'], alpha) && listHasNode(['n_a'], alpha) && !listHasNode(['beta'], alpha) && !listHasNode(null, alpha));
ck('勾选写别名;取消两种写法都去掉,去空 ⇒ null', same(toggleNode(null, alpha), ['alpha']) && toggleNode(['n_a'], alpha) === null && same(toggleNode(['n_a', 'beta'], alpha), ['beta']));
ck('node_id 显示成别名;不在网络里的注明', entryLabel('n_a', choices) === 'alpha' && entryLabel('ghost', choices).includes('不在这个网络'));

// ── 收件白名单语法:user:<名>、user:*、!strict ──
const humans = [{ user_id: 'u_1', username: 'bob', display_name: 'Bob Li' }];
ck('user:* = 所有成员;user:bob / user:u_1 = 成员显示名', entryLabel(ANY_PERSON_ENTRY, choices) === '所有成员' && entryLabel('user:bob', choices, humans) === '成员 Bob Li' && entryLabel('user:u_1', choices, humans) === '成员 Bob Li');
// 部门授权(admin 11-11「以部门去授权」):dept:<id>,显示带上级路径。
const depts = deptChoices([{ id: 'd_top', name: 'TMAI', parent_id: null }, { id: 'd_kid', name: 'TM门户', parent_id: 'd_top' }, { id: 'd_loop', name: '环', parent_id: 'd_loop' }]);
ck('部门路径按上级拼接并排序;成环不死循环', depts.map(d => d.path).join('|') === 'TMAI|TMAI / TM门户|环');
ck('dept: 条目显示部门路径;不认识的显示 id', deptEntry('d_kid') === 'dept:d_kid' && entryLabel('dept:d_kid', choices, humans, depts) === '部门 TMAI / TM门户' && entryLabel('dept:d_x', choices, humans, depts) === '部门 d_x');
ck('人员勾选切换', same(toggleEntry(null, 'user:bob'), ['user:bob']) && toggleEntry(['user:bob'], 'user:bob') === null);
ck('严格:没有发送方时不能开', setStrict(null, true) === null && !isStrict(setStrict(null, true)));
ck('严格:开 / 关', same(setStrict(['alpha'], true), ['alpha', STRICT_ENTRY]) && same(setStrict(['alpha', STRICT_ENTRY], false), ['alpha']) && setStrict([STRICT_ENTRY], false) === null);
ck('提交前:只剩 !strict ⇒ 整张清空(别把主人挡在外面)', normalizeInbox([STRICT_ENTRY]) === null && same(normalizeInbox(['alpha', STRICT_ENTRY]), ['alpha', STRICT_ENTRY]));
ck('显示时 !strict 不算发送方', allowlistText(['alpha', STRICT_ENTRY]) === 'alpha');

// ── 保存失败:照实带出原因码和 Hub hint ──
const denied = allowlistErrorText({ error: 'node_permission_denied', status: 403, reason: 'sender_not_allowed', hint: 'ask the owner' });
ck('node_permission_denied:原因码 + 说明 + Hub hint', denied.includes('sender_not_allowed') && denied.includes('接受来自') && denied.includes('Hub 提示：ask the owner'));
ck('403 permission_denied / 404 / user_token_required 各有人话', allowlistErrorText({ error: 'permission_denied', status: 403 }).includes('节点主人')
  && allowlistErrorText({ error: 'node_not_found', status: 404 }).includes('找不到') && allowlistErrorText({ error: 'user_token_required', status: 403 }).includes('节点令牌'));
ck('too_many_senders / empty_allowlist_ambiguous / 未知码', allowlistErrorText({ error: 'too_many_senders' }).includes('200')
  && allowlistErrorText({ error: 'empty_allowlist_ambiguous' }).includes('不限制') && allowlistErrorText({ error: 'boom', message: 'disk full' }).includes('disk full'));

// ── 英文 ──
setLanguagePreference('en');
ck('en: unrestricted / only itself / comma list', allowlistText(['a', 'b']) === 'a, b' && allowlistText(null) === 'Unrestricted' && allowlistText([STRICT_ENTRY]) === 'Only itself');
ck('en: people and reasons', entryLabel(ANY_PERSON_ENTRY, choices) === 'Any person' && (permissionReasonText('sender_not_allowed') ?? '').includes('Accepts from'));
ck('en: denial with hint', allowlistErrorText({ error: 'node_permission_denied', reason: 'peer_not_allowed', hint: 'h' }).includes('Hub hint: h'));
setLanguagePreference('zh');

console.log(`node allowlist model: ${p}/${t}`);
if (p !== t) process.exit(1);
