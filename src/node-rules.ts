// app#225 —— 节点规则文件（CLAUDE.md / AGENTS.md）区块的纯逻辑。
//
// 文件名由**节点**按自己的运行时决定（主仓 agent-node/src/runtime/rules-file.ts），
// 这里的映射只用于「结果还没回来之前先显示一个名字」；节点 ack 里回报的
// file_name 一到就以它为准。两边规则相同：claude 系 → CLAUDE.md，其余 → AGENTS.md。
//
// 🔴 桌面端不传路径、不传文件名 —— hub 工具的入参里根本没有那些字段
//（#225 验收第 5 条）。这个文件里没有任何路径拼接。

import type { HubNode, RulesTarget, Session } from './api';
import { withDeadline } from './deadline';

/**
 * app#225 follow-up —— 规则文件区块显示给谁、请求发给谁。
 *
 *  - 会话上报了 rules_file_capable(hub /api/status):节点**确实会答**门铃 ⇒
 *    详情页和只读「节点信息」页都显示。有 nodes 行就按 node_id 发,没有(claude-code
 *    会话大多如此)就按 alias 发。
 *  - 没上报,但会话是 agent-node 进程(agent 以 `agent-node:` 开头)且有 nodes 行:
 *    agent-node 早就会答规则文件门铃(#225),只是 2.5.0-preview.84 起才上报这个旗 ⇒
 *    详情页和只读页都显示,按 node_id 发(只读页上 Vincent 看不到 通信欧 的 AGENTS.md 就是这条缺口)。
 *  - 其余没上报的(旧 hub / 旧 claude-code 通道):保持原行为 —— 只在可编辑的详情页、且有 nodes 行时显示。
 *  - 再其余:不显示(节点答不了,显示出来只会让人等 60 秒超时)。
 */
export function rulesFileTarget(args: {
  readOnly: boolean;
  node: Pick<HubNode, 'node_id' | 'alias' | 'runtime'> | null | undefined;
  session: Pick<Session, 'alias' | 'rules_file_capable' | 'agent'> | null | undefined;
}): RulesTarget | null {
  const { readOnly, node, session } = args;
  if (node?.node_id && isAgentNodeSession(session)) {
    return { node_id: node.node_id, alias: node.alias, runtime: node.runtime ?? null };
  }
  if (session?.rules_file_capable === true) {
    return node?.node_id
      ? { node_id: node.node_id, alias: node.alias, runtime: node.runtime ?? null }
      : { alias: session.alias };
  }
  if (!readOnly && node?.node_id) return { node_id: node.node_id, alias: node.alias, runtime: node.runtime ?? null };
  return null;
}

/** agent-node 进程在 hub 上的 agent 字段形如 `agent-node:codex` / `agent-node:opencode` /
 *  `agent-node:claude`;纯 `claude-code` 会话不算(它们要 anet ≥ 2.3.0-preview.111 才会答门铃,
 *  那条路靠 rules_file_capable)。 */
export function isAgentNodeSession(session?: Pick<Session, 'agent'> | null): boolean {
  return typeof session?.agent === 'string' && session.agent.toLowerCase().startsWith('agent-node:');
}

export type RulesFileName = 'CLAUDE.md' | 'AGENTS.md';

/** 与 agent-node 的 rulesFileNameForRuntime 同规则；输入可以是 session.runtime /
 *  node.runtime / session.agent 里任何一个，谁先有值用谁。 */
export function predictedRulesFileName(session?: Pick<Session, 'agent' | 'runtime'> | null, node?: Pick<HubNode, 'runtime'> | null): RulesFileName {
  // hub 上 agent-node 进程的 agent 字段带 `agent-node:` 前缀(如 `agent-node:claude`),先剥掉再判。
  const raw = (session?.runtime ?? node?.runtime ?? session?.agent ?? '').toLowerCase().replace(/^agent-node:/, '');
  return raw.startsWith('claude') ? 'CLAUDE.md' : 'AGENTS.md';
}

export type RulesRequestStatus = 'pending' | 'in_progress' | 'done' | 'failed' | 'timeout';

export interface RulesFileResult {
  ok: true;
  request_id: string;
  op: 'read' | 'write';
  status: RulesRequestStatus;
  file_name: string | null;
  exists: boolean | null;
  content?: string;
  error: string | null;
  age_ms: number;
  content_purged?: boolean;
}

