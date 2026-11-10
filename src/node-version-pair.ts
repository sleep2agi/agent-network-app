// #4463 —— 把节点**自报的**版本显示出来，并指向权威的配对方式。
//
// 🔴 为什么这里**不给**安装命令（第一版我给了，被仓库的护栏挡下，护栏是对的）：
// `src/daemon-overview.test.ts` 有一条不变量 —— UI 源码里不许出现
//   npm i|install|add … @sleep2agi/(agent-node|agent-network)
// 理由写在护栏旁边：**两个包各自的 dist-tag 会独立变化，即使都给 preview，
// 也不能据此认为它们配对**。所以任何「拼出来的安装命令」都可能是错的。
//
// 客户端能诚实提供的只有两件事：
//   1. 这台节点**自己上报**的版本；
//   2. 取精确配对的方法 —— `anet pair`（配对表内置在 CLI 里，它说了算）。
//
// 🔴 两个字段来源不同，缺一个不代表另一个不可信（生产实测）：
//   · `launched_by_cli_version` 只有**新版 CLI 启动的节点**才上报（343 个节点里 2 个）；
//   · agent-node 版本在 status 行的 `version` 上，几乎所有节点都有。
// 所以这里**逐项显示**：知道一个就说一个，不知道的那个明确说「未上报」，
// 绝不因为缺一个就把另一个也吞掉（那会让这个面板对 99% 的节点显示「未知」）。
//
// 纯逻辑，不 import react-native：可以脱离设备单测。

export interface VersionPairInput {
  /** Hub /api/nodes 的 `launched_by_cli_version`（启动这个节点的 CLI 版本）。 */
  cliVersion?: string | null;
  /** 节点自报在 /api/status 行 `version` 上的 agent-node 版本。 */
  nodeVersion?: string | null;
}

export type VersionPairHint =
  | { kind: 'ready'; cliVersion: string | null; nodeVersion: string | null; invalid: string[]; guidance: string }
  | { kind: 'unknown'; missing: ('cli' | 'node')[]; invalid: string[]; guidance: string };

/** 取精确配对的方法。这是唯一权威：配对表在 CLI 里，不在 UI 里。 */
export const PAIR_GUIDANCE = '要装成精确配对，在这台机器的节点目录执行 `anet pair`，它给出的版本是配对的。';
export const MISSING_GUIDANCE = '节点还没上报版本，所以这里不显示配对信息（不猜、不补默认值）。';
export const NOT_REPORTED = '未上报';

/** 版本串的白名单：字母数字开头，只允许 . + -。
 *
 * 这不是「校验 semver」——真实版本里有 `2.3.0-preview.231` 这种，也可能有本地构建串。
 * 目的是别把奇怪内容当成版本显示出来（会让用户以为是某个真实版本）。 */
const VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/;

const normalize = (
  value?: string | null,
): { kind: 'ok'; value: string } | { kind: 'missing' } | { kind: 'invalid'; value: string } => {
  if (value === undefined || value === null) return { kind: 'missing' };
  const trimmed = String(value).trim();
  if (!trimmed) return { kind: 'missing' };
  return VERSION_RE.test(trimmed) ? { kind: 'ok', value: trimmed } : { kind: 'invalid', value: trimmed };
};

export function versionPairHint(input: VersionPairInput): VersionPairHint {
  const cli = normalize(input.cliVersion);
  const node = normalize(input.nodeVersion);
  const missing: ('cli' | 'node')[] = [];
  const invalid: string[] = [];
  if (cli.kind !== 'ok') missing.push('cli');
  if (node.kind !== 'ok') missing.push('node');
  if (cli.kind === 'invalid') invalid.push(cli.value);
  if (node.kind === 'invalid') invalid.push(node.value);
  if (cli.kind !== 'ok' && node.kind !== 'ok') {
    return { kind: 'unknown', missing, invalid, guidance: MISSING_GUIDANCE };
  }
  return {
    kind: 'ready',
    cliVersion: cli.kind === 'ok' ? cli.value : null,
    nodeVersion: node.kind === 'ok' ? node.value : null,
    // 不合法的那一侧也带出来：显示上会写成「未上报」，但排障时要能看到**原值**，
    // 否则「为什么这一栏空着」又变成一个只能猜的问题。
    invalid,
    guidance: PAIR_GUIDANCE,
  };
}
