// 0.2.107 手机系统通知(安卓优先,无厂商推送):判定、合并、点通知跳转、权限时机、设置落盘、
// 前台服务的清单/代码一致性。ck 式自执行脚本(不是 bun:test)。
import fs from 'node:fs';
import path from 'node:path';
import { decide, groupByAgent, incomingFromSnapshot, initialSeen, pickNew, type Presence } from './notify-policy';
import { plainTextForNotification } from './notify-text';
import { DEFAULT_QUIET_HOURS } from './quiet-hours';
import {
  DEFAULT_NOTIFY_SETTINGS,
  hydrateNotifySettings,
  isAgentMuted,
  loadNotifySettings,
  mutedAgents,
  notifyProfileKey,
  notifySettingsHydrated,
  parseNotifySettings,
  resetNotifySettingsForTest,
  saveNotifySettings,
  serializeNotifySettings,
  toggleAgentMuted,
  NOTIFY_SETTINGS_KEY,
} from './notify-settings';
import {
  accumulate,
  clearAgent,
  conversationBeingViewed,
  initialTapQueue,
  keepAliveWanted,
  MESSAGE_CHANNEL_ID,
  notificationIdentifier,
  NOTIFICATION_KIND,
  permissionOnUserAction,
  QUIET_CHANNEL_ID,
  receiveTap,
  routeFromNotificationData,
  shouldAutoRequestPermission,
  shouldSkipFetch,
  summaryBody,
  takeRoute,
  watcherIntervalMs,
} from './mobile-notify-model';
import { filterSettings } from './settings-model';
import { XIAOMI_GUIDE_STEPS } from './xiaomi-guide';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log('✅', n); } else console.log('❌', n); };
const norm = (f: string) => fs.readFileSync(path.join(__dirname, f), 'utf8').replace(/\r\n?/g, '\n');

// ── 1. 判定:给定当前界面,通不通知(与桌面端共用 decide)──
const base = { soundEnabled: true, quiet: DEFAULT_QUIET_HOURS };
const fgOn = (open: string | null): Presence => ({ windowFocused: true, openConversation: open });
const bg = (open: string | null): Presence => ({ windowFocused: false, openConversation: open });
ck('前台 + 正开着 B 的会话 → B 的消息不通知', !decide('B', fgOn('B'), base, 600).notify);
// 🔴 主场景:人在应用里看 A,B 来消息 —— 必须通知(0.2.81 的前置教训)。
ck('前台 + 开着 A 的会话 → B 的消息照常通知(主场景)', decide('B', fgOn('A'), base, 600).notify);
ck('前台 + 在设置页/列表(没开会话)→ 通知', decide('B', fgOn(null), base, 600).notify);
ck('后台 + 最后开着的就是 B → 仍通知(人不在看)', decide('B', bg('B'), base, 600).notify);
ck('总开关关 → 不通知', !decide('B', bg(null), { ...base, enabled: false }, 600).notify);
ck('B 被免打扰 → 不通知;别的 agent 照常', !decide('B', bg(null), { ...base, muted: ['B'] }, 600).notify && decide('C', bg(null), { ...base, muted: ['B'] }, 600).notify);
ck('不传 enabled/muted = 旧行为(桌面端未改)', decide('B', bg(null), base, 600).notify && decide('B', bg(null), base, 600).sound);

