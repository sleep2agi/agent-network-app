/** Hub vault API keys, NOT Hub login or node identity tokens. Values are write-only. */
export function hubTokenInput(key: string, value: string) {
  const name = key.trim();
  return /^[A-Z][A-Z0-9_]{0,63}$/.test(name) && value.length > 0 && value.length <= 16384
    ? { key: name, value } : null;
}
export function parseHubTokenNames(value: unknown): string[] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.ok !== true || Object.keys(row).some(k => !['ok', 'keys'].includes(k))
    || !Array.isArray(row.keys) || !row.keys.every(k => typeof k === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(k))
    || new Set(row.keys).size !== row.keys.length) return null;
  return [...row.keys].sort() as string[];
}
