// 新建节点向导:create_node 请求体的组装 + 「Codex（TUI 共存）」相关报错的人话。
// 纯函数(不 import react-native),向导 handleSubmit 和 create-request-status 都用它,
// src/create-node-request.test.ts 直接测。
//
// 背景(agent-network #2410 / 看板 #584、#595):daemon 只有在 node_spec.flags.copresence=true 时
// 才把子节点配置写成 codexCopresence:true;不带它,「Codex（TUI 共存）」建出来的是没有 TUI 的无头节点。
// 这个开关放在 flags 里而不是 node_spec 顶层,是为了让老 Hub / 老 daemon **报错**(flag_key_unknown)
// 而不是静默丢掉字段、照样建一个无头节点。

/** 只有这些 runtime 发 flags.copresence:true。Hub 对其它 runtime 会回 flag_not_applicable_to_runtime。 */
export const COPRESENCE_FLAG_RUNTIMES: readonly string[] = ['codex-app-server'];

export function copresenceFlags(runtimeId: string): { copresence?: true } {
  return COPRESENCE_FLAG_RUNTIMES.includes(runtimeId) ? { copresence: true } : {};
}

export interface CreateNodeSpecInput {
  name: string;
  runtimeId: string;
  model: string;
  /** 该 runtime 的建议模型(向导 RUNTIMES 表);共存 runtime 为空数组。 */
  runtimeModels: readonly string[];
  permissionMode: string;
  maxTurns: string;
  budget: string;
  timeoutMs: string;
  /** workdirForRequest(...) 的结果:{} 或 { workdir }。 */
  workdirField: { workdir?: string };
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
  return {
    name: i.name.trim(),
    runtime: i.runtimeId,
    // model 可空（hub 自 da84f34d 起 optional/nullable）：共存 runtime
    // 的 models 为空数组，跟随宿主 TUI 登录态 —— 此时必须**省略**字段，
    // 传空串仍会被 min(1) 拒。
    ...(model ? { model } : {}),
    flags: {
      permissionMode: i.permissionMode,
      ...(numOrUndef(i.maxTurns) !== undefined ? { maxTurns: numOrUndef(i.maxTurns) } : {}),
      ...(numOrUndef(i.budget) !== undefined ? { budget: numOrUndef(i.budget) } : {}),
      ...(numOrUndef(i.timeoutMs) !== undefined ? { timeout: numOrUndef(i.timeoutMs) } : {}),
      ...copresenceFlags(i.runtimeId),
    },
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
