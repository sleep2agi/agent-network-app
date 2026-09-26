// 0.2.108 通知诊断:0.2.107 的手机通知链路上每一个出错点都被 `catch(() => {})` 吞掉,实机没弹的时候
// 只能靠猜(Vincent:勿扰开着、渠道没声音、到底有没有在拉 —— 都看不见)。这里把运行时每一步的
// 真实状态记下来,设置 → 通知 →「通知诊断」显示,并能一键复制给人看。
//
// 纯模块(不 import react-native / expo),正式包里照样工作(不是 dev-only)。
// 写入方:notifier-runtime.ts(轮询/判定/发送)、设置页(权限/渠道/勿扰的现场读数)。

export type DecisionOutcome =
  | 'notified'
  | 'viewing'
  | 'muted'
  | 'master_off'
  | 'quiet_hours'
  | 'not_new'
  | 'stale'
  | 'baseline'
  | 'no_permission'
  | 'error';

export type LastDecision = {
  at: number;
  agent: string;
  outcome: DecisionOutcome;
  /** 任务通知时带上:done / failed。 */
  kind?: 'message' | 'task_done' | 'task_failed';
  detail?: string;
};

export type ChannelReading = { id: string; exists: boolean; importance?: number | null; sound?: string | null; bypassDnd?: boolean | null };

export type NotifyDiagnostics = {
  platform: string;
  runtimeRunning: boolean;
  runtimeStartedAt: number | null;
  profileKey: string;
  setupOk: boolean | null;
  setupError: string | null;
  baselineReady: boolean;
  lastPollAt: number | null;
  lastPollResult: { user: number | null; inbox: number | null; tasks: number | null; error: string | null } | null;
  lastDecision: LastDecision | null;
  postedCount: number;
  lastPostedAt: number | null;
  lastError: { at: number; message: string } | null;
  permission: string | null;
  channels: ChannelReading[] | null;
  dndAccess: boolean | null;
  interruptionFilter: number | null;
  keepAliveSetting: boolean | null;
  keepAliveRunning: boolean | null;
  keepAliveTaskActive: boolean | null;
  appState: string | null;
};

const initial = (): NotifyDiagnostics => ({
  platform: '',
  runtimeRunning: false,
  runtimeStartedAt: null,
  profileKey: '',
  setupOk: null,
  setupError: null,
  baselineReady: false,
  lastPollAt: null,
  lastPollResult: null,
  lastDecision: null,
  postedCount: 0,
  lastPostedAt: null,
  lastError: null,
  permission: null,
  channels: null,
  dndAccess: null,
  interruptionFilter: null,
  keepAliveSetting: null,
  keepAliveRunning: null,
  keepAliveTaskActive: null,
  appState: null,
});

let state: NotifyDiagnostics = initial();
const listeners = new Set<() => void>();

export function getNotifyDiagnostics(): NotifyDiagnostics {
  return state;
}

export function subscribeNotifyDiagnostics(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function patchNotifyDiagnostics(patch: Partial<NotifyDiagnostics>): void {
  state = { ...state, ...patch };
  for (const l of listeners) { try { l(); } catch { /* 诊断不能打断主流程 */ } }
}

export function recordDecision(d: Omit<LastDecision, 'at'>, at = Date.now()): void {
  patchNotifyDiagnostics({ lastDecision: { ...d, at } });
}

export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message || e.name;
  return String(e);
}

export function recordError(e: unknown, where: string, at = Date.now()): void {
  patchNotifyDiagnostics({ lastError: { at, message: `${where}: ${errorText(e)}` } });
}

export function resetNotifyDiagnosticsForTest(): void {
  state = initial();
}

const OUTCOME_TEXT: Record<DecisionOutcome, string> = {
  notified: '已通知',
  viewing: '未通知:正在看这个会话',
  muted: '未通知:这个 agent 设了消息免打扰',
  master_off: '未通知:「新消息通知」总开关关着',
  quiet_hours: '未通知:在免打扰时段内',
  not_new: '未通知:不是新消息(已见过)',
  stale: '未通知:消息超过 10 分钟才拉到(应用在后台被暂停?)',
  baseline: '未通知:启动时已存在的消息只登记',
  no_permission: '未通知:没有系统通知权限',
  error: '出错',
};

export function outcomeText(d: LastDecision): string {
  const base = OUTCOME_TEXT[d.outcome] ?? d.outcome;
  return d.outcome === 'error' && d.detail ? `${base}:${d.detail}` : base;
}

