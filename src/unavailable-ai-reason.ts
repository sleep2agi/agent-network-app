export function unavailableAiReason(state: string | null | undefined, supported: boolean) {
  if (!supported || state === 'unsupported_version') return '版本不支持';
  switch (state) {
    case 'not_logged_in': return '未登录';
    case 'missing_cli': return '未安装';
    case 'no_network': return '暂时连不上';
    default: return '暂时用不了';
  }
}

/**
 * The one command that fixes this, or undefined when there is no single correct command.
 * A wrong command is worse than none: only pairs known to be right are listed here.
 */
export function unavailableAiCommand(aiId: string, state: string | null | undefined): string | undefined {
  const claude = aiId.startsWith('claude'), codex = aiId.startsWith('codex'), agy = aiId.startsWith('antigravity');
  if (state === 'not_logged_in') return codex ? 'codex login --device-auth' : agy ? 'agy acp --login' : claude ? 'claude' : undefined;
  if (state === 'missing_cli') return claude ? 'npm i -g @anthropic-ai/claude-code' : codex ? 'npm i -g @openai/codex' : undefined;
  return undefined;
}
