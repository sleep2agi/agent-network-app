// Codex 执行权限 —— 与 agent-network `codexSdkYoloFlags()` / 节点 `flags` 对齐。
//   approvalPolicy: "never"
//   sandboxMode: "danger-full-access"
//   skipGitRepoCheck: true
//
// TUI 共存还会在 create 时发 `copresenceFullAccess: true`(hub/daemon 映射为
// config.codexCopresenceFullAccess),否则 co-presence 路径仍会以 read-only 起 TUI。

export const CODEX_AUTO_EXECUTE_DEFAULT = true;

export const CODEX_YOLO_APPROVAL_POLICY = 'never';
export const CODEX_YOLO_SANDBOX_MODE = 'danger-full-access';

export const CODEX_YOLO_FLAG_KEYS = ['approvalPolicy', 'sandboxMode', 'skipGitRepoCheck'] as const;

export type CodexYoloFlagKey = (typeof CODEX_YOLO_FLAG_KEYS)[number];

export function codexYoloFlagsRecord(): Record<string, string | boolean> {
  return {
    approvalPolicy: CODEX_YOLO_APPROVAL_POLICY,
    sandboxMode: CODEX_YOLO_SANDBOX_MODE,
    skipGitRepoCheck: true,
  };
}

/** 与 `anet node create --no-yolo` 相反:默认自动执行、不弹确认。 */
export function codexYoloFlagsForCreate(
  runtimeId: string,
  autoExecute: boolean,
): Record<string, unknown> {
  if (!autoExecute) return {};
  if (runtimeId === 'codex-sdk' || runtimeId === 'codex-app-server') {
    const flags: Record<string, unknown> = { ...codexYoloFlagsRecord() };
    if (runtimeId === 'codex-app-server') flags.copresenceFullAccess = true;
    return flags;
  }
  return {};
}

export function isCodexAutoExecuteActive(flags: Record<string, unknown> | undefined | null): boolean {
  if (!flags) return false;
  return (
    flags.approvalPolicy === CODEX_YOLO_APPROVAL_POLICY
    && flags.sandboxMode === CODEX_YOLO_SANDBOX_MODE
    && flags.skipGitRepoCheck === true
  );
}

export const CODEX_EXECUTION_TOO_OLD =
  '这台机器的 Hub 或 daemon 版本太旧，还不支持 Codex 自动执行（approvalPolicy / sandboxMode 等）配置。请先把 Hub 和 agent-node 升级到最新预览版，再重新创建或改节点设置。';

const EXECUTION_FLAG_RE = /flag_key_unknown:(approvalPolicy|sandboxMode|skipGitRepoCheck|copresenceFullAccess)\b/;

export function describeCodexExecutionFlagError(e: {
  error?: string | null;
  field?: string | null;
}): string | null {
  const err = (e.error ?? '').trim();
  if (EXECUTION_FLAG_RE.test(err)) return CODEX_EXECUTION_TOO_OLD;
  if (/^flag_key_unknown\b/.test(err) && e.field && (CODEX_YOLO_FLAG_KEYS as readonly string[]).includes(e.field)) {
    return CODEX_EXECUTION_TOO_OLD;
  }
  if (/^flag_key_unknown\b/.test(err) && e.field === 'copresenceFullAccess') return CODEX_EXECUTION_TOO_OLD;
  return null;
}
