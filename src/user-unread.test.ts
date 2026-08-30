import { readFileSync } from 'node:fs';
import { readServerUnread, resolveUnread, userMessagesPath } from './user-unread';

let passed = 0;
let total = 0;
const check = (name: string, ok: boolean) => {
  total++;
  if (ok) { passed++; console.log('✅', name); }
  else { console.error('❌', name); }
};

// --- 路径:少一个 scope=user 就落回 alias 分支(读错表) ------------------------
check('路径带 scope=user', userMessagesPath(50).includes('scope=user'));
check('路径带 limit', userMessagesPath(50).includes('limit=50'));
check('limit 归一为正整数', userMessagesPath(0).includes('limit=1') && userMessagesPath(12.7).includes('limit=12'));
// 🔴 网络作用域:有 networkId 必须带,没有必须不带 —— 本仓 api-network-scope.test.ts
//    把这条做成了门,我第一版漏了它、被它抓住。
check('🔴 有 networkId 时带 network_id', userMessagesPath(20, 'net_abc').includes('network_id=net_abc'));
check('🔴 没有 networkId 时不带 network_id',
  !userMessagesPath(20).includes('network_id')
  && !userMessagesPath(20, '').includes('network_id')
  && !userMessagesPath(20, '   ').includes('network_id')
  && !userMessagesPath(20, null).includes('network_id'));

// --- 读服务端权威数 ----------------------------------------------------------
check('读 unread', readServerUnread({ ok: true, unread: 7, pending_count: 7 }) === 7);
check('unread 缺失时退到 pending_count', readServerUnread({ ok: true, pending_count: 3 }) === 3);
check('0 是合法值,不能当成"读不到"', readServerUnread({ unread: 0 }) === 0);

// 🔴 这条是整个模块的立论:读不到必须是 null,不能是 0。
//    返回 0 等于说「没有未读」—— 兜底朝好的一侧,会把角标清掉。
check('🔴 读不到返回 null 而不是 0',
  readServerUnread({}) === null
  && readServerUnread({ ok: true, messages: [] }) === null
  && readServerUnread(null) === null
  && readServerUnread(undefined) === null
  && readServerUnread('nope') === null);
check('🔴 坏值(负数/NaN/字符串)也返回 null,不静默接受',
  readServerUnread({ unread: -1 }) === null
  && readServerUnread({ unread: NaN }) === null
  && readServerUnread({ unread: '5' }) === null
  && readServerUnread({ unread: Infinity }) === null);

// --- 服务端优先,退回本地 -----------------------------------------------------
check('服务端有数就用服务端的(即使本地更大)', resolveUnread(2, 99) === 2);
check('🔴 服务端说 0 就是 0 —— 不被本地覆盖', resolveUnread(0, 5) === 0);
check('服务端拿不到就退回本地', resolveUnread(null, 5) === 5);
check('服务端拿不到且本地为 0 → 0', resolveUnread(null, 0) === 0);
check('本地是坏值时按 0 处理,不抛', resolveUnread(null, NaN) === 0 && resolveUnread(null, -3) === 0);

// --- 接线守卫:api.ts 真的用了这个路径 ---------------------------------------
// 🔴 纯函数的测试看不见调用点。剥掉注释行再断言 ——
//    源码里既有那个东西,也有关于它的说明。
const apiRaw = readFileSync(new URL('./api.ts', import.meta.url), 'utf8');
const api = apiRaw.split('\n')
  .filter(l => { const c = l.trim(); return !c.startsWith('//') && !c.startsWith('*') && !c.startsWith('/*'); })
  .join('\n');
check('api.ts 导出了 user 作用域的取数函数', api.includes('fetchUserMessages'));
check('🔴 而且它用的是 userMessagesPath —— 不是自己拼一遍 URL',
  api.includes('userMessagesPath('));

console.log(`\n${passed}/${total} passed`);
if (passed !== total) process.exit(1);
