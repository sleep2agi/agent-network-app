// 节点页「运行日志」的纯逻辑(只读)。
//
// 节点把自己 agent-node 的运行日志末尾脱敏后回来(主仓 agent-node/src/runtime/node-logs.ts),
// 走规则文件同一条门铃:
//   tail_node_logs {lines, level?, grep?, since_ts?} → get_rules_file_result.content =
//   JSON {files, lines:[{ts, level, text, key}], truncated, matched, now_ts}
// 🔴 请求里没有路径:读哪个文件由节点自己定;脱敏在节点上做完才离开节点。hub 把结果交给发起请求的
//    那个登录**一次**,读完即删 —— 所以这里的「实时跟随」每一轮都是一个新请求,不去跟别人的请求。
// 纯逻辑,不 import react-native。

import type { RulesTarget, Session } from './api';
import { isAgentNodeSession } from './node-rules';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogLevelFilter = 'all' | 'info' | 'warn' | 'error';

export interface LogLine {
  ts: number | null;
  level: LogLevel | null;
  text: string;
  /** `<文件名>:<字节偏移>`,实时跟随去重用。 */
  key: string;
}

export interface LogsTail {
  files: string[];
  lines: LogLine[];
  truncated: boolean;
  matched: number;
  now_ts: number | null;
}

/** 一次要多少行(节点上限 2000)。 */
export const LOGS_LINES = 500;
/** 实时跟随时内存里最多留这么多行,再多就丢最早的。 */
export const LOGS_KEEP_MAX = 2000;
export const LOGS_FOLLOW_MS = 3_000;
export const LOGS_GREP_MAX = 200;
export const LOGS_SEARCH_DEBOUNCE_MS = 400;

export const LOG_LEVEL_CHIPS: readonly { key: LogLevelFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'info', label: '信息' },
  { key: 'warn', label: '警告' },
  { key: 'error', label: '错误' },
];

export const LOGS_OLD_NODE_MESSAGE = '节点版本过旧，升级后可查看日志';
export const LOGS_OLD_HUB_MESSAGE = '服务器版本过旧，升级后可查看日志';

/**
 * 能不能答 —— 只认 logs_capable(节点上报的粘性能力位),没有就不发请求、当场说为什么。
 *  - /api/status 里压根没有 logs_capable 这个键 ⇒ 服务器旧;
 *  - 其余(agent-node 旧、没重连、或者根本不是 agent-node)⇒ 节点旧。
 */
export type LogsSupport = { kind: 'capable' } | { kind: 'unsupported'; component: 'hub' | 'node'; message: string };

export function logsSupport(session: (Pick<Session, 'agent'> & { logs_capable?: boolean }) | null | undefined): LogsSupport {
  if (session?.logs_capable === true) return { kind: 'capable' };
  if (!session || !('logs_capable' in session)) return { kind: 'unsupported', component: 'hub', message: LOGS_OLD_HUB_MESSAGE };
  if (!isAgentNodeSession(session) && typeof session.agent === 'string' && session.agent.toLowerCase() === 'claude-code') {
    return { kind: 'unsupported', component: 'node', message: 'Claude Code 会话没有 agent-node 运行日志' };
  }
  return { kind: 'unsupported', component: 'node', message: LOGS_OLD_NODE_MESSAGE };
}

/** 请求发给谁:有 nodes 行按 node_id,没有按 alias。只在 capable 时有目标。 */
export function logsTarget(args: {
  node: Pick<RulesTarget, 'node_id' | 'alias' | 'runtime'> | null | undefined;
  session: (Pick<Session, 'alias'> & { logs_capable?: boolean }) | null | undefined;
}): RulesTarget | null {
  const { node, session } = args;
  if (session?.logs_capable !== true) return null;
  if (node?.node_id) return { node_id: node.node_id, alias: node.alias, runtime: node.runtime ?? null };
  return session.alias ? { alias: session.alias } : null;
}

/** 发给 hub 的过滤参数。空搜索不带 grep;搜索词截到 200 字。 */
export function logsQuery(input: { level: LogLevelFilter; search: string; sinceTs?: number | null; lines?: number }): { lines: number; level?: 'info' | 'warn' | 'error'; grep?: string; since_ts?: number } {
  const grep = input.search.trim().slice(0, LOGS_GREP_MAX);
  return {
    lines: input.lines ?? LOGS_LINES,
    ...(input.level !== 'all' ? { level: input.level } : {}),
    ...(grep ? { grep } : {}),
    ...(typeof input.sinceTs === 'number' && input.sinceTs > 0 ? { since_ts: input.sinceTs } : {}),
  };
}

const LEVELS = new Set(['debug', 'info', 'warn', 'error']);

/** 只要文件名(节点给的本来就是文件名;防御:反斜杠当分隔符、取最后一段)。 */
export function logFileBase(name: string): string {
  const posix = name.replace(/\\/g, '/');
  return posix.slice(posix.lastIndexOf('/') + 1);
}

