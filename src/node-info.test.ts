import fs from 'node:fs';
import path from 'node:path';
import { nodeInfoFacts } from './node-info';

let passed = 0;
const check = (name: string, ok: boolean) => {
  if (!ok) throw new Error(`FAIL: ${name}`);
  passed++;
  console.log(`PASS: ${name}`);
};
const value = (facts: ReturnType<typeof nodeInfoFacts>, label: string) => facts.find(f => f.label === label)?.value;

const facts = nodeInfoFacts({
  alias: 'agent-a', status: 'working', agent: 'codex-sdk', server: 'edge-a',
  hostname: 'host-a', ip: '10.0.0.8', project_dir: '/home/alice/project',
  version: '2.5.0', model: 'gpt-5', runtime: 'codex', os_user: 'runner',
}, {
  node_id: 'node-a', alias: 'agent-a', node_name: 'Agent A', role: 'worker',
}, 'https://hub.example');

check('explicit OS user is displayed', value(facts, '系统用户') === 'runner');
check('project path is displayed independently', value(facts, '工作路径') === '/home/alice/project');
check('server/hostname/IP are all retained', value(facts, '服务器') === 'edge-a' && value(facts, 'Hostname') === 'host-a' && value(facts, 'IP') === '10.0.0.8');
check('runtime/agent/node type remain distinct', value(facts, 'Runtime') === 'codex' && value(facts, 'Agent') === 'codex-sdk' && value(facts, '节点类型') === 'worker');
check('model/version/status are visible', value(facts, '模型') === 'gpt-5' && value(facts, '版本') === '2.5.0' && value(facts, '状态') === 'working');

const legacy = nodeInfoFacts({
  alias: 'legacy', status: 'offline', project_dir: '/home/should-not-be-a-user/secret',
  ...( { token: 'atok_secret', config_secret: 'do-not-render' } as any),
}, null, 'https://hub.example');
check('missing OS user is honest and never inferred from project_dir', value(legacy, '系统用户') === '未上报');
check('safe projection allowlists labels and excludes arbitrary secrets', !legacy.some(f => /token|secret|config/i.test(f.label)) && !JSON.stringify(legacy).includes('atok_secret'));
check('server URL is a truthful fallback', value(legacy, '服务器') === 'https://hub.example');

const root = process.cwd();
const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
const chat = fs.readFileSync(path.join(root, 'src/ChatScreen.tsx'), 'utf8');
const detail = fs.readFileSync(path.join(root, 'src/NodeDetailScreen.tsx'), 'utf8');
check('mobile chat opens exact-alias nodeInfo', app.includes("onOpenNodeSettings={() => setScreen({ name: 'nodeInfo', alias: screen.alias })}"));
check('detached chat opens exact-alias nodeInfo', app.includes("onOpenNodeSettings={() => setScreen({ name: 'nodeInfo', alias: detachedAlias })}"));
check('nodeInfo Back restores the same chat', app.includes("onBack={() => setScreen({ name: 'chat', alias: screen.alias })} readOnly"));
check('Android hardware Back restores the same chat', app.includes("if (screen.name === 'nodeInfo')") && app.includes("setScreen({ name: 'chat', alias: screen.alias })"));
check('settings action has visible text and accessibility help', chat.includes('>设置</Text>') && chat.includes('accessibilityHint="打开当前节点的只读详细信息"'));
check('desktop settings reserves a separate pin hit target', chat.includes('headerActionWithWindowPin') && chat.includes('marginRight: 42'));
check('read-only details hide all existing mutation surfaces', detail.includes('!readOnly ? <AvatarEditSection') && detail.includes('visible={!readOnly && !!pendingAction}') && detail.includes("{readOnly ? '节点信息' : '节点详情'}"));
check('details use full status rather than the list projection', detail.includes('fetchNodeStatus(cfg)'));

console.log(`node info: ${passed}/${passed} checks passed`);
