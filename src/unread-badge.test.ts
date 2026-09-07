import { readFileSync } from 'node:fs';
import {
  formatUnreadBadge,
  initialUnreadState,
  reduceUnread,
  unreadOf,
  type UnreadEvent,
} from './unread-ledger';
import { ingestUserMessages, unreadCountForAgentRow } from './unread-badge';

let passed = 0;
let total = 0;
const check = (name: string, ok: boolean) => {
  total++;
  if (ok) { passed++; console.log('✅', name); }
  else { console.error('❌', name); }
};

const run = (evs: UnreadEvent[]) => evs.reduce(reduceUnread, initialUnreadState());

{
  const ledger = run([
    { kind: 'message_arrived', agent: 'a' },
    { kind: 'message_arrived', agent: 'a' },
    { kind: 'message_arrived', agent: 'b' },
  ]);
  check('服务端拿不到 → 退回该 Agent 的 ledger', unreadCountForAgentRow(null, ledger, 'a') === 2);
  check('服务端 0 权威全已读，即使本地还有数', unreadCountForAgentRow({ unread: 0 }, ledger, 'a') === 0);
  check('服务端正总数不是 per-Agent，不画到每一行', unreadCountForAgentRow({ unread: 9 }, ledger, 'a') === 2);
  check('无未读的行是 0 不是 undefined', unreadCountForAgentRow(null, ledger, 'zzz') === 0);
  // #1828:hub 给了 unread_by_agent → 权威,本地 ledger 与回复那半都退位;没给 → 老算法。
  const authoritative = { unread: 9, unread_by_agent: { a: 5, c: 1.9, d: -1, e: 'x' }, unread_total: 6 };
  check('#1828 权威数覆盖本地 ledger', unreadCountForAgentRow(authoritative, ledger, 'a', { a: 7 }) === 5);
  check('#1828 权威表里没有的 agent 是 0(即使本地有)', unreadCountForAgentRow(authoritative, ledger, 'b', { b: 3 }) === 0);
  check('#1828 小数向下取整、负数/非数字丢弃', unreadCountForAgentRow(authoritative, ledger, 'c') === 1 && unreadCountForAgentRow(authoritative, ledger, 'd') === 0 && unreadCountForAgentRow(authoritative, ledger, 'e') === 0);
  check('#1828 unread_by_agent 不是对象 → 退回老算法', unreadCountForAgentRow({ unread: 9, unread_by_agent: [1] }, ledger, 'a', { a: 1 }) === 3);
  check('老 hub(无 unread_by_agent)仍是 user_inbox 半 + 回复半', unreadCountForAgentRow({ unread: 9 }, ledger, 'a', { a: 4 }) === 6);
  // 接线契约(ChatScreen / unread-store import react-native,bun 里按源码查):渲染到底时向 hub ack 两表 id。
  const chat = readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8');
  const at = chat.indexOf("dispatchUnread({ kind: 'rendered_to_latest', agent: alias });");
  check('#1828 ChatScreen 渲染到底 → hubHasAgentUnread 时 ackUserMessages(unackedIdsForAgent)', at > 0 && chat.slice(at, at + 600).includes('if (hubHasAgentUnread())') && chat.slice(at, at + 600).includes('ackUserMessages(cfg, ids)'));
  const store = readFileSync(new URL('./unread-store.ts', import.meta.url), 'utf8');
  check('#1828 unackedIdsForAgent 合并 user_inbox message_id 与 inbox 回复 id', store.includes('ids.add(m.message_id)') && store.includes('ids.add(r.id)') && store.includes('r.to_alias === snap.replyUsername'));
}

{
  const ledger = run([
    { kind: 'message_arrived', agent: 'a' },
    { kind: 'message_arrived', agent: 'a' },
    { kind: 'conversation_opened', agent: 'a' },
  ]);
  check('打开会话未渲染到最新 → 行上仍显示未读', unreadCountForAgentRow(null, ledger, 'a') === 2);
  const shown = reduceUnread(ledger, { kind: 'rendered_to_latest', agent: 'a' });
  check('渲染到最新之后行上为 0', unreadCountForAgentRow(null, shown, 'a') === 0);
  check('0 → formatUnreadBadge 返回 null（完全不渲染）', formatUnreadBadge(unreadCountForAgentRow(null, shown, 'a')) === null);
}

{
  const first = ingestUserMessages(initialUnreadState(), [
    { id: 'm1', from_alias: '通信龙' },
    { id: 'm2', from_alias: '通信龙' },
    { id: 'm1', from_alias: '通信龙' },
  ], new Set());
  check('ingest 按 id 去重', unreadOf(first.ledger, '通信龙') === 2);
  const again = ingestUserMessages(first.ledger, [
    { id: 'm1', from_alias: '通信龙' },
    { id: 'm2', from_alias: '通信龙' },
  ], first.seenIds);
  check('同一批再 ingest 不加倍', unreadOf(again.ledger, '通信龙') === 2);
}

const agents = readFileSync(new URL('./AgentsScreen.tsx', import.meta.url), 'utf8');
const badge = readFileSync(new URL('./AgentUnreadBadge.tsx', import.meta.url), 'utf8');
const chat = readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8');
const row = readFileSync(new URL('./unread-badge.ts', import.meta.url), 'utf8');
const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

check('行计数调用 resolveUnread + readServerUnread + unreadOf，不另写 +1',
  row.includes('resolveUnread') && row.includes('readServerUnread') && row.includes('unreadOf('));
check('列表用 formatUnreadBadge，不用手写 99+',
  agents.includes('formatUnreadBadge(') && agents.includes('unreadCountForAgentRow(') && !agents.includes('99+'));
check('徽标组件在 null 时 return null', badge.includes('if (!badge) return null'));
check('ChatScreen 打开会话走 conversation_opened', chat.includes("kind: 'conversation_opened'"));
check('ChatScreen 展示到最新走 rendered_to_latest', chat.includes("kind: 'rendered_to_latest'"));
check('列表 onPress 只打开会话，不在行上清零',
  agents.includes('onPress={() => onOpenChat(item.alias)}') && !agents.includes("rendered_to_latest"));
check('web 夹具不连生产 hub',
  app.includes('readWebFixture') && app.includes('UnreadBadgeFixtureScreen'));


const fixtureSrc = readFileSync(new URL('./UnreadBadgeFixtureScreen.tsx', import.meta.url), 'utf8');
check('夹具在首屏前 setThemeMode，不把 light 交给 useEffect（那会截到默认 dark）',
  fixtureSrc.includes('if (themeMode() !== theme) setThemeMode(theme)') &&
  !/useEffect\(\(\) => \{\s*setThemeMode\(theme\);/.test(fixtureSrc) &&
  app.includes('if (themeMode() !== fixture.theme) setThemeMode(fixture.theme)'));

console.log(`\n${passed}/${total} passed`);
if (passed !== total) process.exit(1);
