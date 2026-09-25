// 设置里管节点的环境变量(值只写不读)— run: bun src/node-env.test.ts
// @ts-expect-error app tsconfig 不带 node 类型(其余读源码的 ck 测试同样处理);运行时由 bun 提供。
import { readFileSync } from 'node:fs';
import { listNodeEnv, setNodeEnv, unsetNodeEnv, type HubConfig } from './api';
import {
  ENV_MIN_AGENT_NODE, ENV_MIN_ANET_FOR_CLAUDE_CODE, ENV_MIN_HUB, INSECURE_CLIENT_MESSAGE, INSECURE_NODE_MESSAGE, RESTART_NEEDED, WRITE_ONLY_NOTE,
  charCount, envErrorMessage, envStatusMessage, envSupport, envTarget, envUnsupportedMessage, keyEditable, keyInputProblem, keyTags,
  lengthLabel, normalizeKeyInput, parseEnvChange, parseEnvListing, restartPlan, valueInputProblem,
} from './node-env';
import { NODE_SECTIONS } from './node-page-model';

let pass = 0, total = 0;
const ck = (name: string, cond: boolean, extra = '') => {
  total++;
  if (cond) { pass++; console.log('✅', name); }
  else console.log('❌', name, extra);
};

const SECRET = 'sk-APPTEST-SECRET-VALUE-do-not-leak';

// ── 能不能答:只认 env_capable;答不了当场说要升级什么 ──
{
  ck('env_capable=true → capable', envSupport({ agent: 'agent-node:codex', version: ENV_MIN_AGENT_NODE, env_capable: true } as any).kind === 'capable');
  const hub = envSupport({ agent: 'agent-node:codex', version: ENV_MIN_AGENT_NODE } as any);
  ck('/api/status 没有 env_capable 键 → 服务器太旧,点名 commhub-server 版本', hub.kind === 'unsupported' && hub.component === 'hub' && envUnsupportedMessage(hub).includes(`commhub-server ${ENV_MIN_HUB}`));
  const old = envSupport({ agent: 'agent-node:codex', version: '2.5.0-preview.80', env_capable: false } as any);
  ck('agent-node 旧 → 升级到最低版本', old.kind === 'unsupported' && envUnsupportedMessage(old).includes(ENV_MIN_AGENT_NODE) && envUnsupportedMessage(old).includes('2.5.0-preview.80'));
  const fresh = envSupport({ agent: 'agent-node:codex', version: ENV_MIN_AGENT_NODE, env_capable: false } as any);
  ck('版本够但没上报 → 说「没有配置文件 / 没重连」,不说升级', fresh.kind === 'unsupported' && /config\.json/.test(envUnsupportedMessage(fresh)) && !/升级到/.test(envUnsupportedMessage(fresh)));
  const cc = envSupport({ agent: 'claude-code', version: '2.3.0-preview.100', env_capable: false } as any);
  ck('Claude Code 会话旧 → 升级 anet', cc.kind === 'unsupported' && cc.component === 'anet' && envUnsupportedMessage(cc).includes(`anet ${ENV_MIN_ANET_FOR_CLAUDE_CODE}`));
  const ccFresh = envSupport({ agent: 'claude-code', version: ENV_MIN_ANET_FOR_CLAUDE_CODE, env_capable: false } as any);
  ck('Claude Code 会话版本够但没上报 → 说只有 anet node start 起的会话能管', ccFresh.kind === 'unsupported' && /anet node start/.test(envUnsupportedMessage(ccFresh)));
  const other = envSupport({ agent: 'mystery', env_capable: false } as any);
  ck('其它进程 → 两个最低版本都说', other.kind === 'unsupported' && envUnsupportedMessage(other).includes(ENV_MIN_AGENT_NODE) && envUnsupportedMessage(other).includes(ENV_MIN_ANET_FOR_CLAUDE_CODE));
}

// ── 请求目标 ──
ck('未 capable → 无目标', envTarget({ node: { node_id: 'n1', alias: 'a' }, session: { alias: 'a' } }) === null);
ck('有 nodes 行 → node_id', envTarget({ node: { node_id: 'n1', alias: 'a' }, session: { alias: 'a', env_capable: true } })?.node_id === 'n1');
ck('没有 nodes 行 → 按 alias', (() => { const t = envTarget({ node: null, session: { alias: '节点A', env_capable: true } }); return !!t && t.alias === '节点A' && !t.node_id; })());

