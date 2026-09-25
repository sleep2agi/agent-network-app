// 节点「环境变量」区块的纯逻辑。
//
// 节点把变量存在自己 config.json 的 env 块里(主仓 agent-node/src/runtime/node-env.ts,
// claude-code 会话的通道进程用同一份逐字节复制),经 rules-file 同一条门铃回来:
//   list_node_env  → 立即回 {write_allowed, write_blocked?};get_rules_file_result.content =
//                    JSON {keys:[{key,set,length,in_effect,kind,reserved?}], restart}
//   set_node_env   → content = JSON {key,set:true,length,requires_restart,restart}
//   unset_node_env → content = JSON {key,set:false,existed,requires_restart,restart}
// 🔴 值只写不读:hub 和节点都不会把值回给任何人,所以这里没有「显示」这件事。
// 🔴 密钥只在两段连接都加密(或在 hub 本机)时才允许写 —— hub 判,不满足回 insecure_transport;
//    list 的立即回复里先告诉我们,免得用户白敲一遍密钥。
// 纯逻辑,不 import react-native。

import type { RulesTarget, Session } from './api';
import { compareNodeVersion, isAgentNodeSession } from './node-rules';

export const ENV_MIN_AGENT_NODE = '2.5.0-preview.89';
export const ENV_MIN_ANET_FOR_CLAUDE_CODE = '2.3.0-preview.116';
export const ENV_MIN_HUB = '0.9.0-preview.60';

export const ENV_KEY_RE = /^[A-Z_][A-Z0-9_]{0,127}$/;
export const ENV_VALUE_MAX_BYTES = 8 * 1024;

export const WRITE_ONLY_NOTE = '值只写不读：保存后任何人（包括你）都看不到原值，只能覆盖或删除';
export const RESTART_NEEDED = '需要重启节点才生效';
export const INSECURE_NODE_MESSAGE = '这个节点经未加密的中继连接，暂不允许写入密钥；等中继启用加密后自动可用';
export const INSECURE_CLIENT_MESSAGE = '你的客户端经未加密的连接访问服务器，暂不允许写入密钥；改用 HTTPS 或在服务器本机上操作后可用';

export type EnvSupport =
  | { kind: 'capable' }
  | { kind: 'unsupported'; component: 'hub' | 'agent-node' | 'anet' | 'node'; version: string | null; minVersion: string | null };

/** 发请求**之前**判断节点能不能答;答不了当场说要升级什么(同 files / app#347)。 */
export function envSupport(session: (Pick<Session, 'agent' | 'version'> & { env_capable?: boolean }) | null | undefined): EnvSupport {
  if (session?.env_capable === true) return { kind: 'capable' };
  const version = session?.version ?? null;
  if (!session || !('env_capable' in session)) return { kind: 'unsupported', component: 'hub', version: null, minVersion: ENV_MIN_HUB };
  if (isAgentNodeSession(session)) return { kind: 'unsupported', component: 'agent-node', version, minVersion: ENV_MIN_AGENT_NODE };
  if (typeof session.agent === 'string' && session.agent.toLowerCase() === 'claude-code') {
    return { kind: 'unsupported', component: 'anet', version, minVersion: ENV_MIN_ANET_FOR_CLAUDE_CODE };
  }
  return { kind: 'unsupported', component: 'node', version, minVersion: null };
}

export function envUnsupportedMessage(s: Extract<EnvSupport, { kind: 'unsupported' }>): string {
  const ver = s.version ? `（v${s.version}）` : '';
  switch (s.component) {
    case 'hub':
      return `服务器版本还不支持管理节点环境变量，升级到 commhub-server ${s.minVersion} 或更新后可用`;
    case 'agent-node': {
      // 版本已经够:多半是节点没带配置文件启动(没有 config.json 就无处存放),或还没重连上报。
      const c = compareNodeVersion(s.version, s.minVersion ?? '');
      if (c !== null && c >= 0) return `这个节点${ver}没有上报环境变量能力：它可能不是用配置文件启动的（没有 config.json 就无处保存），或者还没重新连上服务器`;
      return `这个节点的 agent-node 版本${ver}还不支持环境变量，升级到 ${s.minVersion} 或更新后可用`;
    }
    case 'anet': {
      const c = compareNodeVersion(s.version, s.minVersion ?? '');
      if (c !== null && c >= 0) return `这个 Claude Code 会话${ver}没有上报环境变量能力：只有用 anet node start 启动、有自己节点配置的会话才能在这里管理`;
      return `这个 Claude Code 会话的 anet 版本${ver}还不支持环境变量，升级到 anet ${s.minVersion} 或更新并重启会话后可用`;
    }
    case 'node':
      return `这个节点还不支持环境变量（agent-node 需要 ${ENV_MIN_AGENT_NODE} 或更新，Claude Code 会话需要 anet ${ENV_MIN_ANET_FOR_CLAUDE_CODE} 或更新）`;
  }
}

