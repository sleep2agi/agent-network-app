export function unavailableAiReason(state: string | null | undefined, supported: boolean) {
  if (!supported || state === 'unsupported_version') return '版本不支持';
  switch (state) {
    case 'not_logged_in': return '未登录';
    case 'missing_cli': return '未安装';
    case 'no_network': return '暂时连不上';
    default: return '暂时用不了';
  }
}