// ── 列表解析:白名单,永远没有值 ──
{
  const l = parseEnvListing(JSON.stringify({ keys: [
    { key: 'ZED_KEY', set: true, length: 4, in_effect: true, kind: 'plain' },
    { key: 'API_KEY', set: true, length: 51, in_effect: false, kind: 'plain', value: SECRET },
    { key: 'REF_KEY', set: true, length: 0, in_effect: false, kind: 'ref' },
    { key: 'PATH', set: true, length: 8, in_effect: true, kind: 'plain', reserved: true },
    { key: 'bad key', length: 1 }, { key: 'NEG', length: -1 }, { key: 'API_KEY', length: 2 },
  ], restart: 'remote', value: SECRET }));
  ck('解析成功、按键排序、坏条目 / 重复丢掉', !!l && l.keys.map(k => k.key).join(',') === 'API_KEY,PATH,REF_KEY,ZED_KEY', JSON.stringify(l));
  ck('解析结果里没有值(哪怕上游带了)', !JSON.stringify(l).includes(SECRET));
  ck('restart 模式', l?.restart === 'remote' && parseEnvListing('{"keys":[]}')?.restart === 'manual');
  ck('坏内容 → null', parseEnvListing('nope') === null && parseEnvListing('{}') === null && parseEnvListing(null) === null);
  const api = l!.keys[0], path = l!.keys[1], ref = l!.keys[2], zed = l!.keys[3];
  ck('「已设置 · N 位」', lengthLabel(api) === '已设置 · 51 位' && lengthLabel(zed) === '已设置 · 4 位');
  ck('引用:「引用 · 未解析」', lengthLabel(ref) === '引用 · 未解析');
  ck('标签:没生效 → 待重启生效;保留;引用', keyTags(api).join() === '待重启生效' && keyTags(zed).length === 0 && keyTags(path).includes('保留') && keyTags(ref).includes('引用'));
  ck('保留的键不能在这里改 / 删', !keyEditable(path) && keyEditable(api));
}
{
  const c = parseEnvChange(JSON.stringify({ key: 'API_KEY', set: true, length: 3, requires_restart: true, restart: 'remote' }));
  ck('set 结果 → remote + 要重启', c?.restart === 'remote' && c.requiresRestart === true);
  const u = parseEnvChange(JSON.stringify({ key: 'X', set: false, existed: false, requires_restart: false, restart: 'manual' }));
  ck('unset 不存在 → 不需要重启', u?.existed === false && u.requiresRestart === false);
}

// ── 客户端输入校验(与 hub 同规则的镜像;hub 仍是权威) ──
ck('键输入:小写转大写、去掉非法字符', normalizeKeyInput('api-key.v2') === 'APIKEYV2' && normalizeKeyInput('deepseek_api_key') === 'DEEPSEEK_API_KEY');
ck('键:合法', keyInputProblem('API_KEY') === null && keyInputProblem('_X') === null && keyInputProblem('A'.repeat(128)) === null);
ck('键:空 / 数字开头 / 过长', !!keyInputProblem('') && /数字开头/.test(keyInputProblem('1ABC') ?? '') && !!keyInputProblem('A'.repeat(129)));
ck('值:合法(含换行)', valueInputProblem('x') === null && valueInputProblem('a\nb') === null && valueInputProblem('a'.repeat(8192)) === null);
ck('值:空 / NUL / 超过 8 KiB(按 UTF-8 字节算)', !!valueInputProblem('') && !!valueInputProblem('a\u0000') && !!valueInputProblem('a'.repeat(8193)) && !!valueInputProblem('é'.repeat(4097)));
ck('值校验文案不含值本身', !(valueInputProblem(`${SECRET}\u0000`) ?? '').includes(SECRET));
ck('charCount 按码点(与节点同口径)', charCount('密钥🔑') === 3);

