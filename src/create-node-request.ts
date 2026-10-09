// 新建节点向导:create_node 请求体的组装 + 「Codex（TUI 共存）」相关报错的人话。
// 纯函数(不 import react-native),向导 handleSubmit 和 create-request-status 都用它,
// src/create-node-request.test.ts 直接测。
//
// 背景(agent-network #2410 / 看板 #584、#595):daemon 只有在 node_spec.flags.copresence=true 时
// 才把子节点配置写成 codexCopresence:true;不带它,「Codex（TUI 共存）」建出来的是没有 TUI 的无头节点。
// 这个开关放在 flags 里而不是 node_spec 顶层,是为了让老 Hub / 老 daemon **报错**(flag_key_unknown)
// 而不是静默丢掉字段、照样建一个无头节点。

import { normalizeNodeName } from './node-name';
import { opencodeCreateFlags, type OpenCodeGeneration } from './opencode-create-options';

/** 只有这些 runtime 发 flags.copresence:true。Hub 对其它 runtime 会回 flag_not_applicable_to_runtime。 */
export const COPRESENCE_FLAG_RUNTIMES: readonly string[] = ['codex-app-server'];

export function copresenceFlags(runtimeId: string): { copresence?: true } {
  return COPRESENCE_FLAG_RUNTIMES.includes(runtimeId) ? { copresence: true } : {};
}

/** 向导第 4 步「参数」可能出现的设置。 */
export type WizardParam = 'permissionMode' | 'maxTurns' | 'budget';

/**
 * #591 —— 每个 runtime 在向导里显示(并发送)哪些参数。Hub 对 7 个 runtime 一视同仁地收
 * permissionMode/maxTurns/budget/timeout(server/src/create-node-validate.ts:54 FLAG_KEYS),daemon 原样
 * 写进子节点 config.flags(agent-node/src/runtime/create-node-daemon.ts childConfigFieldsFromSpec)——
 * **收下不等于生效**。谁真读,看 agent-network 仓 origin/main(eee23141)的消费点:
 *
 *   claude-agent-sdk  permissionMode  agent-node/src/cli.ts:2804(→ SDK options.permissionMode)
 *                     maxTurns        agent-node/src/cli.ts:779 / :2815
 *                     budget          agent-node/src/cli.ts:787 / :2873(→ maxBudgetUsd,美元)
 *   codex-sdk         只读 timeout(cli.ts:846 / :3390);不读 permissionMode/maxTurns/budget
 *   codex-app-server  一个都不读(processWithCodexAppServer cli.ts:3859 不传任何 flags)
 *   grok-build-acp    一个都不读(超时走 flags.grokAcpTimeoutMs,cli.ts:4104)
 *   grok-build-cli    maxTurns 只在无头通道读(cli.ts:4987);共存通道见到 maxTurns 直接拒绝启动
 *                     (cli.ts:4326-4333)——向导里它就是「共存模式」,所以不显示
 *   opencode-cli      只读 timeout(runtime/opencode-timeout.ts:39)
 *   claude-code-cli   不走 agent-node;anet 启动器只读 dangerouslySkipPermissions / teammateMode
 *                     (agent-network/bin/cli.ts:7324 / :7336)
 *
 * 🔴 timeout 对谁都不显示:Hub 只收 1..86400 的整数(create-node-validate.ts:131,看上去是秒),
 *    agent-node 却按**毫秒**读(cli.ts:812-818 默认 "300000";config-apply.ts:161 也写明 ms)。
 *    在向导里填 600(以为 10 分钟)= 0.6 秒超时,每个任务都失败;想填真正的毫秒数又过不了 Hub。
 *    单位对齐之前,不让用户在这里设它(各 runtime 用自己的默认值:claude/codex 300s、opencode 30min)。
 * 不在表里的 runtime ⇒ 空:我们说不清它读什么,就不给它摆一个旋钮。
 */
export const WIZARD_RUNTIME_PARAMS: Readonly<Record<string, readonly WizardParam[]>> = {
  'claude-agent-sdk': ['permissionMode', 'maxTurns', 'budget'],
  'codex-sdk': [],
  'codex-app-server': [],
  'grok-build-acp': [],
  'grok-build-cli': [],
  'opencode-cli': [],
  'claude-code-cli': [],
};

export function wizardParamsFor(runtimeId: string): readonly WizardParam[] {
  return WIZARD_RUNTIME_PARAMS[runtimeId] ?? [];
}

