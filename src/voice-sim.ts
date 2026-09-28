// Web-only voice simulation for the hold-to-talk overlay check (tests/test-voice-hold-overlay/drive.mjs).
//
// The web export records through getUserMedia (Chromium's fake device is a constant beep) and
// never streams — streaming ASR is Android / iOS only (voice-stream-policy.ts) — so the overlay's
// two live inputs, the input level and the streaming partial text, cannot be exercised in a
// browser. `?voiceSim=1` exposes `window.__anetVoiceSim.{level(v), partial(text)}`; while set,
// they stand in for the recorder level / the streaming interim. Same gate shape as safeAreaSim:
// only when Platform.OS === 'web' AND the page URL carries the flag; a device never sees it.
//
// Pure (no react-native import); useVoiceInput passes the platform in.

export type VoiceSimState = { level: number | null; partial: string | null };

export function parseVoiceSim(search: string | null | undefined): boolean {
  try { return new URLSearchParams(String(search ?? '')).get('voiceSim') === '1'; } catch { return false; }
}

let state: VoiceSimState = { level: null, partial: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<VoiceSimState>) => { state = { ...state, ...patch }; for (const l of listeners) l(); };

export const voiceSimStore = {
  get: (): VoiceSimState => state,
  subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
  /** A new utterance starts from nothing (no partial left over from the previous one). */
  reset: () => set({ level: null, partial: null }),
};

/** Install the page hook once. Returns whether the simulation is active. */
export function installVoiceSim(os: string): boolean {
  if (os !== 'web') return false;
  const g = globalThis as { location?: { search?: string }; __anetVoiceSim?: unknown };
  if (!parseVoiceSim(g.location?.search)) return false;
  if (!g.__anetVoiceSim) {
    g.__anetVoiceSim = {
      level: (v: number) => set({ level: Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : null }),
      partial: (text: string) => set({ partial: typeof text === 'string' ? text : null }),
    };
  }
  return true;
}
