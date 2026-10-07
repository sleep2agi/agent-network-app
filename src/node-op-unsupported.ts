// 节点门铃(规则文件 / 技能 / 项目文件夹 / 运行日志)返回「unknown op <x>」时的人话。
//
// 旧版 agent-node 不认识新 op,会在 rules-file.ts 的分发里 throw `unknown op <op>`,hub 原样把它当
// failed 的 error 交回来 —— 以前各分区直接拼成「节点读取日志失败：unknown op logs_tail」。
// 这里把它翻成「这个节点的版本（vX）较旧，不支持查看运行日志。升级到 vY 或更新版本后可用。」。
// 纯逻辑,不 import react-native。
import type { Session } from './api';
import { registerTranslations, t } from './i18n';
import { compareNodeVersion, isAgentNodeSession, parseNodeVersion } from './node-rules';

registerTranslations({
  'nodeOp.feature.rules': ['查看规则文件', 'view the rules file'],
  'nodeOp.feature.rulesWrite': ['保存规则文件', 'save the rules file'],
  'nodeOp.feature.skills': ['查看技能', 'view skills'],
  'nodeOp.feature.files': ['查看项目文件夹', 'browse the project folder'],
  'nodeOp.feature.logs': ['查看运行日志', 'view the run log'],
  'nodeOp.feature.unknown': ['这个操作（{op}）', 'use this operation ({op})'],
  'nodeOp.oldWithMin': [
    '这个节点的版本（{version}）较旧，不支持{feature}。升级到 {min} 或更新版本后可用。',
    'This node’s version ({version}) is too old to {feature}. Upgrade to {min} or later to use it.',
  ],
  'nodeOp.oldNoMin': [
    '这个节点的版本（{version}）较旧，不支持{feature}。升级到最新版本后可用。',
    'This node’s version ({version}) is too old to {feature}. Upgrade to the latest version to use it.',
  ],
  'nodeOp.oldNoVersionWithMin': [
    '这个节点的版本较旧，不支持{feature}。升级到 {min} 或更新版本后可用。',
    'This node’s version is too old to {feature}. Upgrade to {min} or later to use it.',
  ],
  'nodeOp.oldNoVersionNoMin': [
    '这个节点的版本较旧，不支持{feature}。升级到最新版本后可用。',
    'This node’s version is too old to {feature}. Upgrade to the latest version to use it.',
  ],
});

/**
 * agent-node 从哪一版起会答这个 op —— 以 npm 上真包里有没有这个 op 为准(2026-10-07 逐版 npm pack 核对):
 *  - read / write   #1755 → 2.5.0-preview.58(同 RULES_MIN_AGENT_NODE)
 *  - skills_list / skill_read  #1984 → 2.5.0-preview.85(.84 未发布)
 *  - files_list / file_read    #1999 → 2.5.0-preview.88(.87 没有)
 *  - logs_tail                 #2073 → 2.5.0-preview.91(.90 没有)
 */
export const NODE_OP_MIN_AGENT_NODE: Readonly<Record<string, string>> = {
  read: '2.5.0-preview.58',
  write: '2.5.0-preview.58',
  skills_list: '2.5.0-preview.85',
  skill_read: '2.5.0-preview.85',
  files_list: '2.5.0-preview.88',
  file_read: '2.5.0-preview.88',
  logs_tail: '2.5.0-preview.91',
};

const FEATURE_KEY: Readonly<Record<string, string>> = {
  read: 'nodeOp.feature.rules',
  write: 'nodeOp.feature.rulesWrite',
  skills_list: 'nodeOp.feature.skills',
  skill_read: 'nodeOp.feature.skills',
  files_list: 'nodeOp.feature.files',
  file_read: 'nodeOp.feature.files',
  logs_tail: 'nodeOp.feature.logs',
};

/** `unknown op logs_tail` / `Error: unknown op "skills_list"` → op 名;不是这类错误返回 null。 */
export function parseUnknownOp(error: string | null | undefined): string | null {
  const m = /\bunknown op\s+["'`]?([A-Za-z0-9_.:-]+)/i.exec(error ?? '');
  return m ? m[1] : null;
}

/** 显示用:`2.5.0-preview.88` → `v2.5.0-preview.88`(已带 v 的不重复加)。 */
export function displayVersion(v: string): string {
  const s = v.trim();
  return /^v/i.test(s) ? s : `v${s}`;
}

/**
 * error 是「unknown op <x>」⇒ 返回本地化的升级提示;否则 null(调用方照旧显示原因)。
 * 最低版本只对 agent-node 会话给(表是 agent-node 的);Claude Code 会话等只说「升级到最新版本」。
 * 节点自己报的版本已经 ≥ 表里的最低版本(说明表不准或节点报错了版本)时,也不再给一个会自相矛盾的最低版本。
 */
export function unknownOpMessage(
  error: string | null | undefined,
  session?: Pick<Session, 'agent' | 'version'> | null,
): string | null {
  const op = parseUnknownOp(error);
  if (!op) return null;
  const feature = FEATURE_KEY[op] ? t(FEATURE_KEY[op]) : t('nodeOp.feature.unknown', { op });
  const raw = typeof session?.version === 'string' ? session.version.trim() : '';
  const version = raw ? displayVersion(raw) : '';
  let min = isAgentNodeSession(session) ? NODE_OP_MIN_AGENT_NODE[op] ?? '' : '';
  if (min && raw && parseNodeVersion(raw) && (compareNodeVersion(raw, min) ?? -1) >= 0) min = '';
  const values = { version, feature, min: min ? displayVersion(min) : '' };
  if (version) return t(min ? 'nodeOp.oldWithMin' : 'nodeOp.oldNoMin', values);
  return t(min ? 'nodeOp.oldNoVersionWithMin' : 'nodeOp.oldNoVersionNoMin', values);
}