// ── 错误文案 ──
ck('insecure_transport(节点那段)→ 指定中文原句', envErrorMessage({ code: 'insecure_transport', leg: 'node', error: 'insecure_transport' }) === INSECURE_NODE_MESSAGE);
ck('指定原句逐字', INSECURE_NODE_MESSAGE === '这个节点经未加密的中继连接，暂不允许写入密钥；等中继启用加密后自动可用');
ck('insecure_transport(客户端那段)→ 说客户端的连接', envErrorMessage({ code: 'insecure_transport', leg: 'client' }) === INSECURE_CLIENT_MESSAGE && /客户端/.test(INSECURE_CLIENT_MESSAGE));
ck('reserved_env_key 带上 hub 的原因', /保留/.test(envErrorMessage({ code: 'reserved_env_key', reason: 'PATH is reserved' })) && envErrorMessage({ code: 'reserved_env_key', reason: 'PATH is reserved' }).includes('PATH is reserved'));
ck('其余错误码都有中文', ['invalid_env_key', 'invalid_env_value', 'env_not_supported', 'env_target_not_found', 'node_token_cannot_manage_env', 'request_in_flight', 'node_not_found', 'cross_network_node'].every(c => /[一-龥]/.test(envErrorMessage({ code: c }))));
ck('结果 failed 且是拉取时的传输拒绝 → 同一句中文', envStatusMessage('failed', 'insecure_transport: the node pulled this secret over an unencrypted connection', 'write') === INSECURE_NODE_MESSAGE);
ck('节点侧 config 错误 → 中文', /config\.json/.test(envStatusMessage('failed', 'this node has no config.json to hold environment variables', 'write')) && /EACCES/.test(envStatusMessage('failed', 'config write failed (EACCES)', 'write')));
ck('超时不说是版本问题', !/升级/.test(envStatusMessage('timeout', null)));

// ── 生效方式 ──
ck('remote + node_id + 可控 → 按钮', restartPlan({ restart: 'remote', node: { node_id: 'n1' }, alias: '节点A' }).kind === 'button');
ck('remote 但 hub 说不可控 → 手动', restartPlan({ restart: 'remote', node: { node_id: 'n1', lifecycle_controllable: false }, alias: '节点A' }).kind === 'manual');
{
  const m = restartPlan({ restart: 'manual', node: null, alias: '节点A' });
  ck('manual(Claude Code 会话)→ 手动,说 anet node stop / start', m.kind === 'manual' && m.text.includes('anet node stop 节点A') && m.text.includes('anet node start 节点A'));
}
ck('remote 但没有 nodes 行 → 手动', restartPlan({ restart: 'remote', node: null, alias: 'a' }).kind === 'manual');

// ── API 形状 ──
const originalFetch = globalThis.fetch;
const calls: Array<{ url: string; body: any }> = [];
let mode: 'ok' | 'unknown_tool' | 'in_flight' | 'insecure' | 'reserved' | 'echo_error' = 'ok';
globalThis.fetch = (async (input: any, init?: any) => {
  const body = init?.body ? JSON.parse(init.body) : undefined;
  calls.push({ url: String(input), body });
  const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
  const name = body.params.name;
  if (mode === 'unknown_tool') return json({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: `Tool ${name} not found` } });
  if (mode === 'echo_error') return json({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: `Input validation error: ${body.params.arguments.value}` } });
  const payload = mode === 'in_flight' ? { ok: false, error: 'request_in_flight', existing_request_id: 'r-prev' }
    : mode === 'insecure' ? { ok: false, error: 'insecure_transport', leg: 'node', message: 'this node reaches the hub over an unencrypted connection' }
    : mode === 'reserved' ? { ok: false, error: 'reserved_env_key', reason: 'PATH is reserved' }
    : name === 'list_node_env' ? { ok: true, request_id: 'r1', op: 'env_list', write_allowed: false, write_blocked: { error: 'insecure_transport', leg: 'client', message: 'm' } }
    : name === 'set_node_env' ? { ok: true, request_id: 'r2', op: 'env_set', key: body.params.arguments.key, length: 5 }
    : { ok: true, request_id: 'r3', op: 'env_unset', key: body.params.arguments.key };
  return json({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify(payload) }] } });
}) as typeof fetch;
try {
  const cfg: HubConfig = { serverUrl: 'https://hub.example.test', token: 'utok_test', networkId: 'net_main', username: 'admin' } as HubConfig;
  const l = await listNodeEnv(cfg, { node_id: 'n1', alias: '节点A' });
  const lc = calls.at(-1)?.body?.params;
  ck('list 走 list_node_env,参数只有 node_id + network_id', lc?.name === 'list_node_env' && JSON.stringify(Object.keys(lc.arguments).sort()) === JSON.stringify(['network_id', 'node_id']), JSON.stringify(lc));
  ck('list 带回 write_allowed / write_blocked.leg', l.ok === true && l.write_allowed === false && l.write_blocked?.leg === 'client', JSON.stringify(l));
  const s = await setNodeEnv(cfg, { alias: '节点A' }, 'API_KEY', SECRET);
  const sc = calls.at(-1)?.body?.params;
  ck('set 走 set_node_env,按 alias,带 key + value', sc?.name === 'set_node_env' && sc.arguments.alias === '节点A' && sc.arguments.key === 'API_KEY' && sc.arguments.value === SECRET && !('node_id' in sc.arguments));
  ck('set 的回执没有值', s.ok === true && s.key === 'API_KEY' && !JSON.stringify(s).includes(SECRET));
  await unsetNodeEnv(cfg, { node_id: 'n1', alias: 'a' }, 'API_KEY');
  const uc = calls.at(-1)?.body?.params;
  ck('unset 走 unset_node_env,不带 value', uc?.name === 'unset_node_env' && uc.arguments.key === 'API_KEY' && !('value' in uc.arguments));
  mode = 'insecure';
  const ins = await setNodeEnv(cfg, { node_id: 'n1', alias: 'a' }, 'API_KEY', SECRET);
  ck('insecure_transport → code + leg 带回来', !ins.ok && ins.code === 'insecure_transport' && ins.leg === 'node' && envErrorMessage(ins) === INSECURE_NODE_MESSAGE, JSON.stringify(ins));
  mode = 'reserved';
  const rs = await setNodeEnv(cfg, { node_id: 'n1', alias: 'a' }, 'PATH', 'x');
  ck('reserved_env_key → reason 带回来', !rs.ok && rs.code === 'reserved_env_key' && rs.reason === 'PATH is reserved');
  mode = 'in_flight';
  const f = await setNodeEnv(cfg, { node_id: 'n1', alias: 'a' }, 'API_KEY', 'x');
  ck('单飞被拒 → existing_request_id', !f.ok && f.existing_request_id === 'r-prev');
  mode = 'echo_error';
  const e = await setNodeEnv(cfg, { node_id: 'n1', alias: 'a' }, 'API_KEY', SECRET);
  ck('协议层错误文案里若带了值,换成固定文案', !e.ok && !e.error.includes(SECRET), JSON.stringify(e));
  mode = 'unknown_tool';
  const u = await listNodeEnv(cfg, { node_id: 'n1', alias: 'a' });
  ck('旧 hub(没有这个工具)→ unsupported,文案说环境变量', !u.ok && u.unsupported === true && /环境变量/.test(u.error), JSON.stringify(u));
} finally {
  globalThis.fetch = originalFetch;
}

