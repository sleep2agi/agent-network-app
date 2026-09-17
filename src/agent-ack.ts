/**
 * 打开会话、渲染到底时把该 agent 的未读在 hub 上清掉 —— 决策逻辑(纯,无 IO)。
 *
 * 为什么要 agent 级:hub 的 `unread_by_agent` 数的是该 agent **全部时间**两表里未 ack 的行,
 * 而客户端只看得到当前页(user_inbox 200 行 / inbox 7 天 300 行),按 id 逐条 ack 永远清不完,
 * 角标一直 99+(Vincent 2026-09-17,task f597434f)。
 *
 * 顺序:先试 hub 0.9.0-preview.55 起的 `{agent}` 形式;老 hub 不认(400)就退回按 id;
 * 只有 agent 级 ack 成功才在本地立刻把该 agent 的服务端计数归零(不用等下一次轮询)。
 */
export interface AgentAckResult {
  supported: boolean;
  acked: number;
}

export interface AgentAckDeps {
  ackAgent: (agent: string) => Promise<AgentAckResult>;
  ackIds: (ids: string[]) => Promise<number>;
  idsFor: (agent: string) => string[];
  clearServerUnread: (agent: string) => void;
  warn?: (message: string, error: unknown) => void;
}

export type AgentAckOutcome = 'agent' | 'ids' | 'nothing' | 'error';

export async function ackAgentUnread(agent: string, deps: AgentAckDeps): Promise<AgentAckOutcome> {
  if (!agent) return 'nothing';
  try {
    const result = await deps.ackAgent(agent);
    if (result.supported) {
      deps.clearServerUnread(agent);
      return 'agent';
    }
  } catch (error) {
    deps.warn?.('ack unread (agent) failed', error);
    return 'error';
  }
  const ids = deps.idsFor(agent);
  if (!ids.length) return 'nothing';
  try {
    await deps.ackIds(ids);
    return 'ids';
  } catch (error) {
    deps.warn?.('ack unread failed', error);
    return 'error';
  }
}
