// #1543 —— 点「新消息」系统通知要定位到那条消息(以前只打开 agent 会话)。
// 两条链路:手机走通知 data.messageId;桌面走 chatFocusAlias(把消息 id 编进 Rust 只回传的 alias 字符串)。
// 找不到(消息被翻页挤出 / 删掉)时退回「只打开会话」,不弹提示 —— 由 App 的 focusSilent 控制。
import { readFileSync } from 'node:fs';
import { groupByAgent, fromUserMessages, fromInboxRows } from './notify-policy';
import { accumulate, routeTargetFromNotificationData, takeRoute, initialTapQueue, receiveTap, NOTIFICATION_KIND } from './mobile-notify-model';
import { chatFocusAlias, parseChatFocusAlias } from './notification-focus';

let passed = 0, total = 0;
const check = (name: string, ok: boolean) => { total++; if (ok) { passed++; console.log('✅', name); } else { console.error('❌', name); } };

// ── 手机链路 ──
const rows = fromUserMessages([
  { message_id: 'dm_aaa', from_session: '通信龙', content: '第一条', created_at: '2026-11-19 09:00:00' },
  { message_id: 'dm_bbb', from_session: '通信龙', content: '第二条(最新)', created_at: '2026-11-19 09:01:00' },
] as any);
const groups = groupByAgent(rows);
check('分组带最近一条主动消息 id', groups.length === 1 && groups[0].messageId === 'dm_bbb');

const { posts } = accumulate({}, groups, { mode: 'new', profileKey: 'p1', sound: true });
check('通知 data 带 messageId', posts.length === 1 && posts[0].data.messageId === 'dm_bbb' && posts[0].data.kind === NOTIFICATION_KIND);

const routed = routeTargetFromNotificationData(posts[0].data, 'p1');
check('点通知解出 alias + messageId', routed?.alias === '通信龙' && routed?.messageId === 'dm_bbb');

const queued = receiveTap(initialTapQueue(), posts[0].data, 'k1');
const taken = takeRoute(queued, { loggedIn: true, uiAttached: true, profileKey: 'p1' });
check('takeRoute 把 messageId 交给 UI', taken.consumed && taken.alias === '通信龙' && taken.messageId === 'dm_bbb');

const legacy = routeTargetFromNotificationData({ kind: NOTIFICATION_KIND, alias: '通信龙', profileKey: 'p1' }, 'p1');
check('老通知(没有 messageId)仍是「只打开会话」', legacy?.alias === '通信龙' && legacy?.messageId === null);

// 回复行(inbox `i:` id)的 key 不是会话里的消息 key —— 不能拿它去定位
const inboxGroups = groupByAgent(fromInboxRows([{ id: 'task-1', from_alias: 'a', to_alias: 'me', type: 'reply', content: 'x' } as any], 'me'));
check('inbox 回复行不带 messageId(避免定位到错的地方)', inboxGroups.length === 1 && inboxGroups[0].messageId === undefined);

// ── 桌面链路(alias 编码) ──
const encoded = chatFocusAlias('通信龙', 'dm_bbb');
check('chatFocusAlias → parse 往返', parseChatFocusAlias(encoded)?.agent === '通信龙' && parseChatFocusAlias(encoded)?.messageId === 'dm_bbb');
check('带冒号 / 中文的 agent 也能解码', parseChatFocusAlias(chatFocusAlias('a:b 牛', 'dm_x'))?.agent === 'a:b 牛');
check('托盘菜单的裸 alias → null(走原路径)', parseChatFocusAlias('通信龙') === null);
check('坏字符串 → null(不抛错)', parseChatFocusAlias('anet-chat:%E0%A4%A') === null && parseChatFocusAlias('anet-chat:') === null);

// ── 接线契约(源码查) ──
const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
check('App:通知点进来带 focusTaskId + focusSilent', app.includes('focusTaskId: messageId, focusSilent: true'));
check('App:会话页把 focusSilent 传下去', (app.match(/focusSilent=\{screen\.focusSilent\}/g) ?? []).length === 3);

const mobile = readFileSync(new URL('./MobileNotifier.tsx', import.meta.url), 'utf8');
check('MobileNotifier:把 messageId 交给 openChat', mobile.includes('open.current(alias, messageId ?? undefined)'));

const desktopNotifier = readFileSync(new URL('./DesktopNotifier.tsx', import.meta.url), 'utf8');
check('DesktopNotifier:有 messageId 就编进 alias', desktopNotifier.includes('group.messageId ? chatFocusAlias(group.agent, group.messageId)'));
check('DesktopNotifier:网页端点击解回 messageId', desktopNotifier.includes('openChat.current?.(focus.agent, focus.messageId)'));

const tray = readFileSync(new URL('./desktop-tray.ts', import.meta.url), 'utf8');
check('desktop-tray:先解任务、再解 chat focus、最后才是裸 alias', tray.indexOf('parseTaskOpenAlias') < tray.indexOf('parseChatFocusAlias') && tray.indexOf('parseChatFocusAlias') < tray.indexOf('onOpenChat(payload.trim())'));

const chat = readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8');
check('ChatScreen:找不到那条时,通知入口不弹提示', chat.includes("if (step.kind === 'missing') { setFocusTarget(null); if (!focusSilent) setComposerNotice(t('chat.focusNotFound')); return; }"));

console.log(`notification focus: ${passed}/${total} checks passed`);
process.exit(passed === total ? 0 : 1);