/** 只有 pending / in_progress 算「还在等」,其余一律当终态 —— 包括这一版 app 认不出的状态
 *  (hub 以后新增的、或被代理改坏的)。认不出就停下来说清楚,而不是一直转圈等一个永远不会来的 done。 */
export function isTerminal(status: string | null | undefined): boolean {
  return status !== 'pending' && status !== 'in_progress';
}

/** hub 侧把 pending/in_progress 判 timeout 的门槛(server/src/tools.ts RULES_REQUEST_STALE_MS)。 */
export const RULES_HUB_STALE_MS = 60_000;
/** 轮询本身的上限:比 hub 的 60 秒陈旧门槛多一截,hub 判 timeout 后至少还能再问到一次。 */
export const RULES_POLL_MAX_WAIT_MS = 70_000;
/** 区块级兜底:不管 await 链卡在哪(入队、轮询、响应体),转圈超过这么久就停下、给「重新读取」。
 *  独立于 Promise 链的计时器 —— 链卡死时它照样会响。必须大于 hub 60 秒 + 轮询上限的余量。 */
export const RULES_MAX_WAIT_MS = 90_000;

export const RULES_PURGED_MESSAGE = '内容已过期，请点「重新读取」';

export function rulesMaxWaitMessage(): string {
  return `等了 ${RULES_MAX_WAIT_MS / 1000} 秒仍没有拿到结果（节点可能已经回了，但结果没有传到这里），请点「重新读取」`;
}

/** hub 的英文错误码 → 给人看的一句话;认不出原样返回。'cancelled' 是本地卸载,不显示。 */
export function rulesErrorMessage(error: string | null | undefined): string {
  const e = error ?? '';
  if (e === 'cancelled') return '';
  if (e === 'request_not_found') return '服务器上找不到这次请求（可能已过期），请点「重新读取」';
  return e || '未说明原因';
}

/** 终态结果里「不能当成文件内容用」的那几种,返回一句话;能用返回 null。规则/技能/项目文件夹共用。
 *  - !ok(含 request_not_found)
 *  - content_purged:hub #2001 首次终态读 60 秒后清掉内容 —— 绝不能当空文件显示(规则区可编辑,
 *    一保存就把节点上的真文件写成空的)
 *  - done 却没有 content(读操作):同上,当作过期
 *  - 认不出的 status */
export function resultProblem(res: { ok: boolean; error?: string | null; status?: string; content?: unknown; content_purged?: boolean; op?: string }): string | null {
  if (!res.ok) return rulesErrorMessage(res.error);
  if (res.content_purged) return RULES_PURGED_MESSAGE;
  if (res.status === 'done') {
    if (res.op !== 'write' && typeof res.content !== 'string') return RULES_PURGED_MESSAGE;
    return null;
  }
  if (res.status === 'failed' || res.status === 'timeout') return null; // 各区块有自己的失败/超时文案
  if (res.status === 'pending' || res.status === 'in_progress') return '还在等节点响应，请稍后点「重新读取」';
  return `服务器返回了这一版 app 认不出的状态「${String(res.status)}」，请点「重新读取」；仍不行请升级 app`;
}

export type RulesReadOutcome =
  | { kind: 'content'; content: string; exists: boolean | null; fileName: string | null; message: string }
  | { kind: 'problem'; fileName: string | null; message: string };

/** 一次规则文件读取的终局 → 区块该显示什么。任何非「拿到内容」的情况都是 problem(退出加载态、
 *  显示原因、「重新读取」可点)。 */
export function rulesReadOutcome(
  res: { ok: true; status: string; op?: string; file_name?: string | null; exists?: boolean | null; content?: string; content_purged?: boolean; error: string | null } | { ok: false; error: string },
  support?: RulesSupport,
): RulesReadOutcome {
  const fileName = res.ok ? res.file_name ?? null : null;
  const problem = resultProblem(res);
  if (problem !== null) return { kind: 'problem', fileName, message: problem };
  if (!res.ok) return { kind: 'problem', fileName, message: rulesErrorMessage(res.error) };
  const r = { op: 'read' as const, status: res.status as RulesRequestStatus, error: res.error, exists: res.exists ?? null, file_name: fileName };
  if (res.status !== 'done') return { kind: 'problem', fileName, message: rulesStatusMessage(r, support) };
  return { kind: 'content', content: res.content as string, exists: res.exists ?? null, fileName, message: rulesStatusMessage(r, support) };
}

