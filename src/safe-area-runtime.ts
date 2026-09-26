// The platform facts the safe-area layout code reads, in one place, so the web sweep can
// simulate them (see safe-area-sim.ts). On a real device these are exactly Platform.OS and
// StatusBar.currentHeight.
import { Platform, StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { parseSafeAreaSim, type SimInsets } from './safe-area-sim';
import { modalSafePadding, type ModalKind } from './modal-safe-area';
import type { FullscreenPadding } from './rules-fullscreen-layout';

/** Non-null only on the web export with `?safeAreaSim=…`. */
export const SAFE_AREA_SIM: SimInsets | null = Platform.OS === 'web'
  ? parseSafeAreaSim(String((globalThis as { location?: { search?: string } }).location?.search ?? ''))
  : null;

/** The OS the inset rules should apply for ('android' under the simulation). */
export function layoutOs(): string {
  return SAFE_AREA_SIM ? 'android' : Platform.OS;
}

/** StatusBar.currentHeight (Android), or the simulated top inset. */
export function statusBarHeight(): number | undefined {
  return SAFE_AREA_SIM ? SAFE_AREA_SIM.top : StatusBar.currentHeight;
}

/**
 * The one modal-inset call: modal-safe-area.ts's table, fed this platform's facts. Every
 * <Modal>'s root view spreads this (enforced by src/safe-area-rule.test.ts).
 */
export function useModalSafePadding(kind: ModalKind): FullscreenPadding {
  return modalSafePadding(layoutOs(), kind, useSafeAreaInsets(), statusBarHeight());
}
