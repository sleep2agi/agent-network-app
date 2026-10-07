// 旧节点回「unknown op <x>」时的文案 — run: bun src/node-op-unsupported.test.ts
import { setLanguagePreference } from './i18n';
import { NODE_OP_MIN_AGENT_NODE, displayVersion, parseUnknownOp, unknownOpMessage } from './node-op-unsupported';
import { logsStatusMessage } from './node-logs';
import { skillsStatusMessage } from './node-skills';
import { filesStatusMessage } from './node-files';
import { rulesReadOutcome, rulesStatusMessage } from './node-rules';

let pass = 0, total = 0;
const ck = (name: string, cond: boolean, extra = '') => {
  total++;
  if (cond) { pass++; console.log('✅', name); }
  else console.log('❌', name, extra);
};

const old88 = { agent: 'agent-node:claude-code-cli', version: '2.5.0-preview.88' };

// ── 解析 ──
ck('parse: 原样的 unknown op logs_tail', parseUnknownOp('unknown op logs_tail') === 'logs_tail');
ck('parse: 带 Error: 前缀和引号', parseUnknownOp('Error: unknown op "skills_list"') === 'skills_list');
ck('parse: 大小写不敏感', parseUnknownOp('Unknown Op files_list') === 'files_list');
ck('parse: 不是这类错误 → null', parseUnknownOp('not found: a.txt') === null);
ck('parse: null / 空 → null', parseUnknownOp(null) === null && parseUnknownOp('') === null);
ck('parse: 不误认 unknown opencode', parseUnknownOp('unknown opencode generation 3') === null);
ck('displayVersion: 加 v,不重复加', displayVersion('2.5.0-preview.88') === 'v2.5.0-preview.88' && displayVersion('v1.2.3') === 'v1.2.3');

// ── 最低版本表 ──
ck('表: logs_tail = .91', NODE_OP_MIN_AGENT_NODE.logs_tail === '2.5.0-preview.91');
ck('表: files = .88', NODE_OP_MIN_AGENT_NODE.files_list === '2.5.0-preview.88' && NODE_OP_MIN_AGENT_NODE.file_read === '2.5.0-preview.88');
ck('表: skills = .85', NODE_OP_MIN_AGENT_NODE.skills_list === '2.5.0-preview.85' && NODE_OP_MIN_AGENT_NODE.skill_read === '2.5.0-preview.85');
ck('表: rules = .58', NODE_OP_MIN_AGENT_NODE.read === '2.5.0-preview.58' && NODE_OP_MIN_AGENT_NODE.write === '2.5.0-preview.58');

