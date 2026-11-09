// ck-style：#4150 受管 source 独立 fork 客户端契约（请求体/校验/门/未知重试/状态语义）
import { strict as assert } from 'node:assert';
import {
  buildSourceForkBody, validateSelection, newIntentId, classifyStatus, retryPlan,
  gateClosedMessage, canStartFork, SOURCE_FORK_MODE, describeSourceForkRefusal, SOURCE_FORK_REFUSAL_REASONS,
} from './session-source-fork';

let n = 0;
const ck = (name: string, cond: boolean) => { n += 1; assert.ok(cond, name); console.log(`PASS: ${name}`); };
const sel = { networkId: 'net_abc', sourceNodeId: 'node_src', sessionId: 'ses_Selected1', childName: 'independent-child', intentId: 'client_intent_1' };

// 1) 请求体恰好六个字段、顺序固定、无多余字段
const body = buildSourceForkBody(sel);
ck('body has exactly the 6 contract keys', JSON.stringify(Object.keys(body)) === JSON.stringify(['network_id', 'source_node_id', 'session_id', 'mode', 'child_name', 'intent_id']));
ck('mode is fork_independent', body.mode === SOURCE_FORK_MODE);
ck('no daemon/token/url/path/binding fields', !/(daemon|token|url|path|binding|evidence)/i.test(Object.keys(body).join(',')));

// 2) 校验
ck('valid selection passes', validateSelection(sel).ok === true);
ck('network with hyphen accepted', validateSelection({ ...sel, networkId: 'net-sweep' }).ok === true);
ck('missing network rejected', validateSelection({ ...sel, networkId: '' }).ok === false);
ck('bad session prefix rejected', validateSelection({ ...sel, sessionId: 'abc' }).ok === false);
ck('bad intent chars rejected', validateSelection({ ...sel, intentId: 'a b' }).ok === false);
ck('empty child name rejected', validateSelection({ ...sel, childName: '' }).ok === false);

// 3) intent 生成：合法字符集、长度上限
const it = newIntentId('示例 source: 1');
ck('generated intent matches contract charset', /^[A-Za-z0-9_-]{1,200}$/.test(it));
ck('generated intent length <= 200', it.length <= 200);

// 4) 状态语义：registration_confirmed 是注册回执，不是原生接受
ck('registration_confirmed → receipt kind', classifyStatus('registration_confirmed').kind === 'registration-receipt');
ck('refused distinct', classifyStatus('refused').kind === 'refused');
ck('unknown distinct', classifyStatus('unknown').kind === 'unknown');
ck('unknown_rotation_required distinct', classifyStatus('unknown_rotation_required').kind === 'unknown');
ck('mid states are progress', classifyStatus('evidence_pending').kind === 'progress');

// 5) unknown 重试：同一 intent，不新开
const plan = retryPlan(sel, classifyStatus('unknown'));
ck('unknown → retry same intent', plan.action === 'retry-same-intent' && plan.reason.includes('同一 intent_id'));
ck('progress → stop', retryPlan(sel, classifyStatus('evidence_pending')).action === 'stop');

// 6) gate 关闭文案：明确未开放且不 fallback
ck('gate closed message says not open + no fallback', /未开放/.test(gateClosedMessage()) && /不会退回普通创建/.test(gateClosedMessage()));

// 7) 发起前门：无权限 / 无网络 / 目录未知一律禁
ck('no permission blocked', canStartFork({ hasPermission: false, networkId: 'net_abc', session: { sessionId: 'ses_A', nodeId: 'n1' } }).ok === false);
ck('no network blocked', canStartFork({ hasPermission: true, networkId: null, session: { sessionId: 'ses_A', nodeId: 'n1' } }).ok === false);
ck('unknown catalog blocked', canStartFork({ hasPermission: true, networkId: 'net_abc', session: null }).ok === false);
ck('valid enables', canStartFork({ hasPermission: true, networkId: 'net_abc', session: { sessionId: 'ses_A', nodeId: 'n1' } }).ok === true);

// 8) Hub 拒绝时给人看的话：不再显示裸「conflict」
ck('daemon_offline names the daemon and the fix', /daemon 离线/.test(describeSourceForkRefusal(409, 'daemon_offline')) && /启动/.test(describeSourceForkRefusal(409, 'daemon_offline')));
ck('every known reason has its own message', new Set(SOURCE_FORK_REFUSAL_REASONS.map(r => describeSourceForkRefusal(409, r))).size === SOURCE_FORK_REFUSAL_REASONS.length);
ck('old hub 409 without reason is still actionable', !/^conflict$/i.test(describeSourceForkRefusal(409)) && /daemon/.test(describeSourceForkRefusal(409)));
ck('unknown reason falls back to the generic 409 text', describeSourceForkRefusal(409, 'something_new') === describeSourceForkRefusal(409));
ck('403 explains permission', /权限/.test(describeSourceForkRefusal(403)));
ck('401 explains login', /登录/.test(describeSourceForkRefusal(401)));

console.log(`${n}/${n} passed`);
process.exit(0);
