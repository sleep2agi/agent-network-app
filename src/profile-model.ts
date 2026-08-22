/** Stable, non-secret Profile identifier. This is used for local namespacing,
 * not as a credential hash. */
export const profileIdFor = (serverUrl: string, username: string, networkId?: string): string => {
  const normalizedUrl = serverUrl.trim().replace(/\/$/, '').toLowerCase();
  const input = `${normalizedUrl}\n${username.trim().toLowerCase()}\n${networkId ?? ''}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `p_${hash.toString(16).padStart(8, '0')}`;
};

