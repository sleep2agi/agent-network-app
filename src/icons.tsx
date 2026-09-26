// Ionicons with the 界面密度 setting applied to `size` (src/ui-scale.ts ds()). Screens import
// `{ Ionicons } from './icons'` instead of '@expo/vector-icons' — one import per file reaches
// every icon (105 literal sizes across 19 files) without editing each size.
// ui-scale-wiring.test.ts fails any file that imports Ionicons from '@expo/vector-icons' directly.
import { forwardRef, type ComponentProps } from 'react';
import { Ionicons as ExpoIonicons } from '@expo/vector-icons';
import { ds } from './ui-scale';

type Props = ComponentProps<typeof ExpoIonicons>;

/** @expo/vector-icons' own default when `size` is omitted. */
export const ICON_DEFAULT_SIZE = 12;

const Scaled = forwardRef<any, Props>(function Ionicons({ size, ...rest }, ref) {
  return <ExpoIonicons ref={ref} {...rest} size={ds(typeof size === 'number' ? size : ICON_DEFAULT_SIZE)} />;
});

/** Same shape as @expo/vector-icons' Ionicons (component + glyphMap), size scaled by density. */
export const Ionicons = Object.assign(Scaled, { glyphMap: ExpoIonicons.glyphMap }) as unknown as typeof ExpoIonicons;
