// app#168 —— 会话置顶的纯函数部分(不 import expo/RN,bun 单测直接跑)。
/** 手机端没有 profileId 时按 server+username 分;文件名只留安全字符。 */
export function pinScopeKey(cfg: { profileId?: string; serverUrl?: string; username?: string }): string {
  const raw = cfg.profileId || `${cfg.serverUrl ?? ''}|${cfg.username ?? ''}`;
  return raw.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 120) || 'default';
}

export function togglePinned(current: readonly string[], alias: string): string[] {
  if (!alias) return [...current];
  return current.includes(alias) ? current.filter(a => a !== alias) : [...current, alias];
}
