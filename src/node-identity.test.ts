// run: bun src/node-identity.test.ts
import { nodeIdentityNotice, taskSectionTitle } from './node-identity';
import type { HubNode } from './api';
let pass = 0, total = 0;
const ck = (name: string, cond: boolean, extra = '') => { total++; if (cond) { pass++; console.log('✅', name); } else console.log('❌', name, extra); };
const node = { node_id: 'n_1', alias: 'a' } as HubNode;
ck('有 node → 不提示', nodeIdentityNotice({ node_id: 'n_1' }, node, 'loaded') === null);
ck('列表还在拉 → 「正在读取」', nodeIdentityNotice({ node_id: 'n_1' }, null, 'loading') === '正在读取节点信息…');
ck('拉取失败但 session 有 ID → 说失败且点名 ID', (nodeIdentityNotice({ node_id: 'n_e06d936d' }, null, 'failed') ?? '').includes('n_e06d936d'));
ck('拉取成功但列表没有它 → 说可能别的网络', (nodeIdentityNotice({ node_id: 'n_1' }, null, 'loaded') ?? '').includes('别的网络'));
ck('真没有 ID → 原文案', nodeIdentityNotice({ node_id: null }, null, 'loaded') === '该会话没有权威节点 ID，生命周期操作不可用。');
ck('working → 当前任务', taskSectionTitle('working') === '当前任务');
ck('idle/其它 → 最近任务', taskSectionTitle('idle') === '最近任务' && taskSectionTitle(undefined) === '最近任务');
console.log(`\n${pass}/${total} passed`); if (pass !== total) process.exit(1);
