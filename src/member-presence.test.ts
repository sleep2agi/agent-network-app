// 人员的在线状态(hub:/humans 的 online / last_seen_at + 用户流 member_presence)—— 纯逻辑 + 接线。ck 风格,自执行。
import { readFileSync } from 'node:fs';
import { applyMemberPresence, parseMemberPresence, peopleRows, personPresence } from './human-dm';

let p = 0, n = 0;
const ck = (name: string, ok: boolean) => { n++; if (ok) { p++; console.log(`  ✓ ${name}`); } else console.log(`  ✗ ${name}`); };

const NOW = Date.parse('2026-09-30T08:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

// —— 特性探测:旧 hub 不给 online → 不画 ——
ck('旧 hub(没有 online 字段)→ null,不画灰点', personPresence({}, NOW) === null);
ck('online 不是布尔(脏数据)→ null', personPresence({ online: 'yes' as any }, NOW) === null);
ck('在线 → 绿点,没有「x 前在线」', JSON.stringify(personPresence({ online: true, last_seen_at: ago(5_000) }, NOW)) === JSON.stringify({ online: true, lastSeen: null }));
ck('离线且 last_seen 未知(hub 重启后没连过)→ 只有灰点', JSON.stringify(personPresence({ online: false, last_seen_at: null }, NOW)) === JSON.stringify({ online: false, lastSeen: null }));
ck('离线 30 s → 刚刚', personPresence({ online: false, last_seen_at: ago(30_000) }, NOW)?.lastSeen?.key === 'justNow');
ck('离线 5 分钟 → 5 分钟前', JSON.stringify(personPresence({ online: false, last_seen_at: ago(5 * 60_000) }, NOW)?.lastSeen) === JSON.stringify({ key: 'minutes', n: 5 }));
ck('离线 3 小时 → 3 小时前', JSON.stringify(personPresence({ online: false, last_seen_at: ago(3 * 3600_000) }, NOW)?.lastSeen) === JSON.stringify({ key: 'hours', n: 3 }));
ck('离线 2 天 → 2 天前', JSON.stringify(personPresence({ online: false, last_seen_at: ago(2 * 86400_000) }, NOW)?.lastSeen) === JSON.stringify({ key: 'days', n: 2 }));
ck('离线 10 天 → 日期', personPresence({ online: false, last_seen_at: ago(10 * 86400_000) }, NOW)?.lastSeen?.key === 'date');
ck('hub 的 SQLite 无时区串按 UTC 解析', JSON.stringify(personPresence({ online: false, last_seen_at: '2026-09-30 07:55:00' }, NOW)?.lastSeen) === JSON.stringify({ key: 'minutes', n: 5 }));
ck('未来时间(时钟偏差)→ 刚刚,不出现负数', personPresence({ online: false, last_seen_at: ago(-120_000) }, NOW)?.lastSeen?.key === 'justNow');

// —— SSE 事件 ——
const ev = parseMemberPresence({ type: 'member_presence', member_user_id: 'u_b', online: false, last_seen_at: '2026-09-30T07:59:00Z', user_id: 'u_me', network_id: 'net_x', scope: 'user' });
ck('member_presence:取 member_user_id,不取 user_id(那是收件人自己)', ev?.user_id === 'u_b' && ev.online === false && ev.last_seen_at === '2026-09-30T07:59:00Z');
ck('别的事件类型 → null', parseMemberPresence({ type: 'desktop_message', member_user_id: 'u_b', online: true }) === null);
ck('缺 online → null', parseMemberPresence({ type: 'member_presence', member_user_id: 'u_b' }) === null);
ck('缺 member_user_id → null', parseMemberPresence({ type: 'member_presence', online: true }) === null);
ck('非对象 → null', parseMemberPresence('member_presence') === null && parseMemberPresence(null) === null);

const rows = peopleRows([
  { user_id: 'u_me', username: 'me' },
  { user_id: 'u_b', username: 'user-b', online: true, last_seen_at: null },
  { user_id: 'u_c', username: 'user-c', online: false, last_seen_at: null },
], [], 'u_me');
ck('peopleRows 带上 online / last_seen_at', rows.find(r => r.user_id === 'u_b')?.online === true);
const applied = applyMemberPresence(rows, ev!);
ck('applyMemberPresence:改那一行', applied.find(r => r.user_id === 'u_b')?.online === false && applied.find(r => r.user_id === 'u_b')?.last_seen_at === '2026-09-30T07:59:00Z');
ck('applyMemberPresence:其他行不动', applied.find(r => r.user_id === 'u_c') === rows.find(r => r.user_id === 'u_c'));
ck('applyMemberPresence:不认识的人 → 同一个数组(不重画)', applyMemberPresence(rows, { user_id: 'u_zz', online: true, last_seen_at: null }) === rows);

// —— 文案 ——
const copy = readFileSync(new URL('./i18n-users.ts', import.meta.url), 'utf8');
ck('中文「x 分钟前在线」', copy.includes(`'people.lastSeen.minutes': ['{n} 分钟前在线', 'Active {n} min ago'],`));
for (const k of ['justNow', 'minutes', 'hours', 'days', 'date']) ck(`文案 people.lastSeen.${k} 中英都有`, new RegExp(`'people\\.lastSeen\\.${k}': \\['[^']+', '[^']+'\\]`).test(copy));

// —— 接线 ——
const agents = readFileSync(new URL('./AgentsScreen.tsx', import.meta.url), 'utf8');
const listener = readFileSync(new URL('./DesktopMessageListener.tsx', import.meta.url), 'utf8');
const personRow = agents.slice(agents.indexOf('const renderPersonRow'), agents.indexOf('const renderPhoneRow'));
ck('桌面人员行的点用 agent 同一个样式 styles.statusDot', personRow.includes('style={[styles.statusDot, { backgroundColor: presence.online ? colors.running : colors.rest }'));
ck('手机人员行的点用 agent 同一个样式 rowStyles.dot', personRow.includes('style={[rowStyles.dot, { backgroundColor: presence.online ? colors.running : colors.rest'));
ck('两处的点都只在 presence 非空时画(特性探测)', (personRow.match(/\{presence \? \(/g) ?? []).length === 2);
ck('人员列表订阅 member_presence', agents.includes('subscribeMemberPresence(ev => setPeople(rows => applyMemberPresence(rows, ev)))'));
ck('用户流消费者把 member_presence 交给总线', listener.includes('const presence = parseMemberPresence(raw);') && listener.includes('emitMemberPresence(presence)'));

console.log(`\n${p}/${n} passed`);
if (p !== n) process.exit(1);
