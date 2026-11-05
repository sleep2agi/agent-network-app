import { ALWAYS_TOOLS, allowlistText, isAlwaysTool, parseAllowlistInput, permissionReasonText, withoutAlwaysTools } from './node-allowlist-model';
let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log(`PASS: ${n}`); } else console.log(`FAIL: ${n}`); };

ck('null = 不限制(不是空名单)', allowlistText(null, 'peer') === '不限制' && allowlistText(undefined, 'tool') === '不限制');
// Hub 的合法取值只有 null 与非空数组：GET 永远不返回 []，PUT [] 会拿到 400 empty_allowlist_ambiguous。
// 所以 [] 只能按「不限制」显示 —— 显示成「全部禁止」等于承诺系统不支持的能力。
ck('空数组按「不限制」显示(与 Hub 语义一致)', allowlistText([], 'peer') === '不限制' && allowlistText([], 'tool') === '不限制');
ck('有内容时列出', allowlistText(['a', 'b'], 'peer') === 'a、b');
ck('空白输入 = 清空(返回 null)', parseAllowlistInput('   ') === null);
ck('逗号/空格/顿号都能拆', JSON.stringify(parseAllowlistInput('a, b、c d')) === JSON.stringify(['a', 'b', 'c', 'd']));
ck('去重', JSON.stringify(parseAllowlistInput('a,a')) === JSON.stringify(['a']));
ck('保活类工具被识别', ALWAYS_TOOLS.every(isAlwaysTool) && !isAlwaysTool('send_task'));
ck('保活类不能被移除', JSON.stringify(withoutAlwaysTools(['send_task', 'get_inbox'])) === JSON.stringify(['send_task']));
ck('七个原因码各有可执行说明', ['mode_readonly', 'mode_restricted_not_assigned', 'peer_not_allowed', 'tool_not_allowed', 'secret_transport_plain', 'secret_transport_unknown', 'empty_allowlist_ambiguous']
  .every(c => (permissionReasonText(c) ?? '').length > 10));
ck('未知码原样带出', (permissionReasonText('weird_code') ?? '').includes('weird_code'));
ck('没有码 = null', permissionReasonText(null) === null && permissionReasonText('') === null);
console.log(`node allowlist model: ${p}/${t}`);
if (p !== t) process.exit(1);
