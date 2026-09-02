// app#225 —— 节点规则文件（CLAUDE.md / AGENTS.md）区块的纯逻辑。
//
// 文件名由**节点**按自己的运行时决定（主仓 agent-node/src/runtime/rules-file.ts），
// 这里的映射只用于「结果还没回来之前先显示一个名字」；节点 ack 里回报的
// file_name 一到就以它为准。两边规则相同：claude 系 → CLAUDE.md，其余 → AGENTS.md。
//
// 🔴 桌面端不传路径、不传文件名 —— hub 工具的入参里根本没有那些字段
//（#225 验收第 5 条）。这个文件里没有任何路径拼接。

import type { HubNode, Session } from './api';

export type RulesFileName = 'CLAUDE.md' | 'AGENTS.md';

/** 与 agent-node 的 rulesFileNameForRuntime 同规则；输入可以是 session.runtime /
 *  node.runtime / session.agent 里任何一个，谁先有值用谁。 */
export function predictedRulesFileName(session?: Pick<Session, 'agent' | 'runtime'> | null, node?: Pick<HubNode, 'runtime'> | null): RulesFileName {
  const raw = (session?.runtime ?? node?.runtime ?? session?.agent ?? '').toLowerCase();
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
export function rulesStatusMessage(r: Pick<RulesFileResult, 'op' | 'status' | 'error' | 'exists' | 'file_name'>): string {
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
      return '节点 60 秒内没有响应：可能离线，或它的 agent-node 版本还不支持规则文件（需要 2.5.0-preview.58+）';
  }
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