// ── 中文 ──
setLanguagePreference('zh');
{
  const m = unknownOpMessage('unknown op logs_tail', old88);
  ck('zh: 运行日志的完整文案', m === '这个节点的版本（v2.5.0-preview.88）较旧，不支持查看运行日志。升级到 v2.5.0-preview.91 或更新版本后可用。', String(m));
  ck('zh: 不再出现原始 unknown op', !String(m).includes('unknown op'));
  ck('zh: 技能', unknownOpMessage('unknown op skills_list', { agent: 'agent-node:codex', version: '2.5.0-preview.80' }) === '这个节点的版本（v2.5.0-preview.80）较旧，不支持查看技能。升级到 v2.5.0-preview.85 或更新版本后可用。');
  ck('zh: 项目文件夹', String(unknownOpMessage('unknown op file_read', { agent: 'agent-node:codex', version: '2.5.0-preview.86' })).includes('不支持查看项目文件夹。升级到 v2.5.0-preview.88'));
  ck('zh: 没有版本号 → 不写括号', unknownOpMessage('unknown op logs_tail', { agent: 'agent-node:x', version: undefined as any }) === '这个节点的版本较旧，不支持查看运行日志。升级到 v2.5.0-preview.91 或更新版本后可用。');
  ck('zh: 非 agent-node 会话 → 不给 agent-node 的最低版本', unknownOpMessage('unknown op logs_tail', { agent: 'claude-code', version: '2.3.0-preview.100' }) === '这个节点的版本（v2.3.0-preview.100）较旧，不支持查看运行日志。升级到最新版本后可用。');
  ck('zh: 表里没有的 op → 说出 op 名', unknownOpMessage('unknown op future_op', old88) === '这个节点的版本（v2.5.0-preview.88）较旧，不支持这个操作（future_op）。升级到最新版本后可用。');
  ck('zh: 报的版本已 ≥ 最低版本 → 不给自相矛盾的最低版本', !String(unknownOpMessage('unknown op logs_tail', { agent: 'agent-node:x', version: '2.5.0-preview.95' })).includes('preview.91'));
  ck('zh: 其他错误 → null', unknownOpMessage('permission denied', old88) === null);

  // 各分区的终态文案都走同一张表
  ck('logsStatusMessage: unknown op → 升级提示', logsStatusMessage('failed', 'unknown op logs_tail', old88).startsWith('这个节点的版本（v2.5.0-preview.88）较旧'));
  ck('logsStatusMessage: 其他错误原样', logsStatusMessage('failed', 'disk full', old88) === '节点读取日志失败：disk full');
  ck('logsStatusMessage: 不传 session 也不再显示原始错误', logsStatusMessage('failed', 'unknown op logs_tail') === '这个节点的版本较旧，不支持查看运行日志。升级到最新版本后可用。');
  ck('skillsStatusMessage: unknown op → 升级提示', skillsStatusMessage('failed', 'unknown op skills_list', undefined, old88).includes('不支持查看技能'));
  ck('skillsStatusMessage: 其他错误原样', skillsStatusMessage('failed', 'boom', undefined, old88) === '节点读取技能失败:boom');
  ck('filesStatusMessage: unknown op → 升级提示', filesStatusMessage('failed', 'unknown op files_list', { agent: 'agent-node:x', version: '2.5.0-preview.87' }).includes('升级到 v2.5.0-preview.88'));
  ck('filesStatusMessage: 其他错误仍走 friendlyNodeError', filesStatusMessage('failed', 'not a directory', old88) === '节点读取失败:不是目录');
  ck('rulesStatusMessage: unknown op → 升级提示',
    rulesStatusMessage({ op: 'read', status: 'failed', error: 'unknown op read', exists: null, file_name: 'CLAUDE.md' }, undefined, { agent: 'agent-node:x', version: '2.5.0-preview.50' }).includes('不支持查看规则文件。升级到 v2.5.0-preview.58'));
  const out = rulesReadOutcome({ ok: true, status: 'failed', error: 'unknown op read', file_name: 'AGENTS.md' }, undefined, { agent: 'agent-node:x', version: '2.5.0-preview.50' });
  ck('rulesReadOutcome: 透传 session', out.kind === 'problem' && out.message.includes('v2.5.0-preview.50'), JSON.stringify(out));
}

// ── English ──
setLanguagePreference('en');
{
  const m = unknownOpMessage('unknown op logs_tail', old88);
  ck('en: run log', m === 'This node’s version (v2.5.0-preview.88) is too old to view the run log. Upgrade to v2.5.0-preview.91 or later to use it.', String(m));
  ck('en: unknown op name', unknownOpMessage('unknown op future_op', old88) === 'This node’s version (v2.5.0-preview.88) is too old to use this operation (future_op). Upgrade to the latest version to use it.');
  ck('en: no version', unknownOpMessage('unknown op files_list', { agent: 'agent-node:x', version: '' }) === 'This node’s version is too old to browse the project folder. Upgrade to v2.5.0-preview.88 or later to use it.');
}
setLanguagePreference('system');

console.log(`\nnode op unsupported: ${pass}/${total} checks passed`);
if (pass !== total) (globalThis as any).process.exit(1);
