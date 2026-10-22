// Public GETs must not use appFetch's pooled desktop transport: its wire format
// has no redirect policy and buffers the complete response before IPC.
import type { SkillFetch } from './skill-plaza-model';

export const fetchPublicSkill: SkillFetch = async (url, init) => {
  const options: RequestInit = { signal: init?.signal, credentials: 'omit', redirect: 'error' };
  if ((globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
    const { fetch } = await import('@tauri-apps/plugin-http');
    return fetch(url, { ...options, maxRedirections: 0 });
  }
  // Expo SDK56 installs streaming fetch globally on native too. If a build
  // overrides that with a non-streaming transport, the bounded reader refuses;
  // never fall back to text()/arrayBuffer() and buffer an unbounded response.
  return globalThis.fetch(url, options);
};
