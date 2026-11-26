// The platform facts the safe-area layout code reads, in one place, so the web sweep can
// simulate them (see safe-area-sim.ts). On a real device these are exactly Platform.OS and
// StatusBar.currentHeight.
import { Platform, StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { parseSafeAreaSim, type SimInsets } from './safe-area-sim';
import { readHarmonyInsets } from './harmony-bridge';
import { modalSafePadding, type ModalKind } from './modal-safe-area';
import type { FullscreenPadding } from './rules-fullscreen-layout';

/** Non-null only on the web export with `?safeAreaSim=…`. */
export const SAFE_AREA_SIM: SimInsets | null = Platform.OS === 'web'
  ? parseSafeAreaSim(String((globalThis as { location?: { search?: string } }).location?.search ?? ''))
  : null;

/** Live insets override on web: `?safeAreaSim=…` in tests, or native HarmonyOS ArkWeb avoid areas. */
export function webSafeAreaOverride(): SimInsets | null {
  if (Platform.OS !== 'web') return null;
  return SAFE_AREA_SIM ?? readHarmonyInsets();
}

/** The OS the inset rules should apply for ('android' under simulation or HarmonyOS ArkWeb shell). */
export function layoutOs(): string {
  return webSafeAreaOverride() ? 'android' : Platform.OS;
}

/** StatusBar.currentHeight (Android), or the simulated / HarmonyOS top inset. */
export function statusBarHeight(): number | undefined {
  const override = webSafeAreaOverride();
  return override ? override.top : StatusBar.currentHeight;
}

/**
 * The one modal-inset call: modal-safe-area.ts's table, fed this platform's facts. Every
 * <Modal>'s root view spreads this (enforced by src/safe-area-rule.test.ts).
 */
export function useModalSafePadding(kind: ModalKind): FullscreenPadding {
  return modalSafePadding(layoutOs(), kind, useSafeAreaInsets(), statusBarHeight());
}
