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
