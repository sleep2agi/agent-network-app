// app#225 —— 节点规则文件（CLAUDE.md / AGENTS.md）区块的纯逻辑。
//
// 文件名由**节点**按自己的运行时决定（主仓 agent-node/src/runtime/rules-file.ts），
// 这里的映射只用于「结果还没回来之前先显示一个名字」；节点 ack 里回报的
// file_name 一到就以它为准。两边规则相同：claude 系 → CLAUDE.md，其余 → AGENTS.md。
//
// 🔴 桌面端不传路径、不传文件名 —— hub 工具的入参里根本没有那些字段
//（#225 验收第 5 条）。这个文件里没有任何路径拼接。

import type { HubNode, RulesTarget, Session } from './api';

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
}

export function isTerminal(status: RulesRequestStatus): boolean {
  return status === 'done' || status === 'failed' || status === 'timeout';
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