// 没有适用参数的 runtime 不进第 4 步(#614,create-node-steps.ts),确认页一行说明 SKIPPED_PARAMS_TEXT。

export interface CreateNodeSpecInput {
  name: string;
  runtimeId: string;
  model: string;
  /** 该 runtime 的建议模型(向导 RUNTIMES 表);共存 runtime 为空数组。 */
  runtimeModels: readonly string[];
  permissionMode: string;
  maxTurns: string;
  budget: string;
  /** workdirForRequest(...) 的结果:{} 或 { workdir }。 */
  workdirField: { workdir?: string };
  opencodeGeneration?: OpenCodeGeneration;
  opencodeUnsafeTools?: boolean;
}

export interface CreateNodeSpec {
  name: string;
  runtime: string;
  model?: string;
  flags?: Record<string, unknown>;
  workdir?: string;
}

export function buildCreateNodeSpec(i: CreateNodeSpecInput): CreateNodeSpec {
  const numOrUndef = (v: string) => (v.trim() === '' ? undefined : Number(v));
  const model = i.model || i.runtimeModels[0];
  // #591 —— 只发这个 runtime 真会读的设置(向导第 4 步也只显示这些)。用户先在 Claude 下填了
  // maxTurns 再切到 Codex,那个值不能跟着溜进请求。
  const params = wizardParamsFor(i.runtimeId);
  const flags: Record<string, unknown> = {
    ...(params.includes('permissionMode') ? { permissionMode: i.permissionMode } : {}),
    ...(params.includes('maxTurns') && numOrUndef(i.maxTurns) !== undefined ? { maxTurns: numOrUndef(i.maxTurns) } : {}),
    ...(params.includes('budget') && numOrUndef(i.budget) !== undefined ? { budget: numOrUndef(i.budget) } : {}),
    ...copresenceFlags(i.runtimeId),
    ...opencodeCreateFlags({ ...i, model: model ?? '' }),
  };
  return {
    // #652 —— Hub 存的是 trim + NFC 后的名字(normalizeNodeName,与 Hub/daemon 同一个函数)。
    name: normalizeNodeName(i.name),
    runtime: i.runtimeId,
    // model 可空（hub 自 da84f34d 起 optional/nullable）：共存 runtime
    // 的 models 为空数组，跟随宿主 TUI 登录态 —— 此时必须**省略**字段，
    // 传空串仍会被 min(1) 拒。
    ...(model ? { model } : {}),
    // flags 在 Hub(create-node-validate.ts buildAnetArgs)和 daemon(childConfigFieldsFromSpec)都是可选的;
    // 没有适用项就整个不发,而不是发一个空对象。
    ...(Object.keys(flags).length ? { flags } : {}),
    ...i.workdirField,
  };
}

export const COPRESENCE_TOO_OLD =
  '这台机器的 Hub 或 daemon 版本太旧，还不支持建 Codex 共存节点。请先把 Hub 和 agent-node 升级到最新预览版，再重新创建。';

export const COPRESENCE_MISSING_DEPS =
  '目标机器起不来 Codex 共存节点：它需要装好 tmux 和 codex，并且已经登录 codex（在那台机器上运行 codex login）。';

/**
 * create_node / 创建请求的报错 → 共存相关的人话;不是共存相关的返回 null(调用方按原来的方式显示)。
 *   - Hub 拒:error="flag_key_unknown",field="copresence"
 *   - daemon 拒:error 里带 "flag_key_unknown:copresence"(如 "validate: flag_key_unknown:copresence")
 *   - runtime_capability_check_failed(只对共存 runtime 换说法,runtime 未知时不换),detail = 服务器原文
 */
export function describeCopresenceError(e: { error?: string | null; field?: string | null; status?: string | null; runtime?: string | null }): string | null {
  const err = (e.error ?? '').trim();
  if (/flag_key_unknown:copresence\b/.test(err) || (/^flag_key_unknown\b/.test(err) && e.field === 'copresence')) {
    return COPRESENCE_TOO_OLD;
  }
  const capFailed = e.status === 'runtime_capability_check_failed' || /^runtime_capability_check_failed\b/.test(err);
  if (capFailed && e.runtime != null && COPRESENCE_FLAG_RUNTIMES.includes(e.runtime)) {
    const detail = err.replace(/^runtime_capability_check_failed[:：]?\s*/, '');
    return detail ? `${COPRESENCE_MISSING_DEPS}\n服务器原话：${detail}` : COPRESENCE_MISSING_DEPS;
  }
  return null;
}