// ── 2. 整条管线:快照 → 候选 → 首份只登记 → 新行 → 合并 → 发 ──
const now = Date.parse('2026-09-26T10:05:00Z');
const snap = (rows: Array<{ id: string; from: string; content: string; at?: string }>) => ({
  serverBody: { messages: [] as unknown[] },
  replyUsername: 'vincent',
  replyRows: rows.map(r => ({ id: r.id, from_alias: r.from, to_alias: 'vincent', type: 'reply', content: r.content, created_at: r.at ?? '2026-09-26 10:04:30' })) as any,
});
const s0 = pickNew(initialSeen(), incomingFromSnapshot(snap([{ id: 'old', from: 'A', content: '历史' }])), now);
ck('首份快照只登记,不弹历史', s0.toNotify.length === 0 && s0.seen.seeded);
const s1 = pickNew(s0.seen, incomingFromSnapshot(snap([
  { id: 'old', from: 'A', content: '历史' },
  { id: 'b1', from: 'B', content: '**构建**完成:[报告](/data/x/report.md)' },
  { id: 'b2', from: 'B', content: '第二条' },
  { id: 'a1', from: 'A', content: 'A 的新消息' },
])), now);
const groups = groupByAgent(s1.toNotify).filter(g => decide(g.agent, fgOn('A'), base, 600).notify);
ck('看着 A 时:A 的新消息被压下,B 的两条合成一组', groups.length === 1 && groups[0].agent === 'B' && groups[0].count === 2);
const acc1 = accumulate({}, groups.map(g => ({ ...g, body: plainTextForNotification(g.body) })), { mode: 'all', profileKey: 'p1', sound: true });
ck('一组 = 一条系统通知,标题是 alias', acc1.posts.length === 1 && acc1.posts[0].title === 'B');
ck('正文是最后一条的预览,带「［2 条新消息］」', acc1.posts[0].body === '［2 条新消息］第二条');
ck('Markdown 被压成纯文本(链接只留标签)', plainTextForNotification('**构建**完成:[报告](/data/x/report.md)') === '构建完成:报告');
ck('超长正文截断到 80 字加省略号', (() => { const b = plainTextForNotification('字'.repeat(200)); return Array.from(b).length === 81 && b.endsWith('…'); })());

// ── 3. 合并与摘要:同一 agent 原地更新,不刷屏 ──
const acc2 = accumulate(acc1.buckets, [{ agent: 'B', count: 1, body: '第三条' }], { mode: 'all', profileKey: 'p1', sound: true });
ck('再来一条:同一个 identifier(原地更新),计数累加到 3', acc2.posts[0].identifier === acc1.posts[0].identifier && acc2.posts[0].body === '［3 条新消息］第三条' && acc2.buckets.B.count === 3);
ck('identifier 按账号 + agent', notificationIdentifier('p1', 'B') === 'anet-msg:p1:B' && notificationIdentifier('p2', 'B') !== notificationIdentifier('p1', 'B'));
ck('「每条消息」模式:后续消息也响(消息渠道)', acc2.posts[0].alert && acc2.posts[0].channelId === MESSAGE_CHANNEL_ID);
const n1 = accumulate({}, [{ agent: 'B', count: 1, body: 'x' }], { mode: 'new', profileKey: 'p1', sound: true });
const n2 = accumulate(n1.buckets, [{ agent: 'B', count: 1, body: 'y' }], { mode: 'new', profileKey: 'p1', sound: true });
ck('「仅新消息」模式:第一条响,后续走静默渠道只更新条数', n1.posts[0].alert && n1.posts[0].channelId === MESSAGE_CHANNEL_ID && !n2.posts[0].alert && n2.posts[0].channelId === QUIET_CHANNEL_ID && n2.posts[0].body === '［2 条新消息］y');
const n3 = accumulate(clearAgent(n2.buckets, 'B', 'p1').buckets, [{ agent: 'B', count: 1, body: 'z' }], { mode: 'new', profileKey: 'p1', sound: true });
ck('「仅新消息」:看过之后(桶清空)下一条重新响', n3.posts[0].alert && n3.posts[0].body === 'z');
const silent = accumulate({}, [{ agent: 'B', count: 1, body: 'x' }], { mode: 'all', profileKey: 'p1', sound: false });
ck('提示音关 → 走静默渠道(安卓 8+ 声音由渠道决定)', !silent.posts[0].alert && silent.posts[0].channelId === QUIET_CHANNEL_ID);
ck('多个 agent 各自一条', accumulate({}, [{ agent: 'A', count: 1, body: '1' }, { agent: 'B', count: 2, body: '2' }], { mode: 'all', profileKey: 'p', sound: true }).posts.map(x => x.identifier).join() === 'anet-msg:p:A,anet-msg:p:B');
ck('摘要文字:单条=预览,空预览=「新消息」,多条空预览=「N 条新消息」', summaryBody(1, 'hi') === 'hi' && summaryBody(1, '') === '新消息' && summaryBody(4, '') === '4 条新消息');
ck('通知 data 带 alias + 账号键 + 类型', acc1.posts[0].data.alias === 'B' && acc1.posts[0].data.profileKey === 'p1' && acc1.posts[0].data.kind === NOTIFICATION_KIND);

