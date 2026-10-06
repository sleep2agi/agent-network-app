// 看板 #652 —— 节点名规则(app 副本)与 Hub/daemon 判定一致。
// 🔴 NODE_NAME_CASES 钉在 sleep2agi/agent-network 的 server/src/shared/node-name.ts:两边必须一起改。
//    这里逐条跑那张表,ok / error 与服务器端不同就红。slug 列是 daemon 内部目录名(fnv1a),app 不复现。
import { readFileSync } from 'node:fs';
import {
  checkNodeName, describeNodeNameRejection, folderError, isValidNodeName, normalizeNodeName,
  NODE_FOLDER_RE, NODE_NAME_CASES, NODE_NAME_HINT, OLD_DAEMON_NAME_REJECTED, OLD_HUB_NAME_REJECTED,
} from './node-name';
import { buildCreateNodeSpec } from './create-node-request';
import { createRequestVerdict } from './create-request-status';

let passed = 0, total = 0;
const check = (name: string, ok: boolean) => { total++; if (ok) { passed++; console.log('✅', name); } else { console.error('❌', name); } };
const show = (s: string) => JSON.stringify(s.length > 12 ? `${s.slice(0, 6)}…(${[...s].length})` : s);

// ── 共享测试向量:与 Hub/daemon 同判 ──
check('shared table is non-empty (≥ 30 cases, both verdicts present)',
  NODE_NAME_CASES.length >= 30 && NODE_NAME_CASES.some(c => c.ok) && NODE_NAME_CASES.some(c => !c.ok));
for (const c of NODE_NAME_CASES) {
  const r = checkNodeName(c.input);
  const same = r.ok === c.ok && (r.ok || r.error === c.error);
  check(`case ${show(c.input)} → ${c.ok ? 'ok' : c.error}`, same);
  if (r.ok) check(`case ${show(c.input)} → name is trimmed NFC`, r.name === normalizeNodeName(c.input));
  else check(`case ${show(c.input)} → has a Chinese message`, /[一-鿿]/.test(r.message));
}

// ── owner 的原话场景 ──
check('🔴 「测试」 is accepted (owner complaint #652)', isValidNodeName('测试'));
check('「a/b」 is rejected with a message naming the character', (() => { const r = checkNodeName('a/b'); return !r.ok && r.message.includes('「/」'); })());
check('space is described as 空格', (() => { const r = checkNodeName('a b'); return !r.ok && r.message.includes('空格'); })());
check('non-string input → empty', (() => { const r = checkNodeName(undefined); return !r.ok && r.error === 'empty'; })());
check('normalizeNodeName trims and composes to NFC', normalizeNodeName('  éx ') === 'éx');

// ── 文件夹(工作目录名)规则 ──
check('folder rule is ^[a-z][a-z0-9-]{0,63}$', NODE_FOLDER_RE.source === '^[a-z][a-z0-9-]{0,63}$');
check('valid folder → no error', folderError('ceshi') === null && folderError('my-agent-1') === null && folderError('a'.repeat(64)) === null);
check('empty folder → error', folderError('') === '请填写文件夹名');
check('uppercase / CJK / underscore / slash → error (no silent mangling)',
  ['Ceshi', '测试', 'my_agent', 'a/b', 'a.b', 'a b'].every(v => folderError(v) !== null));
check('digit / dash first → explains the first-letter rule', folderError('1abc') === '文件夹名要以小写英文字母开头' && folderError('-abc') === '文件夹名要以小写英文字母开头');
check('too long → explains the length', folderError('a'.repeat(65)) === '文件夹名最多 64 个字符');

// ── 老 Hub / 老 daemon 拒新规则名字:说人话 ──
check('old hub node_name_invalid + valid Chinese name → upgrade message', describeNodeNameRejection('node_name_invalid', '测试', 'hub') === OLD_HUB_NAME_REJECTED);
check('message reads as the owner asked', OLD_HUB_NAME_REJECTED === '当前 Hub 版本不支持这个名字（旧版只允许小写英文），请升级 Hub 或改用小写英文名');
check('node_name_invalid for a locally-invalid name → no rewrite (raw)', describeNodeNameRejection('node_name_invalid', 'a/b', 'hub') === null);
check('other errors → null', describeNodeNameRejection('runtime_invalid', '测试', 'hub') === null && describeNodeNameRejection(undefined, '测试', 'hub') === null);
check('old daemon rejection in create-request status → daemon upgrade message',
  (() => { const v = createRequestVerdict({ status: 'rejected', error: 'validate: node_name_invalid' }, '测试'); return v.kind === 'failed' && v.text.startsWith(OLD_DAEMON_NAME_REJECTED); })());
check('daemon rejection uses child_name when present',
  (() => { const v = createRequestVerdict({ status: 'failed', error: 'node_name_invalid', child_name: '研发助手A' }); return v.kind === 'failed' && v.text.startsWith(OLD_DAEMON_NAME_REJECTED); })());

// ── 发给 Hub 的是 trim + NFC ──
const spec = buildCreateNodeSpec({ name: '  é测试 ', runtimeId: 'claude-agent-sdk', model: 'deepseek-v4-pro', runtimeModels: ['deepseek-v4-pro'], permissionMode: 'default', maxTurns: '', budget: '', workdirField: {} } as Parameters<typeof buildCreateNodeSpec>[0]);
check('request name = trimmed NFC', spec.name === 'é测试');

// ── 向导源码接线(纯函数之外的那一层)──
const wiz = readFileSync(new URL('./CreateNodeWizardScreen.tsx', import.meta.url), 'utf8');
check('wizard validates with checkNodeName, old regex gone', wiz.includes('const nameCheck = checkNodeName(name);') && !wiz.includes('[a-z][a-z0-9_-]{0,63}$/;'));
check('wizard shows the server-equivalent message under the input', wiz.includes('nameCheck.message') && wiz.includes('NODE_NAME_HINT'));
check('folder line exists and is gated on workdirRoot', /\{workdirRoot \? \(\s*<View style=\{styles\.folderBlock\}>/.test(wiz) && wiz.includes('testID="create-folder-row"'));
check('folder line text is 「文件夹：<slug>」', wiz.includes('{`文件夹：${folder}`}'));
check('folder error blocks 下一步', wiz.includes("(cur === 'name' && nameValid && !folderErr)"));
check('hub create_node error goes through describeNodeNameRejection', wiz.includes("describeNodeNameRejection(res.error, name, 'hub')"));
check('hint constant is the Unicode one', NODE_NAME_HINT.includes('中文'));

console.log(`node name: ${passed}/${total} checks passed`);
process.exit(passed === total ? 0 : 1);