/** `<文件>:<偏移>` 里的文件部分只留文件名(POSIX 化),偏移原样。 */
export function normalizeLogKey(key: string): string {
  const i = key.lastIndexOf(':');
  return i < 0 ? logFileBase(key) : `${logFileBase(key.slice(0, i))}${key.slice(i)}`;
}

/** hub 的 content → 结构;认不出返回 null。行文本 CRLF → LF,去掉行尾 \r。 */
export function parseLogsTail(content: unknown): LogsTail | null {
  if (typeof content !== 'string') return null;
  let raw: any;
  try { raw = JSON.parse(content); } catch { return null; }
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.lines)) return null;
  const lines: LogLine[] = [];
  for (const l of raw.lines) {
    if (!l || typeof l.text !== 'string' || typeof l.key !== 'string') continue;
    lines.push({
      ts: typeof l.ts === 'number' && Number.isFinite(l.ts) ? l.ts : null,
      level: typeof l.level === 'string' && LEVELS.has(l.level) ? (l.level as LogLevel) : null,
      text: l.text.replace(/\r\n?/g, '\n').replace(/\n$/, ''),
      key: normalizeLogKey(l.key),
    });
  }
  return {
    files: Array.isArray(raw.files) ? raw.files.filter((f: unknown): f is string => typeof f === 'string').map(logFileBase) : [],
    lines,
    truncated: raw.truncated === true,
    matched: typeof raw.matched === 'number' ? raw.matched : lines.length,
    now_ts: typeof raw.now_ts === 'number' ? raw.now_ts : null,
  };
}

/** 实时跟随:新来的按 key 去重后接在后面,总数超过 max 丢最早的。没有新行时返回原数组(引用不变,不重渲染)。 */
export function mergeFollow(existing: readonly LogLine[], incoming: readonly LogLine[], max = LOGS_KEEP_MAX): LogLine[] {
  const seen = new Set(existing.map(l => l.key));
  const fresh = incoming.filter(l => !seen.has(l.key) && (seen.add(l.key), true));
  if (!fresh.length) return existing as LogLine[];
  const all = [...existing, ...fresh];
  return all.length > max ? all.slice(all.length - max) : all;
}

/** 下一轮 since_ts:最后一行的时间(同一秒的行会再回来一次,靠 key 去重);没有行就用节点时钟。 */
export function nextSinceTs(lines: readonly LogLine[], nodeNow: number | null): number | null {
  for (let i = lines.length - 1; i >= 0; i--) if (typeof lines[i].ts === 'number') return lines[i].ts;
  return nodeNow;
}

export type LineTone = 'error' | 'warn' | 'normal';
export function lineTone(level: LogLevel | null): LineTone {
  return level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'normal';
}

/** 复制 / 导出的正文:一行一条,LF,结尾一个换行。 */
export function logsText(lines: readonly LogLine[]): string {
  return lines.length ? `${lines.map(l => l.text).join('\n')}\n` : '';
}

/** 导出文件名:<别名>-YYYYMMDD-HHMMSS.log(本机时区);别名里文件系统不认的字符换成 _。 */
export function logsExportName(alias: string, now: Date = new Date()): string {
  const safe = alias.replace(/[\\/:*?"<>|\s\u0000-\u001f]+/g, '_').replace(/^\.+/, '').slice(0, 60) || 'node';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${safe}-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}.log`;
}

/** 终态 → 给人看的一句话(done 以外)。 */
export function logsStatusMessage(status: string, error: string | null | undefined): string {
  if (status === 'failed') return `节点读取日志失败：${error || '未知原因'}`;
  if (status === 'timeout') return '节点没有响应（可能离线）';
  if (status === 'pending' || status === 'in_progress') return '正在等节点回传日志…';
  return `服务器返回了认不出的状态「${status}」`;
}

/** hub 在发请求这一步就拒绝时的错误码 → 人话。 */
export function logsEnqueueError(error: string | null | undefined): string {
  switch (error) {
    case 'logs_permission_denied': return '只有节点的所有者或网络管理员可以查看运行日志';
    case 'node_token_cannot_read_logs': return '请用用户账号登录后查看运行日志';
    case 'logs_target_not_found': return LOGS_OLD_NODE_MESSAGE;
    case 'cross_network_node': return '这个节点不属于当前网络';
    case 'node_not_found': return '服务器上找不到这个节点';
    default: return error || '请求失败';
  }
}

/** 空状态的说明:过滤了但没命中 vs 节点本来就没写日志。 */
export function logsEmptyMessage(input: { files: number; level: LogLevelFilter; search: string }): string {
  if (input.files === 0) return '节点还没有写运行日志';
  if (input.level !== 'all' || input.search.trim()) return '没有匹配的日志行';
  return '日志是空的';
}