// ── 4. 打开会话时清掉 ──
const cleared = clearAgent(acc2.buckets, 'B', 'p1');
ck('打开 B → 清 B 的桶并撤掉 B 的通知', !cleared.buckets.B && cleared.dismiss === 'anet-msg:p1:B');
ck('没有 B 的通知 → 什么都不撤', clearAgent({}, 'B', 'p1').dismiss === null);
ck('「在看」= 前台且开着会话;后台挂着的会话不算', conversationBeingViewed('B', true) === 'B' && conversationBeingViewed('B', false) === null && conversationBeingViewed(null, true) === null);

// ── 5. 点通知跳转(冷启动 / 热启动,手机 / 双栏同一条 setScreen)──
const data = acc1.posts[0].data;
ck('点自己账号的消息通知 → 跳到那个 agent', routeFromNotificationData(data, 'p1') === 'B');
ck('别的账号的通知 → 不跳', routeFromNotificationData(data, 'p2') === null);
ck('不是我们的通知 / 测试通知 / 坏数据 → 不跳', routeFromNotificationData({ kind: 'anet-test', alias: '' }, 'p1') === null && routeFromNotificationData(null, 'p1') === null && routeFromNotificationData({ kind: NOTIFICATION_KIND, alias: '  ' }, 'p1') === null);
let q = receiveTap(initialTapQueue(), data, 'k1@1');
let r = takeRoute(q, { loggedIn: false, uiAttached: true, profileKey: '' });
ck('冷启动:点击先到、账号还没恢复 → 留着不跳', !r.consumed && r.queue.pending !== null);
r = takeRoute(r.queue, { loggedIn: true, uiAttached: false, profileKey: 'p1' });
ck('账号恢复了但界面还没挂 → 仍留着', !r.consumed && r.queue.pending !== null);
r = takeRoute(r.queue, { loggedIn: true, uiAttached: true, profileKey: 'p1' });
ck('都就绪 → 跳到 B,只跳一次', r.consumed && r.alias === 'B' && r.queue.pending === null);
q = receiveTap(r.queue, data, 'k1@1');
ck('同一次点击被重读(重挂 / getLastNotificationResponse)→ 不再跳', q.pending === null && !takeRoute(q, { loggedIn: true, uiAttached: true, profileKey: 'p1' }).consumed);
ck('热启动:新的点击 → 立刻跳', takeRoute(receiveTap(q, data, 'k2@2'), { loggedIn: true, uiAttached: true, profileKey: 'p1' }).alias === 'B');

// ── 6. 权限时机 ──
const perm = (o: Partial<Parameters<typeof shouldAutoRequestPermission>[0]>) => shouldAutoRequestPermission({ platform: 'android', loggedIn: true, enabled: true, prompted: false, status: 'undetermined', ...o });
ck('登录后第一次(未授权、没弹过)→ 弹', perm({}));
ck('登录之前 → 不弹', !perm({ loggedIn: false }));
ck('弹过一次 → 不再自动弹', !perm({ prompted: true }));
ck('已授权 → 不弹;总开关关 → 不弹', !perm({ status: 'granted' }) && !perm({ enabled: false }));
ck('桌面/网页 → 不弹;iOS 同安卓', !perm({ platform: 'web' }) && perm({ platform: 'ios' }));
ck('设置里主动开:未授权可再问 → 弹;系统不再让问 → 去系统设置;已授权 → 无', permissionOnUserAction('denied', true) === 'request' && permissionOnUserAction('denied', false) === 'open-settings' && permissionOnUserAction('granted', false) === 'none');

