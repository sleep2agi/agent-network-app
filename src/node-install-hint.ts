// #4463 —— 客户端显示「按这台节点自报的版本」推导出的精确安装命令。
//
// 为什么需要它：用户看到「配不上」的错误时，最需要的是一行能直接粘贴的命令；
// 现在他得自己去跑 `anet pair`。
//
// 🔴 三条红线（都来自 #4412 的教训）：
//   1. 版本只来自**节点自报**，客户端不猜、不写死 tag；
//   2. 缺任何一个就不给命令（永远不给单边安装命令 —— 单边正是当初那类事故的成因）；
//   3. 命令只是「复现这台节点当前的组合」，**不是**「配对的正确答案」。
//      正确答案以 `anet pair` 的输出为准（配对表内置在 CLI 里），所以 ready 时也要带上这句。
//
// 纯逻辑，不 import react-native：这样可以脱离设备单测。

export interface InstallHintInput {
  /** Hub /api/nodes 的 `launched_by_cli_version`（启动这个节点的 CLI 版本）。 */
  cliVersion?: string | null;
  /** Hub /api/nodes 的 `agent_node_version`（节点自报的 agent-node 版本）。 */
  nodeVersion?: string | null;
}

export type InstallHint =
  | { kind: 'ready'; cliVersion: string; nodeVersion: string; command: string; note: string }
  | { kind: 'unknown'; missing: ('cli' | 'node')[]; invalid: string[]; note: string };

/** 版本串的白名单：字母数字开头，只允许 . + -；不允许空白、@、/、: 等。
 *
 * 这不是「校验 semver」—— 真实版本里有 `2.3.0-preview.231` 这种，也可能有本地构建串。
 * 目的是**防止把奇怪的东西拼进一条让用户粘贴执行的命令里**。 */
const VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/;

export const PAIR_AUTHORITY_NOTE = '这只是这台节点当前跑的版本组合；配对的正确答案以 `anet pair` 的输出为准。';
export const MISSING_VERSION_NOTE = '节点还没自报版本，所以这里不给安装命令（不猜、不给单边命令）。';

const normalize = (value?: string | null): { kind: 'ok'; value: string } | { kind: 'missing' } | { kind: 'invalid'; value: string } => {
  if (value === undefined || value === null) return { kind: 'missing' };
  const trimmed = String(value).trim();
  if (!trimmed) return { kind: 'missing' };
  return VERSION_RE.test(trimmed) ? { kind: 'ok', value: trimmed } : { kind: 'invalid', value: trimmed };
};

/** 两个包必须一起给：单边安装命令会装出配不上的 CLI/node（#4412 的原始事故）。 */
export function installCommand(cliVersion: string, nodeVersion: string): string {
  return `npm install -g @sleep2agi/agent-network@${cliVersion} @sleep2agi/agent-node@${nodeVersion}`;
}

export function installHint(input: InstallHintInput): InstallHint {
  const cli = normalize(input.cliVersion);
  const node = normalize(input.nodeVersion);
  const missing: ('cli' | 'node')[] = [];
  const invalid: string[] = [];
  if (cli.kind !== 'ok') missing.push('cli');
  if (node.kind !== 'ok') missing.push('node');
  if (cli.kind === 'invalid') invalid.push(cli.value);
  if (node.kind === 'invalid') invalid.push(node.value);
  if (cli.kind !== 'ok' || node.kind !== 'ok') {
    return { kind: 'unknown', missing, invalid, note: MISSING_VERSION_NOTE };
  }
  return {
    kind: 'ready',
    cliVersion: cli.value,
    nodeVersion: node.value,
    command: installCommand(cli.value, node.value),
    note: PAIR_AUTHORITY_NOTE,
  };
}
