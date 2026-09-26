// 0.2.108 安卓通知渠道:0.2.107 的「Agent 消息」渠道建出来没有声音(小米/HyperOS 实机:声音=无)。
// 渠道的声音/重要性建好后应用改不动,只能换 id —— 这里钉住:有声渠道显式带默认提示音 + 高重要性、
// 旧 id 被删且再也不被任何发通知的路径用到、静默渠道仍然静默、前台服务渠道低重要性。
// ck 式自执行脚本(不是 bun:test)。
import fs from 'node:fs';
import path from 'node:path';
import {
  accumulate,
  KEEPALIVE_CHANNEL_ID,
  LEGACY_CHANNEL_IDS,
  MESSAGE_CHANNEL,
  MESSAGE_CHANNEL_ID,
  MESSAGE_CHANNEL_NAME,
  NOTIFICATION_CHANNELS,
  QUIET_CHANNEL,
  QUIET_CHANNEL_ID,
  setupAndroidChannels,
  toExpoChannelInput,
  type ChannelEnums,
} from './mobile-notify-model';
import { XIAOMI_GUIDE_DND_LINE, XIAOMI_GUIDE_STEPS } from './xiaomi-guide';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log('✅', n); } else console.log('❌', n); };
const norm = (f: string) => fs.readFileSync(path.join(__dirname, f), 'utf8').replace(/\r\n?/g, '\n');

// 与 expo-notifications 56 的枚举数值相同(NotificationChannelManager.types.d.ts)。
const enums: ChannelEnums = {
  AndroidImportance: { UNKNOWN: 0, UNSPECIFIED: 1, NONE: 2, MIN: 3, LOW: 4, DEFAULT: 5, HIGH: 6, MAX: 7 },
  AndroidNotificationVisibility: { UNKNOWN: 0, PUBLIC: 1, PRIVATE: 2, SECRET: 3 },
  AndroidAudioUsage: { NOTIFICATION: 5 },
  AndroidAudioContentType: { SONIFICATION: 4 },
};

// ── 1. 有声渠道 ──
const msg = toExpoChannelInput(MESSAGE_CHANNEL, enums);
// 🔴 0.2.107 的缺陷本身:不带 sound 键 → expo 不调 setSound,HyperOS 上渠道是「声音:无」。
ck('有声渠道显式带 sound: "default"(键必须存在)', 'sound' in msg && msg.sound === 'default');
ck('有声渠道重要性 HIGH 或 MAX(悬浮横幅)', msg.importance === 6 || msg.importance === 7);
ck('有声渠道带 audioAttributes(usage=NOTIFICATION)', (msg.audioAttributes as any)?.usage === 5 && (msg.audioAttributes as any)?.contentType === 4);
ck('有声渠道振动开、有振动节奏', msg.enableVibrate === true && Array.isArray(msg.vibrationPattern) && (msg.vibrationPattern as number[]).length > 0);
ck('有声渠道锁屏可见性 = PRIVATE(与 0.2.107 设置一致)', msg.lockscreenVisibility === 2);
ck('默认(「免打扰时仍然提醒」关)不绕过勿扰模式', msg.bypassDnd === false);
ck('「免打扰时仍然提醒」开 → 有声渠道 bypassDnd=true', toExpoChannelInput(MESSAGE_CHANNEL, enums, { bypassDnd: true }).bypassDnd === true);
ck('静默渠道即使开了也不绕过勿扰', toExpoChannelInput(QUIET_CHANNEL, enums, { bypassDnd: true }).bypassDnd === false);
ck('用户看到的名字仍是「Agent 消息」', msg.name === 'Agent 消息' && MESSAGE_CHANNEL_NAME === 'Agent 消息');

// ── 2. 静默渠道 ──
const quiet = toExpoChannelInput(QUIET_CHANNEL, enums);
ck('静默渠道 sound 显式为 null(键存在,= setSound(null))', 'sound' in quiet && quiet.sound === null);
ck('静默渠道 LOW:看得到、不响不弹', quiet.importance === 4);
ck('静默渠道不振动、没有 audioAttributes', quiet.enableVibrate === false && quiet.vibrationPattern === null && !('audioAttributes' in quiet));

// ── 3. id 与迁移 ──
ck('有声渠道换了新 id(不是 0.2.107 的 agent-messages)', MESSAGE_CHANNEL_ID !== 'agent-messages' && MESSAGE_CHANNEL.id === MESSAGE_CHANNEL_ID);
ck('旧 id 在待删列表里(0.2.107 的 agent-messages + 0.2.108 的 agent-messages-v2)', LEGACY_CHANNEL_IDS.includes('agent-messages') && LEGACY_CHANNEL_IDS.includes('agent-messages-v2'));
ck('建的渠道里没有任何旧 id(删了再用同 id 重建会恢复无声设置)', NOTIFICATION_CHANNELS.every(c => !LEGACY_CHANNEL_IDS.includes(c.id)));
ck('渠道 id 互不相同,且不撞前台服务渠道', new Set([...NOTIFICATION_CHANNELS.map(c => c.id), KEEPALIVE_CHANNEL_ID]).size === NOTIFICATION_CHANNELS.length + 1);