/**
 * 轮询循环(api.ts waitForRulesFileResult 的本体,抽出来好测)。
 *  - 每次 poll 都有硬截止(callDeadlineMs):一次调用卡住不会让整个循环永远 await。
 *  - 卡住 / 网络类错误(transient)不结束读取,继续问,直到 maxWaitMs。
 *  - 非 transient 的错误(如 request_not_found)立即返回。
 *  - isTerminal 由调用方给;isTerminal 对认不出的状态也返回 true(见上)。
 */
export async function pollUntilTerminal<R extends { ok: boolean; status?: string; transient?: boolean; error?: string | null }>(
  poll: () => Promise<R>,
  opts: {
    nextDelayMs: (elapsedMs: number) => number;
    isTerminal: (s: string) => boolean;
    isCancelled?: () => boolean;
    maxWaitMs?: number;
    callDeadlineMs?: number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<R | { ok: false; error: string }> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const maxWait = opts.maxWaitMs ?? RULES_POLL_MAX_WAIT_MS;
  const callDeadline = opts.callDeadlineMs ?? 15_000;
  const started = now();
  let lastProblem = '';
  for (;;) {
    if (opts.isCancelled?.()) return { ok: false, error: 'cancelled' };
    const STALLED = { ok: false, error: '', transient: true, stalled: true } as unknown as R;
    let r: R;
    try {
      r = await withDeadline(poll(), callDeadline, () => STALLED);
    } catch (e) {
      r = { ok: false, error: e instanceof Error ? e.message : String(e), transient: true } as unknown as R;
    }
    if (opts.isCancelled?.()) return { ok: false, error: 'cancelled' };
    if (r === STALLED) lastProblem = `服务器 ${Math.round(callDeadline / 1000)} 秒内没有响应`;
    else if (!r.ok) {
      if (!r.transient) return r;
      lastProblem = r.error ?? '';
    } else if (opts.isTerminal(String(r.status))) return r;
    const elapsed = now() - started;
    if (elapsed > maxWait) return { ok: false, error: lastProblem ? `等待节点响应超时（最后一次：${lastProblem}）` : '等待节点响应超时' };
    await sleep(opts.nextDelayMs(elapsed));
  }
}

/** 轮询节奏：前几秒密一点（节点在线时 1–2s 内就回），之后放缓；总上限由 hub 的
 *  60s timeout 兜底，这里只决定「下一次什么时候问」。 */
export function nextPollDelayMs(elapsedMs: number): number {
  if (elapsedMs < 5_000) return 700;
  if (elapsedMs < 20_000) return 1_500;
  return 3_000;
}

/** 把 hub 的终态翻成给人看的一句话。空串表示「不用说什么」。 */
export function rulesStatusMessage(r: Pick<RulesFileResult, 'op' | 'status' | 'error' | 'exists' | 'file_name'>, support?: RulesSupport): string {
  const name = r.file_name ?? '规则文件';
  switch (r.status) {
    case 'pending':
    case 'in_progress':
      return r.op === 'read' ? `正在向节点读取 ${name}…` : `正在写入 ${name}…`;
    case 'done':
      if (r.op === 'write') return `${name} 已保存到节点工作目录`;
      return r.exists === false ? `节点工作目录下还没有 ${name}，保存后会新建` : '';
    case 'failed':
      return `节点${r.op === 'read' ? '读取' : '写入'}失败：${r.error ?? '未说明原因'}`;
    case 'timeout':
      return rulesTimeoutMessage(support);
    default:
      return resultProblem({ ok: true, status: String(r.status), op: 'write' }) ?? '';
  }
}

/** agent-node 从这一版起会答规则文件门铃(#1755 / 主仓 9b63073b)。 */
export const RULES_MIN_AGENT_NODE = '2.5.0-preview.58';
/** Claude Code 会话的通道(agent-network 的 node-server)从这一版起会答门铃,同时上报 rules_file_capable(#1977)。 */
export const RULES_MIN_ANET_FOR_CLAUDE_CODE = '2.3.0-preview.111';

/** 解析 `2.5.0-preview.71` / `2.4.13` 这类版本号;认不出返回 null(调用方按「不知道」处理,不猜)。 */
export function parseNodeVersion(v: string | null | undefined): [number, number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-preview\.(\d+))?$/.exec((v ?? '').trim());
  if (!m) return null;
  // 同一 x.y.z 下正式版排在所有 preview 之后。
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? Number.MAX_SAFE_INTEGER : Number(m[4])];
}