// ── 7. 设置落盘 ──
ck('默认:总开关开、每条提醒、保持连接关、没弹过权限', DEFAULT_NOTIFY_SETTINGS.enabled && DEFAULT_NOTIFY_SETTINGS.mode === 'all' && !DEFAULT_NOTIFY_SETTINGS.keepAlive && !DEFAULT_NOTIFY_SETTINGS.permissionPrompted);
const legacy = parseNotifySettings(JSON.stringify({ soundEnabled: false, quiet: { enabled: true, start: '23:00', end: '07:00' } }));
ck('0.2.106 存的旧对象 → 新键取默认,总开关仍是开(桌面不被关掉)', legacy.enabled && legacy.mode === 'all' && !legacy.keepAlive && legacy.soundEnabled === false && legacy.quiet.start === '23:00');
const full = { ...DEFAULT_NOTIFY_SETTINGS, enabled: false, mode: 'new' as const, keepAlive: true, permissionPrompted: true, mutedByProfile: { p1: ['B'] } };
const round = parseNotifySettings(serializeNotifySettings(full));
ck('序列化往返不丢字段', !round.enabled && round.mode === 'new' && round.keepAlive && round.permissionPrompted && round.mutedByProfile.p1[0] === 'B');
ck('坏值归一:mode 未知 → all;免打扰列表去空、去重、非数组丢弃', (() => { const x = parseNotifySettings(JSON.stringify({ mode: 'x', mutedByProfile: { p: ['A', 'A', ' ', 3], q: 'B' } })); return x.mode === 'all' && x.mutedByProfile.p.join() === 'A' && !('q' in x.mutedByProfile); })());
const m1 = toggleAgentMuted(DEFAULT_NOTIFY_SETTINGS, 'p1', 'B');
ck('免打扰按账号:p1 下 B 静音不影响 p2', isAgentMuted(m1, 'p1', 'B') && !isAgentMuted(m1, 'p2', 'B') && mutedAgents(m1, 'p2').length === 0);
ck('再切一次 → 取消,空列表的账号键被删掉', !isAgentMuted(toggleAgentMuted(m1, 'p1', 'B'), 'p1', 'B') && !('p1' in toggleAgentMuted(m1, 'p1', 'B').mutedByProfile));
ck('账号键:有 profileId 用它,否则 server|user;未登录为空', notifyProfileKey({ profileId: 'x', serverUrl: 's' }) === 'x' && notifyProfileKey({ serverUrl: 's', username: 'u' }) === 's|u' && notifyProfileKey(null) === '');
// 手机端:hydrate 之前是默认值;hydrate 把文件内容交进来,之后每次保存都经写手落盘
resetNotifySettingsForTest();
ck('手机端 hydrate 之前:默认值、未就绪', loadNotifySettings().enabled && !notifySettingsHydrated());
const written: string[] = [];
hydrateNotifySettings(JSON.stringify({ keepAlive: true, mode: 'new' }), json => written.push(json));
ck('hydrate 后读到文件里的值', loadNotifySettings().keepAlive && loadNotifySettings().mode === 'new' && notifySettingsHydrated());
ck('保存 → 经写手落盘(下次启动还在)', saveNotifySettings({ ...loadNotifySettings(), keepAlive: false }) && parseNotifySettings(written.at(-1)).keepAlive === false && parseNotifySettings(written.at(-1)).mode === 'new');
resetNotifySettingsForTest();
saveNotifySettings({ ...DEFAULT_NOTIFY_SETTINGS, enabled: false });
const late: string[] = [];
hydrateNotifySettings(JSON.stringify({ enabled: true }), json => late.push(json));
ck('文件还没读回来时用户先改了 → 以用户那次为准,并补写落盘', !loadNotifySettings().enabled && late.length === 1 && parseNotifySettings(late[0]).enabled === false);
// 桌面壳:localStorage,同步
resetNotifySettingsForTest();
const store = new Map<string, string>();
(globalThis as any).__TAURI_INTERNALS__ = {};
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
saveNotifySettings(toggleAgentMuted(loadNotifySettings(), 'p1', 'B'));
resetNotifySettingsForTest();
ck('桌面壳:存进 localStorage,重读还在', isAgentMuted(loadNotifySettings(), 'p1', 'B') && store.has(NOTIFY_SETTINGS_KEY));
delete (globalThis as any).__TAURI_INTERNALS__;
delete (globalThis as any).localStorage;
resetNotifySettingsForTest();

