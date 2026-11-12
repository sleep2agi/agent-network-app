// 新建节点 → 来源节点挑选（admin 2026-11-12 截图：daemon-vdev 上一个来源节点都列不出）。ck 风格,自执行,失败 exit 1。
//   run: bun src/node-source-launcher-model.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HubNode } from './api';
import { nodeWorkdir, pickSourceNodes, sourceDetail, sourceMatches } from './node-source-launcher-model';

let p = 0, t = 0;
const ck = (name: string, ok: boolean, extra = '') => { t++; if (ok) p++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? ` (${extra})` : ''}`); };
const root = join(import.meta.dir, '..');
const read = (f: string) => readFileSync(join(root, f), 'utf8');

const D = 'node_daemon_vdev';
const n = (o: Partial<HubNode> & { node_id: string }): HubNode => ({ alias: o.node_id, ...o } as HubNode);
const nodes: HubNode[] = [
  n({ node_id: D, alias: 'daemon-vdev', runtime: 'daemon', hostname: 'vdev' }),
  // Hub /api/nodes 真机报的是 opencode-sdk —— 旧代码只认 opencode-cli，所以一个都没有。
  n({ node_id: 'a', alias: 'B客户端', runtime: 'opencode-sdk', opencode_generation: 'v2', lifecycle_daemon_node_id: D, hostname: 'vdev', model: 'xai/grok-4.7', config_path: '/data/ws/client-5x/.anet/nodes/B/config.json' }),
  n({ node_id: 'b', alias: 'A设计', runtime: 'opencode-cli', opencode_generation: 'v2', hostname: 'vdev', adoption: { request_id: 'r', daemon_node_id: D, status: 'active', error: null } }),
  n({ node_id: 'c', alias: 'C停了', runtime: 'opencode-sdk', opencode_generation: 'v2', lifecycle_daemon_node_id: D, lifecycle_state: 'stopped', hostname: 'vdev' }),
  n({ node_id: 'v1', runtime: 'opencode-sdk', opencode_generation: 'v1', lifecycle_daemon_node_id: D, hostname: 'vdev' }),
  n({ node_id: 'cx', runtime: 'codex-app-server-sdk', lifecycle_daemon_node_id: D, hostname: 'vdev' }),
  n({ node_id: 'tw', runtime: 'tmwork-opencode-plugin', opencode_generation: 'v2', lifecycle_daemon_node_id: D, hostname: 'vdev' }),
  n({ node_id: 'hand1', runtime: 'opencode-sdk', opencode_generation: 'v2', hostname: 'vdev' }),
  n({ node_id: 'hand2', runtime: 'opencode-sdk', opencode_generation: 'v2', hostname: 'vdev' }),
  n({ node_id: 'other', runtime: 'opencode-sdk', opencode_generation: 'v2', hostname: 'mac' }),
];
const pick = pickSourceNodes(nodes, D);
const ids = pick.sources.map(s => s.node.node_id);
ck('A1 🔴 runtime opencode-sdk（Hub 真机报法）算 OpenCode V2 来源', ids.includes('a'));
ck('A2 opencode-cli 仍然算；接管 adoption=active 也算归属', ids.includes('b'));
ck('A3 v1 / codex / tmwork 插件 / daemon 自己都不算', !ids.some(i => ['v1', 'cx', 'tw', D].includes(i)), ids.join(','));
ck('A4 没绑到这个 daemon 的不列（不按 hostname 猜归属）', !ids.includes('hand1') && !ids.includes('other'));
ck('A5 排序：运行中在前，同组按名字', ids.join(',') === 'b,a,c', ids.join(','));
ck('A6 同机未接管的 V2 节点单独计数（别的机器不算）', pick.unboundOnHost === 2, String(pick.unboundOnHost));
ck('A7 换个 daemon 一个都没有 → unboundOnHost 不靠 hostname 缺失时乱数', pickSourceNodes(nodes, 'nope').unboundOnHost === 0);

ck('B1 工作目录取 /.anet/ 之前', nodeWorkdir('/data/ws/client-5x/.anet/nodes/B/config.json') === '/data/ws/client-5x');
ck('B2 Windows 路径也行；没有 .anet 就是 null', nodeWorkdir('C:\\w\\proj\\.anet\\nodes\\x\\config.json') === 'C:\\w\\proj' && nodeWorkdir('/x/y.json') === null && nodeWorkdir(null) === null);
const a = pick.sources.find(s => s.node.node_id === 'a')!;
const c = pick.sources.find(s => s.node.node_id === 'c')!;
ck('B3 第二行 = 文件夹 · 模型', sourceDetail(a) === 'client-5x · xai/grok-4.7', sourceDetail(a));
ck('B4 停止的节点标「已停止」', sourceDetail(c).includes('已停止') && !c.active);
ck('B5 running / 缺失都算可用；start_failed 置灰', pickSourceNodes([nodes[0], n({ node_id: 'r', runtime: 'opencode-sdk', opencode_generation: 'v2', lifecycle_daemon_node_id: D, lifecycle_state: 'running' }), n({ node_id: 'x', runtime: 'opencode-sdk', opencode_generation: 'v2', lifecycle_daemon_node_id: D }), n({ node_id: 'f', runtime: 'opencode-sdk', opencode_generation: 'v2', lifecycle_daemon_node_id: D, lifecycle_state: 'start_failed' })], D).sources.map(s => `${s.node.node_id}:${s.active}`).join(',') === 'r:true,x:true,f:false');
ck('C1 能按文件夹 / 模型 / 名字搜', sourceMatches(a, 'client-5x') && sourceMatches(a, 'GROK') && sourceMatches(a, 'B客户') && !sourceMatches(a, 'zzz'));

const launcher = read('src/NodeSourceLauncher.tsx');
const palette = read('src/NodeSourcePalette.tsx');
ck('D1 🔴 面板不再写死 runtime === \'opencode-cli\'', !launcher.includes("'opencode-cli'") && !palette.includes("node.runtime === 'opencode-cli'"));
ck('D2 面板走 pickSourceNodes；停止的行不可点', launcher.includes('pickSourceNodes(') && /disabled=\{!c\.active\}/.test(launcher));

console.log(`\n${p}/${t} passed`);
if (p !== t) process.exit(1);
