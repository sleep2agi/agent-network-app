// notifier-runtime 端到端测试的假边界(不是测试文件本身;*.test.ts 才会被 run-tests 执行)。
// 跑**真的** notifier-runtime.ts,只把边界换成假的:react-native(AppState/Platform/AppRegistry)、
// expo-notifications、expo-file-system、前台服务原生模块、hub 读接口(api.ts)、计时器和时钟。
// hub 的行形状照抄 agent-network server.ts:
//   alias 分支  SELECT id, session_name as to_alias, from_session as from_alias, type, priority, content, acked, created_at, network_id
//   scope=user  message_id/from_session/kind/title/content/acked/created_at + unread_by_agent
//   /api/tasks  task_id/from_name/to_name/content/result/status/created_at/updated_at/completed_at
// 必须在 import notifier-runtime 之前 import 本模块(mock.module 要先登记)。
import { mock } from 'bun:test';

export const H = {
  now: Date.parse('2026-09-26T01:10:00Z'),
  timers: [] as Array<{ id: number; at: number; ms: number; fn: () => void }>,
  appState: 'active' as 'active' | 'background',
  posted: [] as Array<{ identifier: string; content: any; trigger: any }>,
  channels: new Map<string, any>(),
  deletedChannels: [] as string[],
  channelSets: [] as Array<{ id: string; input: any }>,
  scheduleError: null as Error | null,
  permission: 'granted' as string,
  handlerSet: false,
  keepAliveNativeRunning: false,
  dndAccess: false as boolean,
  interruptionFilter: 2,
  inboxRows: [] as any[],
  userRows: [] as any[],
  tasks: [] as any[],
  userScopeFails: false,
  headless: null as (() => Promise<void>) | null,
  intents: [] as string[],
};
export const USER = 'admin';

let nextId = 1;
Date.now = () => H.now;
const realSetTimeout = globalThis.setTimeout;
(globalThis as any).setTimeout = (fn: () => void, ms = 0) => { const id = nextId++; H.timers.push({ id, at: H.now + ms, ms, fn }); return id; };
(globalThis as any).clearTimeout = (id: number) => { H.timers = H.timers.filter(x => x.id !== id); };
export const flush = async () => { for (let i = 0; i < 30; i++) await new Promise(r => realSetTimeout(r, 0)); };
export async function advance(ms: number) {
  const until = H.now + ms;
  for (;;) {
    H.timers.sort((a, b) => a.at - b.at);
    const next = H.timers[0];
    if (!next || next.at > until) break;
    H.timers.shift();
    H.now = next.at;
    next.fn();
    await flush();
  }
  H.now = until;
  await flush();
}
export const hubTs = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);

const appListeners = new Set<(s: string) => void>();
const rn = {
  Platform: { OS: 'android' },
  AppState: {
    get currentState() { return H.appState; },
    addEventListener: (_: string, fn: (s: string) => void) => { appListeners.add(fn); return { remove: () => appListeners.delete(fn) }; },
  },
  AppRegistry: { registerHeadlessTask: (_: string, f: () => () => Promise<void>) => { H.headless = f(); } },
};
mock.module('react-native', () => rn);
export async function setAppState(s: 'active' | 'background') { H.appState = s; for (const l of appListeners) l(s); await flush(); }