// ── 挂载契约 + 值只写不读 ──
{
  const comp = readFileSync(new URL('./NodeEnvSection.tsx', import.meta.url), 'utf8');
  ck('导出 NodeEnvSection(命名 + 默认)', /export function NodeEnvSection\(/.test(comp) && /export default NodeEnvSection;/.test(comp));
  ck('能力不够时不发请求:先判 envSupport 再建管理器', /const support = envSupport\(s\);[\s\S]{0,400}if \(support\.kind !== 'capable' \|\| !target\)[\s\S]{0,600}return <EnvManager/.test(comp));
  ck('没有「显示」按钮', !/label="显示"|'显示'|>显示</.test(comp));
  ck('值输入框是密码框', /secureTextEntry/.test(comp) && /testID="node-env-value-input"/.test(comp));
  ck('写只读说明常驻', comp.includes('{WRITE_ONLY_NOTE}') && WRITE_ONLY_NOTE.includes('只写不读'));
  ck('不能写时「添加」置灰', /label="添加"[^\n]*disabled=\{!canWrite/.test(comp));
  ck('重启提示用常量「需要重启节点才生效」+「保存并重启」走 restart_node', comp.includes('{RESTART_NEEDED}') && RESTART_NEEDED === '需要重启节点才生效' && comp.includes("'保存并重启'") && /runNodeLifecycleAction\(cfg, 'restart_node'/.test(comp));
  ck('单飞被拒时等上一条结束再重发,不跟随别人的请求', /existing_request_id\) \{\s*await waitForRulesFileResult\(cfg, enq\.existing_request_id[\s\S]{0,300}enq = await enqueue\(\);/.test(comp) && !/requestIdToFollow/.test(comp));
  ck('删除要确认', /<ConfirmModal/.test(comp) && /setConfirmKey\(k\)/.test(comp));
  const screen = readFileSync(new URL('./NodeDetailScreen.tsx', import.meta.url), 'utf8');
  ck('节点页「环境变量」分区挂载', /section === 'env'[\s\S]{0,400}<NodeEnvSection cfg=\{cfg\} alias=\{alias\} node=\{rulesTarget\} hubNode=\{node\} session=\{s\} readOnly=\{readOnly\} \/>/.test(screen));
  ck('只挂载一次', (screen.match(/<NodeEnvSection /g) ?? []).length === 1);
  ck('分区在「项目文件夹」之后', NODE_SECTIONS.map(x => x.key).join(',').includes('files,env,tasks'));
}

console.log(`\n${pass}/${total} passed`);
if (pass !== total) process.exit(1);