/** 请求发给谁:有 nodes 行按 node_id,没有(claude-code 会话)按 alias。只在 capable 时有目标。 */
export function envTarget(args: {
  node: Pick<RulesTarget, 'node_id' | 'alias' | 'runtime'> | null | undefined;
  session: (Pick<Session, 'alias'> & { env_capable?: boolean }) | null | undefined;
}): RulesTarget | null {
  const { node, session } = args;
  if (session?.env_capable !== true) return null;
  if (node?.node_id) return { node_id: node.node_id, alias: node.alias, runtime: node.runtime ?? null };
  return session.alias ? { alias: session.alias } : null;
}

export type EnvRestartMode = 'remote' | 'manual';

export interface NodeEnvKey {
  key: string;
  length: number;
  inEffect: boolean;
  kind: 'plain' | 'ref';
  reserved: boolean;
}

export interface NodeEnvListing {
  keys: NodeEnvKey[];
  restart: EnvRestartMode;
}

/** 容错解析;坏条目丢掉。就算节点 / hub 出 bug 带回了多余字段(比如值),这里也只取白名单。 */
export function parseEnvListing(content: string | undefined | null): NodeEnvListing | null {
  if (!content) return null;
  let d: any;
  try { d = JSON.parse(content); } catch { return null; }
  if (!d || typeof d !== 'object' || !Array.isArray(d.keys)) return null;
  const keys: NodeEnvKey[] = [];
  const seen = new Set<string>();
  for (const k of d.keys) {
    if (!k || typeof k.key !== 'string' || !ENV_KEY_RE.test(k.key) || seen.has(k.key)) continue;
    if (typeof k.length !== 'number' || !Number.isInteger(k.length) || k.length < 0) continue;
    seen.add(k.key);
    keys.push({ key: k.key, length: k.length, inEffect: k.in_effect === true, kind: k.kind === 'ref' ? 'ref' : 'plain', reserved: k.reserved === true });
  }
  keys.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { keys, restart: d.restart === 'remote' ? 'remote' : 'manual' };
}

/** set / unset 的结果里只关心 restart 模式(以及 unset 时原来有没有)。 */
export function parseEnvChange(content: string | undefined | null): { restart: EnvRestartMode; existed?: boolean; requiresRestart: boolean } | null {
  if (!content) return null;
  let d: any;
  try { d = JSON.parse(content); } catch { return null; }
  if (!d || typeof d !== 'object' || typeof d.key !== 'string') return null;
  return {
    restart: d.restart === 'remote' ? 'remote' : 'manual',
    ...(typeof d.existed === 'boolean' ? { existed: d.existed } : {}),
    requiresRestart: d.requires_restart === true,
  };
}

/** 「已设置 · N 位」—— 只有长度,没有值。 */
export function lengthLabel(k: Pick<NodeEnvKey, 'length' | 'kind'>): string {
  if (k.kind === 'ref') return k.length > 0 ? `引用 · ${k.length} 位` : '引用 · 未解析';
  return `已设置 · ${k.length} 位`;
}

/** 行上的状态标签:保留 / 引用 / 待重启生效。 */
export function keyTags(k: NodeEnvKey): string[] {
  const out: string[] = [];
  if (k.reserved) out.push('保留');
  if (k.kind === 'ref') out.push('引用');
  if (!k.inEffect) out.push('待重启生效');
  return out;
}

/** 这一行能不能在这里改 / 删:保留名单里的键(手写进配置的)不行。 */
export const keyEditable = (k: NodeEnvKey): boolean => !k.reserved;

/** 输入框里的键:只留大写字母、数字、下划线(小写自动转大写)。 */
export function normalizeKeyInput(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9_]/g, '');
}

export function keyInputProblem(key: string): string | null {
  if (!key) return '请输入变量名';
  if (/^[0-9]/.test(key)) return '变量名不能以数字开头';
  if (key.length > 128) return '变量名最长 128 个字符';
  if (!ENV_KEY_RE.test(key)) return '变量名只能用大写字母、数字和下划线';
  return null;
}

function utf8Bytes(s: string): number {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}