/** Android NotificationManager.getCurrentInterruptionFilter():1=关,2=仅优先,3=完全静音,4=仅闹钟。 */
export function interruptionFilterText(f: number | null): string {
  switch (f) {
    case 1: return '关(正常提醒)';
    case 2: return '开 · 仅优先事项';
    case 3: return '开 · 完全静音';
    case 4: return '开 · 仅闹钟';
    case null: return '未知';
    default: return `未知(${f})`;
  }
}

const hhmmss = (ms: number | null): string => {
  if (!ms) return '—';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const yn = (v: boolean | null) => (v === null ? '未知' : v ? '是' : '否');

/** 诊断面板的行(标签, 值, 是否告警)。面板和「复制诊断信息」用同一份,不会两边说法不同。 */
export function diagnosticsRows(d: NotifyDiagnostics, now = Date.now()): Array<{ label: string; value: string; warn: boolean }> {
  const rows: Array<{ label: string; value: string; warn: boolean }> = [];
  const add = (label: string, value: string, warn = false) => rows.push({ label, value, warn });
  add('平台', d.platform || '—');
  add('通知运行时', d.runtimeRunning ? `运行中(自 ${hhmmss(d.runtimeStartedAt)})` : '未运行', !d.runtimeRunning);
  add('系统通知权限', d.permission ?? '未知', d.permission !== null && d.permission !== 'granted');
  if (d.channels) {
    for (const c of d.channels) {
      add(`渠道 ${c.id}`, c.exists ? `存在 · 重要性 ${c.importance ?? '?'} · 声音 ${c.sound ?? '无'} · 绕过勿扰 ${c.bypassDnd === null || c.bypassDnd === undefined ? '?' : c.bypassDnd ? '是' : '否'}` : '不存在', !c.exists);
    }
  }
  add('勿扰模式', interruptionFilterText(d.interruptionFilter), d.interruptionFilter !== null && d.interruptionFilter > 1);
  add('勿扰权限(免打扰时仍提醒)', d.dndAccess === null ? '未知' : d.dndAccess ? '已授予' : '未授予', d.dndAccess === false && d.interruptionFilter !== null && d.interruptionFilter > 1);
  add('渠道初始化', d.setupOk === null ? '—' : d.setupOk ? '成功' : `失败:${d.setupError ?? ''}`, d.setupOk === false);
  add('首份快照已登记', yn(d.baselineReady));
  const ago = d.lastPollAt ? `${Math.max(0, Math.round((now - d.lastPollAt) / 1000))} 秒前` : '从未';
  add('上次拉取', d.lastPollAt ? `${hhmmss(d.lastPollAt)}(${ago})` : '从未', !d.lastPollAt || now - d.lastPollAt > 120_000);
  if (d.lastPollResult) {
    const n = (v: number | null) => (v === null ? '失败' : String(v));
    add('拉取结果', `user_inbox ${n(d.lastPollResult.user)} 条 · inbox ${n(d.lastPollResult.inbox)} 条 · 任务 ${n(d.lastPollResult.tasks)} 条${d.lastPollResult.error ? ` · 错误:${d.lastPollResult.error}` : ''}`, !!d.lastPollResult.error);
  }
  add('上次判定', d.lastDecision ? `${hhmmss(d.lastDecision.at)} ${d.lastDecision.agent} — ${outcomeText(d.lastDecision)}` : '—', !!d.lastDecision && d.lastDecision.outcome !== 'notified');
  add('已发通知', `${d.postedCount} 条(最近 ${hhmmss(d.lastPostedAt)})`);
  add('后台保持连接', `设置 ${yn(d.keepAliveSetting)} · 服务在跑 ${yn(d.keepAliveRunning)} · 后台任务 ${yn(d.keepAliveTaskActive)}`, d.platform === 'android' && d.keepAliveSetting === false);
  if (d.platform === 'android' && d.keepAliveSetting === false) add('提示', '后台保持连接关着:锁屏或切到后台后不会拉消息,也就不会提醒', true);
  add('应用状态', d.appState ?? '—');
  add('最近错误', d.lastError ? `${hhmmss(d.lastError.at)} ${d.lastError.message}` : '无', !!d.lastError);
  return rows;
}

export function formatDiagnostics(d: NotifyDiagnostics, header: string, now = Date.now()): string {
  return [header, `时间 ${hhmmss(now)}`, ...diagnosticsRows(d, now).map(r => `${r.warn ? '⚠ ' : ''}${r.label}:${r.value}`)].join('\n');
}