/** a < b → 负数,a > b → 正数;任一认不出 → null。 */
export function compareNodeVersion(a: string | null | undefined, b: string): number | null {
  const x = parseNodeVersion(a), y = parseNodeVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/**
 * 这个会话能不能答规则文件门铃 —— 发请求**之前**判断,答不了就当场说清楚,不让人等 60 秒超时。
 *  - capable:     会话上报了 rules_file_capable(最可靠)。
 *  - supported:   没上报,但它是 agent-node 且版本 ≥ 2.5.0-preview.58 —— 那几版会答,只是 .85 起才上报这个旗。
 *  - unsupported: 版本明确太旧(agent-node < .58),或 Claude Code 会话没上报旗(通道太旧) —— 不发请求。
 *  - unknown:     版本认不出/没有 —— 照旧发请求,超时文案不做版本断言以外的猜测。
 */
export type RulesSupport =
  | { kind: 'capable'; version: string | null }
  | { kind: 'supported'; version: string }
  | { kind: 'unsupported'; version: string | null; component: 'agent-node' | 'anet'; minVersion: string }
  | { kind: 'unknown'; version: string | null };

export function rulesSupport(session: Pick<Session, 'agent' | 'version' | 'rules_file_capable'> | null | undefined): RulesSupport {
  const version = session?.version ?? null;
  if (session?.rules_file_capable === true) return { kind: 'capable', version };
  if (isAgentNodeSession(session)) {
    const c = compareNodeVersion(version, RULES_MIN_AGENT_NODE);
    if (c === null) return { kind: 'unknown', version };
    return c < 0
      ? { kind: 'unsupported', version, component: 'agent-node', minVersion: RULES_MIN_AGENT_NODE }
      : { kind: 'supported', version: version as string };
  }
  if (typeof session?.agent === 'string' && session.agent.toLowerCase() === 'claude-code') {
    return { kind: 'unsupported', version, component: 'anet', minVersion: RULES_MIN_ANET_FOR_CLAUDE_CODE };
  }
  return { kind: 'unknown', version };
}

/** 版本太旧时直接显示的一句话(不发请求)。 */
export function rulesUnsupportedMessage(s: Extract<RulesSupport, { kind: 'unsupported' }>): string {
  const ver = s.version ? `（v${s.version}）` : '';
  return s.component === 'agent-node'
    ? `这个节点的 agent-node 版本${ver}还不支持查看规则文件，升级到 ${s.minVersion} 或更新后可用`
    : `这个 Claude Code 会话的 anet 版本${ver}还不支持查看规则文件，升级到 anet ${s.minVersion} 或更新并重启会话后可用`;
}

/** 60 秒超时的说法按「版本支不支持」分开:支持的版本超时,说明是连接/节点状态问题,不是版本问题。 */
export function rulesTimeoutMessage(support?: RulesSupport): string {
  if (support && (support.kind === 'capable' || support.kind === 'supported')) {
    const ver = support.version ? `（v${support.version}）` : '';
    return `节点 60 秒内没有取走这次请求。它的版本${ver}支持规则文件，多半是节点和服务器之间的实时连接断了，或节点卡住了；重启这个节点通常能恢复`;
  }
  return `节点 60 秒内没有响应：可能离线，或版本太旧（agent-node 需要 ${RULES_MIN_AGENT_NODE} 或更新，Claude Code 会话需要 anet ${RULES_MIN_ANET_FOR_CLAUDE_CODE} 或更新）`;
}

/** 编辑器里的内容和节点上的内容不一致才允许保存；逐字比较，不 trim ——
 *  末尾换行也是文件的一部分。 */
export function hasUnsavedChanges(editor: string, onNode: string | null): boolean {
  if (onNode === null) return editor.length > 0;
  return editor !== onNode;
}

/** hub 单飞拒绝（request_in_flight）时会带回正在跑的那条 request_id：
 *  再进一次页面 / 连点「重新读取」不该报错，应该接着等它。返回要跟的 id，或 null。 */
export function requestIdToFollow(enq: { ok: boolean; request_id?: string; existing_request_id?: string }): string | null {
  if (enq.ok && enq.request_id) return enq.request_id;
  if (!enq.ok && enq.existing_request_id) return enq.existing_request_id;
  return null;
}