const calls: string[] = [];
const created: Record<string, any> = {};
await setupAndroidChannels({
  enums,
  set: async (id, input) => { calls.push(`set:${id}`); created[id] = input; },
  del: async id => { calls.push(`del:${id}`); },
});
ck('setup:建有声 + 静默两条渠道', !!created[MESSAGE_CHANNEL_ID] && !!created[QUIET_CHANNEL_ID] && created[MESSAGE_CHANNEL_ID].sound === 'default');
ck('setup:删掉旧 agent-messages', calls.includes('del:agent-messages'));
ck('setup:从不用旧 id 建渠道', !calls.some(c => LEGACY_CHANNEL_IDS.some(id => c === `set:${id}`)));
ck('setup:先建后删', calls.indexOf('del:agent-messages') > calls.indexOf(`set:${MESSAGE_CHANNEL_ID}`));
let threw = false;
try {
  await setupAndroidChannels({ enums, set: async () => {}, del: async () => { throw new Error('no such channel'); } });
} catch { threw = true; }
ck('setup:删旧渠道失败不抛(不影响新渠道)', !threw);

// ── 4. 所有发通知的路径都用新 id ──
const loud = accumulate({}, [{ agent: 'B', count: 1, body: 'x' }], { mode: 'all', profileKey: 'p', sound: true });
const q1 = accumulate({}, [{ agent: 'B', count: 1, body: 'x' }], { mode: 'new', profileKey: 'p', sound: true });
const q2 = accumulate(q1.buckets, [{ agent: 'B', count: 1, body: 'y' }], { mode: 'new', profileKey: 'p', sound: true });
const off = accumulate({}, [{ agent: 'B', count: 1, body: 'x' }], { mode: 'all', profileKey: 'p', sound: false });
ck('消息通知(响)走新 id', loud.posts[0].channelId === MESSAGE_CHANNEL_ID && loud.posts[0].channelId === 'agent-messages-v3');
ck('仅新消息的后续 / 提示音关 → 静默渠道', q2.posts[0].channelId === QUIET_CHANNEL_ID && off.posts[0].channelId === QUIET_CHANNEL_ID);
ck('没有任何发出的通知落在旧 id 上', [loud, q1, q2, off].every(a => a.posts.every(x => !LEGACY_CHANNEL_IDS.includes(x.channelId))));

const runtime = norm('notifier-runtime.ts'), notifications = norm('mobile-notifications.ts');
ck('测试通知走 MESSAGE_CHANNEL_ID', /sendTestNotification[\s\S]*channelId: MESSAGE_CHANNEL_ID/.test(runtime));
ck('postNotification 用计划里的 channelId(不写死)', notifications.includes('trigger: Platform.OS === \'android\' ? { channelId: plan.channelId } : null'));
ck('mobile-notifications 建渠道只经 setupAndroidChannels,且接了 delete', notifications.includes('await setupAndroidChannels({') && notifications.includes('N.deleteNotificationChannelAsync(id)') && (notifications.match(/setNotificationChannelAsync\(/g) || []).length === 1);

// 全仓(src + 原生模块)扫字面量 'agent-messages' / "agent-messages":只准出现在待删列表那一行。
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== 'build') out.push(...walk(f)); }
    else if (/\.(ts|tsx|kt|java|js|mjs|json|xml)$/.test(e.name) && !e.name.endsWith('.test.ts')) out.push(f);
  }
  return out;
}
const roots = [__dirname, path.join(__dirname, '../modules'), path.join(__dirname, '../plugins')].filter(d => fs.existsSync(d));
const scanned = roots.flatMap(walk);
const hits = scanned.flatMap(f => fs.readFileSync(f, 'utf8').split('\n')
  .map((line, i) => ({ f, i, line }))
  .filter(x => /['"]agent-messages(-v2)?['"]/.test(x.line) && !x.line.trimStart().startsWith('*') && !x.line.trimStart().startsWith('//')));
ck(`扫描取集非空(${scanned.length} 个文件,含原生前台服务)`, scanned.length > 20 && scanned.some(f => f.endsWith('AnetKeepAliveService.kt')));
ck('旧 id 字面量只出现在 LEGACY_CHANNEL_IDS', hits.length === 1 && hits[0].line.includes('LEGACY_CHANNEL_IDS'));

// ── 5. 前台服务渠道 ──
const service = norm('../modules/anet-keepalive/android/src/main/java/expo/modules/anetkeepalive/AnetKeepAliveService.kt');
ck('前台服务渠道 id 与 JS 常量一致', service.includes(`const val CHANNEL_ID = "${KEEPALIVE_CHANNEL_ID}"`));
ck('前台服务渠道 IMPORTANCE_LOW(不响)', /NotificationChannel\(CHANNEL_ID, [^)]*NotificationManager\.IMPORTANCE_LOW\)/.test(service) && !/IMPORTANCE_(HIGH|MAX|DEFAULT)/.test(service));
ck('前台服务不引用消息渠道', !service.includes('agent-messages'));

// ── 6. 小米指引:勿扰模式 ──
ck('小米指引有勿扰模式一条,说明去「例外应用」加', XIAOMI_GUIDE_STEPS.some(s => s.detail === XIAOMI_GUIDE_DND_LINE) && XIAOMI_GUIDE_DND_LINE.includes('勿扰模式 → 例外应用') && XIAOMI_GUIDE_DND_LINE.includes('Agent Network'));

console.log(`\n${p}/${t} passed`); process.exit(p === t ? 0 : 1);