// ── 8. 后台保持连接 / 轮询 ──
const ka = (o: Partial<Parameters<typeof keepAliveWanted>[0]>) => keepAliveWanted({ platform: 'android', loggedIn: true, enabled: true, keepAlive: true, ...o });
ck('前台服务:安卓 + 已登录 + 总开关开 + 用户开了 → 起', ka({}));
ck('任一不满足 → 不起(iOS / 登出 / 总开关关 / 默认关)', !ka({ platform: 'ios' }) && !ka({ loggedIn: false }) && !ka({ enabled: false }) && !ka({ keepAlive: false }));
ck('轮询:前台 10 s;后台有前台服务 20 s;后台没有 → 不轮询', watcherIntervalMs(true, false) === 10000 && watcherIntervalMs(false, true) === 20000 && watcherIntervalMs(false, false) === null);
ck('列表刚拉过 → 这一拍跳过;从没拉过 / 已过 → 拉', shouldSkipFetch(1000, 3000, 10000) && !shouldSkipFetch(0, 3000, 10000) && !shouldSkipFetch(1000, 20000, 10000));

// ── 9. 设置页:按平台出现的行 ──
const rowsOf = (platform: any, q = '') => filterSettings(q, {}, undefined, platform).find(c => c.key === 'notifications')?.rows.map(r => r.key) ?? [];
ck('安卓:总开关/提醒方式/免打扰/后台保持连接/小米指引/测试都在', ['enabled', 'mode', 'muted', 'keepAlive', 'xiaomiGuide', 'test'].every(k => rowsOf('android').includes(k)));
ck('桌面:没有安卓专属行,提示音/免打扰时段/总开关/按 agent 免打扰还在', !rowsOf('desktop').some(k => ['keepAlive', 'xiaomiGuide', 'test', 'mode'].includes(k)) && ['enabled', 'sound', 'quiet', 'muted'].every(k => rowsOf('desktop').includes(k)));
ck('iOS:有测试通知,没有前台服务和小米指引', rowsOf('ios').includes('test') && !rowsOf('ios').includes('keepAlive') && !rowsOf('ios').includes('xiaomiGuide'));
ck('搜「小米」「自启动」能找到指引', rowsOf('android', '小米').join() === 'xiaomiGuide' && rowsOf('android', '自启动').join() === 'xiaomiGuide');
ck('指引写了自启动与省电策略「无限制」', XIAOMI_GUIDE_STEPS.some(s => s.title.includes('自启动')) && XIAOMI_GUIDE_STEPS.some(s => s.title.includes('无限制')));