mock.module('expo-notifications', () => ({
  AndroidImportance: { UNKNOWN: 0, UNSPECIFIED: 1, NONE: 2, MIN: 3, LOW: 4, DEFAULT: 5, HIGH: 6, MAX: 7 },
  AndroidNotificationVisibility: { UNKNOWN: 0, PUBLIC: 1, PRIVATE: 2, SECRET: 3 },
  AndroidAudioUsage: { NOTIFICATION: 5 },
  AndroidAudioContentType: { SONIFICATION: 4 },
  setNotificationHandler: () => { H.handlerSet = true; },
  setNotificationChannelAsync: async (id: string, input: any) => {
    H.channelSets.push({ id, input });
    const prev = H.channels.get(id);
    // AOSP:没有勿扰权限时 bypassDnd 被忽略(新建 = false,已有 = 不变)。
    const bypassDnd = H.dndAccess ? !!input.bypassDnd : (prev ? prev.bypassDnd : false);
    H.channels.set(id, { id, ...input, sound: input.sound === undefined ? 'default' : input.sound, bypassDnd });
    return H.channels.get(id);
  },
  deleteNotificationChannelAsync: async (id: string) => { H.deletedChannels.push(id); H.channels.delete(id); },
  getNotificationChannelAsync: async (id: string) => H.channels.get(id) ?? null,
  getPermissionsAsync: async () => ({ status: H.permission, canAskAgain: true }),
  requestPermissionsAsync: async () => ({ status: H.permission }),
  scheduleNotificationAsync: async (req: any) => {
    if (H.scheduleError) throw H.scheduleError;
    if (req.trigger?.channelId && !H.channels.has(req.trigger.channelId)) throw new Error(`channel ${req.trigger.channelId} does not exist`);
    H.posted.push(req);
    return req.identifier;
  },
  dismissNotificationAsync: async () => {},
  addNotificationResponseReceivedListener: () => ({ remove: () => {} }),
  getLastNotificationResponse: () => null,
  clearLastNotificationResponse: () => {},
}));
mock.module('expo-file-system/legacy', () => ({
  documentDirectory: null,
  getInfoAsync: async () => ({ exists: false }),
  readAsStringAsync: async () => '',
  writeAsStringAsync: async () => {},
}));
mock.module('expo', () => ({
  requireOptionalNativeModule: () => ({
    start: () => { H.keepAliveNativeRunning = true; return null; },
    stop: () => { H.keepAliveNativeRunning = false; },
    isRunning: () => H.keepAliveNativeRunning,
    isNotificationPolicyAccessGranted: () => H.dndAccess,
    currentInterruptionFilter: () => H.interruptionFilter,
  }),
}));
mock.module('expo-intent-launcher', () => ({ startActivityAsync: async (action: string) => { H.intents.push(action); } }));
mock.module('../storage', () => ({ loadConfig: async () => null }));

mock.module('../api', () => ({
  fetchUserMessages: async () => {
    if (H.userScopeFails) throw new Error('HTTP 404');
    const byAgent: Record<string, number> = {};
    for (const m of H.userRows) if (!m.acked) byAgent[m.from_session] = (byAgent[m.from_session] ?? 0) + 1;
    for (const r of H.inboxRows) if (r.to_alias === USER && !r.acked) byAgent[r.from_alias] = (byAgent[r.from_alias] ?? 0) + 1;
    return { ok: true, messages: H.userRows.slice(), unread: H.userRows.filter(m => !m.acked).length, pending_count: 0, unread_by_agent: byAgent, unread_total: 0 };
  },
  fetchMessages: async () => ({ ok: true, messages: H.inboxRows.slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1)) }),
  fetchTasks: async (_c: unknown, q: { from_name?: string }) => ({ ok: true, tasks: H.tasks.filter(x => !q.from_name || x.from_name === q.from_name).slice() }),
  replyUnreadSince: () => hubTs(H.now - 7 * 86400_000),
}));

let rowSeq = 1;
/** agent 对 admin 任务的回复:inbox 表一行(session_name=admin, from_session=agent, type=reply)。 */
export function agentReply(agent: string, content: string, at = H.now) {
  const row = { id: `ib-${rowSeq++}`, to_alias: USER, from_alias: agent, type: 'reply', priority: 'normal', content, acked: 0, created_at: hubTs(at), network_id: 'net-1' };
  H.inboxRows.push(row);
  return row;
}
export function desktopMessage(agent: string, content: string, at = H.now) {
  const row = { message_id: `um-${rowSeq++}`, network_id: 'net-1', user_id: 'u1', from_session: agent, kind: 'agent_message', title: null, content, severity: 'info', meta_json: null, acked: 0, created_at: hubTs(at), acked_at: null };
  H.userRows.push(row);
  return row;
}
export function task(agent: string, content: string, status = 'delivered') {
  const row = { task_id: `task-${rowSeq++}`, from_name: USER, to_name: agent, content, result: '', status, created_at: hubTs(H.now), updated_at: hubTs(H.now), completed_at: null as string | null };
  H.tasks.push(row);
  return row;
}
export function finishTask(row: any, status: string) {
  row.status = status;
  row.updated_at = hubTs(H.now);
  row.completed_at = hubTs(H.now);
}

export const CFG = { serverUrl: 'https://hub.example', token: 'tok', username: USER, profileId: 'p1', networkId: 'net-1' } as any;

export function makeCk() {
  let p = 0, t = 0;
  const ck = (n: string, c: boolean, extra?: unknown) => { t++; if (c) { p++; console.log('✅', n); } else console.log('❌', n, extra === undefined ? '' : JSON.stringify(extra)); };
  const done = () => { console.log(`\n${p}/${t} passed`); process.exit(p === t && t > 0 ? 0 : 1); };
  return { ck, done };
}
