// Web-only safe-area simulation for the layout sweep (tests/test-layout-sweep/run.mjs).
//
// A browser has no status bar and no gesture bar, so on the web export every inset is 0 and
// every "who pads the status bar" bug is invisible — the owner kept finding them on the phone
// instead (2026-09-26: 新建定时任务 取消/保存 under the clock; 节点信息 double inset in the
// two-pane). `?safeAreaSim=top,right,bottom,left` makes the web build lay out as Android
// edge-to-edge would: useSafeAreaInsets() returns those numbers, StatusBar.currentHeight reads
// as `top`, and the layout helpers see os = 'android'.
//
// Pure (no react-native import) so safe-area-sim.test.ts can check the parser.

export interface SimInsets { top: number; right: number; bottom: number; left: number }

/** `?safeAreaSim=32,0,24,40` → insets (top,right,bottom,left). Anything malformed → null. */
export function parseSafeAreaSim(search: string | null | undefined): SimInsets | null {
  let raw: string | null = null;
  try { raw = new URLSearchParams(String(search ?? '')).get('safeAreaSim'); } catch { return null; }
  if (!raw) return null;
  const parts = raw.split(',').map(s => s.trim());
  if (parts.length !== 4) return null;
  const n = parts.map(Number);
  if (n.some(v => !Number.isFinite(v) || v < 0 || v > 200)) return null;
  return { top: n[0], right: n[1], bottom: n[2], left: n[3] };
}