// ── 10. 接线 / 原生清单契约 ──
const app = norm('../App.tsx'), index = norm('../index.ts'), runtime = norm('notifier-runtime.ts'), listener = norm('DesktopMessageListener.tsx');
const settingsSrc = norm('SettingsScreen.tsx'), chat = norm('ChatScreen.tsx');
ck('App:安卓/iOS 挂 MobileNotifier(cfg 可为 null → 登出时停),点通知走 setScreen 进会话', app.includes("{Platform.OS === 'android' || Platform.OS === 'ios' ? <MobileNotifier cfg={cfg} onOpenChat={alias => setScreen({ name: 'chat', alias })} onOpenTask={taskId => setScreen({ name: 'taskDetail', taskId })} /> : null}"));
ck('入口顶层登记 headless 任务', index.includes('registerKeepAliveTask();'));
// 0.2.109:运行时用 decideWithReason(与 decide 同一条判据,多带原因给诊断);decide 本身只是丢掉原因的包装。
ck('运行时用与桌面同一条判据(decideWithReason)+ incomingFromSnapshot', runtime.includes('decideWithReason(g.agent, presence, settings, minutes)') && runtime.includes('incomingFromSnapshot(snap)') && fs.readFileSync(path.join(__dirname, 'notify-policy.ts'), 'utf8').includes('const d = decideWithReason(agent, presence, settings, nowMinutes);'));
ck('用户 SSE 来 desktop_message → 立刻拉一次', listener.includes('requestNotifierRefresh();'));
// 截图抓到过:不在搜索时 show() 只看 visible===null,安卓专属行在桌面上照样渲染。行必须同时按平台筛。
ck('设置页渲染行时按平台筛(不只在搜索时)', settingsSrc.includes("const show = (cat: SettingsCategoryKey, row: string) => onPlatform.has(`${cat}.${row}`) && (visible === null || visible.has(`${cat}.${row}`));"));
ck('会话页有免打扰铃铛;设置页有小米指引与测试通知', chat.includes('testID="chat-mute-toggle"') && settingsSrc.includes('testID="notify-xiaomi-guide"') && settingsSrc.includes('sendTestNotification()'));
const manifest = norm('../modules/anet-keepalive/android/src/main/AndroidManifest.xml');
const service = norm('../modules/anet-keepalive/android/src/main/java/expo/modules/anetkeepalive/AnetKeepAliveService.kt');
const appJson = JSON.parse(norm('../app.json'));
// 安卓 14+:startForeground 的类型必须在清单 <service foregroundServiceType> 里,且要有对应权限,否则崩。
ck('前台服务:清单类型 = 代码里传的类型 = 声明的权限(remoteMessaging)', manifest.includes('android:foregroundServiceType="remoteMessaging"') && service.includes('ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING') && manifest.includes('android.permission.FOREGROUND_SERVICE_REMOTE_MESSAGING') && manifest.includes('android.permission.FOREGROUND_SERVICE"'));
ck('服务不导出;headless 任务名与 JS 登记的一致', manifest.includes('android:exported="false"') && service.includes('const val TASK_NAME = "AnetKeepAlive"') && norm('keep-alive.ts').includes("export const KEEPALIVE_TASK_NAME = 'AnetKeepAlive';"));
ck('app.json:POST_NOTIFICATIONS 与前台服务权限都声明了,expo-notifications 插件已挂', ['android.permission.POST_NOTIFICATIONS', 'android.permission.FOREGROUND_SERVICE', 'android.permission.FOREGROUND_SERVICE_REMOTE_MESSAGING'].every(x => appJson.expo.android.permissions.includes(x)) && appJson.expo.plugins.some((x: any) => Array.isArray(x) && x[0] === 'expo-notifications'));

// iOS 只发本地通知,描述文件没有推送能力:expo-notifications 插件会写 aps-environment,我们的插件要排在它前面把它删掉
// (Expo 先执行后登记的插件的 entitlements mod)。
const plugins: any[] = appJson.expo.plugins;
const idx = (name: string) => plugins.findIndex(x => (Array.isArray(x) ? x[0] : x) === name);
ck('iOS:去 aps-environment 的插件排在 expo-notifications 之前', idx('./plugins/with-no-aps-environment') >= 0 && idx('./plugins/with-no-aps-environment') < idx('expo-notifications') && norm('../plugins/with-no-aps-environment.js').includes("delete cfg.modResults['aps-environment']"));

console.log(`\n${p}/${t} passed`); process.exit(p === t ? 0 : 1);