export function valueInputProblem(value: string): string | null {
  if (!value) return '请输入值';
  if (value.includes('\0')) return '值里不能有空字符（NUL）';
  if (utf8Bytes(value) > ENV_VALUE_MAX_BYTES) return '值最长 8 KiB';
  return null;
}

/** 码点个数(与节点报的 length 同一口径)。 */
export function charCount(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

export function insecureMessage(leg: 'client' | 'node' | undefined | null): string {
  return leg === 'client' ? INSECURE_CLIENT_MESSAGE : INSECURE_NODE_MESSAGE;
}

/** hub 的错误码 → 一句中文。reason 只在 hub 给了解释时用(保留名单的原因由 hub 说了算)。 */
export function envErrorMessage(err: { error?: string | null; code?: string | null; reason?: string | null; leg?: 'client' | 'node' | null }): string {
  const code = err.code ?? err.error ?? '';
  switch (code) {
    case 'insecure_transport': return insecureMessage(err.leg ?? 'node');
    case 'invalid_env_key': return '变量名不合法：只能用大写字母、数字和下划线，不能以数字开头，最长 128 个字符';
    case 'reserved_env_key': return `这个变量名是节点运行时保留的，不能在这里设置${err.reason ? `（${err.reason}）` : ''}`;
    case 'invalid_env_value': return `值不合法${err.reason ? `（${err.reason}）` : '：不能为空，最长 8 KiB，不能含空字符'}`;
    case 'env_not_supported': return '这个节点没有上报环境变量能力（版本太旧、没有配置文件，或已离线）';
    case 'env_target_not_found': return '找不到这个节点（它可能已离线或改了名）';
    case 'node_token_cannot_manage_env': return '节点身份不能管理别的节点的环境变量，请用用户账号登录';
    case 'request_in_flight': return '节点还有一个环境变量请求没做完，请稍后再试';
    case 'node_not_found': return '找不到这个节点';
    case 'cross_network_node': return '这个节点属于另一个网络';
    default: return err.error || '未说明原因';
  }
}

export function envStatusMessage(status: 'pending' | 'in_progress' | 'done' | 'failed' | 'timeout', error: string | null, op: 'list' | 'write' = 'list'): string {
  switch (status) {
    case 'pending':
    case 'in_progress':
      return op === 'list' ? '正在向节点读取…' : '正在写入节点…';
    case 'done':
      return '';
    case 'failed':
      if (error && /^insecure_transport/.test(error)) return INSECURE_NODE_MESSAGE;
      return `${op === 'list' ? '节点读取失败' : '节点写入失败'}：${friendlyEnvNodeError(error)}`;
    case 'timeout':
      return '节点 60 秒内没有取走这次请求：多半是节点和服务器之间的实时连接断了，或节点卡住了；重启这个节点通常能恢复';
  }
}

export function friendlyEnvNodeError(error: string | null): string {
  const e = error ?? '';
  if (/no config\.json/.test(e)) return '这个节点没有配置文件（config.json），无处保存环境变量';
  if (/not valid JSON|not a JSON object/.test(e)) return '节点的 config.json 不是合法 JSON，未改动它';
  if (/link or not a regular file/.test(e)) return 'config.json 是链接或不是普通文件，拒绝写入';
  if (/not owned by/.test(e)) return 'config.json 不属于节点的运行用户，拒绝写入';
  if (/reserved_env_key/.test(e)) return '这个变量名是节点运行时保留的';
  if (/invalid_env_key/.test(e)) return '变量名不合法';
  if (/invalid_env_value/.test(e)) return '值不合法';
  if (/config write failed/.test(e)) return `写入配置文件失败${/\(([A-Z0-9_]+)\)/.exec(e)?.[1] ? `（${/\(([A-Z0-9_]+)\)/.exec(e)![1]}）` : ''}`;
  return e || '未说明原因';
}

/** 改完之后怎么让它生效。remote 且有 node_id、hub 没说不可控 ⇒ 可以一键重启。 */
export function restartPlan(args: {
  restart: EnvRestartMode | null | undefined;
  node: { node_id?: string | null; lifecycle_controllable?: boolean } | null | undefined;
  alias: string;
}): { kind: 'button' } | { kind: 'manual'; text: string } {
  const { restart, node, alias } = args;
  if (restart === 'remote' && node?.node_id && node.lifecycle_controllable !== false) return { kind: 'button' };
  return { kind: 'manual', text: `请在节点所在的机器上重启它：anet node stop ${alias}，然后 anet node start ${alias}` };
}
