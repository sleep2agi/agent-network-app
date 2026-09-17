import { ackAgentUnread, type AgentAckDeps } from './agent-ack';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log(`PASS: ${n}`); } else console.log(`FAIL: ${n}`); };

type Log = { agent: string[]; ids: string[][]; cleared: string[]; warned: string[] };
const make = (opts: { supported?: boolean; agentThrows?: boolean; idsThrows?: boolean; ids?: string[] }): { deps: AgentAckDeps; log: Log } => {
  const log: Log = { agent: [], ids: [], cleared: [], warned: [] };
  const deps: AgentAckDeps = {
    ackAgent: async (agent) => {
      log.agent.push(agent);
      if (opts.agentThrows) throw new Error('boom');
      return { supported: opts.supported === true, acked: opts.supported ? 56 : 0 };
    },
    ackIds: async (ids) => {
      log.ids.push(ids);
      if (opts.idsThrows) throw new Error('boom');
      return ids.length;
    },
    idsFor: () => opts.ids ?? ['m1', 'r2'],
    clearServerUnread: (agent) => { log.cleared.push(agent); },
    warn: (m) => { log.warned.push(m); },
  };
  return { deps, log };
};

(async () => {
  {
    const { deps, log } = make({ supported: true });
    const out = await ackAgentUnread('TMA需求鲸', deps);
    ck('新 hub:agent 级 ack 成功 → outcome=agent', out === 'agent');
    ck('新 hub:不再按 id ack', log.ids.length === 0);
    ck('新 hub:本地立刻清该 agent 的服务端计数', log.cleared.length === 1 && log.cleared[0] === 'TMA需求鲸');
  }
  {
    const { deps, log } = make({ supported: false });
    const out = await ackAgentUnread('TMA需求鲸', deps);
    ck('老 hub:退回按 id ack → outcome=ids', out === 'ids');
    ck('老 hub:id ack 被调用且带当前页 id', log.ids.length === 1 && log.ids[0].join(',') === 'm1,r2');
    ck('老 hub:不清服务端计数(权威数仍在 hub 那边)', log.cleared.length === 0);
  }
  {
    const { deps, log } = make({ supported: false, ids: [] });
    const out = await ackAgentUnread('TMA需求鲸', deps);
    ck('老 hub 且当前页无可 ack 的 id → nothing', out === 'nothing' && log.ids.length === 0);
  }
  {
    const { deps, log } = make({ agentThrows: true });
    const out = await ackAgentUnread('TMA需求鲸', deps);
    ck('agent 级 ack 抛错 → outcome=error、不清计数、不再按 id 补', out === 'error' && log.cleared.length === 0 && log.ids.length === 0 && log.warned.length === 1);
  }
  {
    const { deps, log } = make({ supported: false, idsThrows: true });
    const out = await ackAgentUnread('TMA需求鲸', deps);
    ck('id ack 抛错 → outcome=error、不清计数', out === 'error' && log.cleared.length === 0 && log.warned.length === 1);
  }
  {
    const { deps, log } = make({ supported: true });
    const out = await ackAgentUnread('', deps);
    ck('空 agent → nothing,不发请求', out === 'nothing' && log.agent.length === 0);
  }
  console.log(`${p}/${t} passed`);
  process.exit(p === t ? 0 : 1);
})();
