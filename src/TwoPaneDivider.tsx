// Draggable divider between the agent list and the chat in the Android two-pane
// (unfolded foldable / tablet). Logic: pane-divider.ts (pure, tested). This file only draws.
//
// The finger strip is DIVIDER_HIT_WIDTH (28 dp) wide and sits over the pane border, which
// stays a 1 px line. A grip pill in the middle marks it; while the finger is down the
// grip and the line switch to the accent colour and follow the finger, and the panes
// re-lay out once on release (see pane-divider.ts for why).
import { useMemo, useRef, useState } from 'react';
import { PanResponder, Platform, View } from 'react-native';
import { lockDocumentSelection } from './composer-resize';
import { DIVIDER_HIT_OVER_LIST, DIVIDER_HIT_WIDTH, dividerDragHandlers, dividerHitLeft, dividerStep } from './pane-divider';
import { colors, radius } from './theme';

export default function TwoPaneDivider({
  width,
  areaWidth,
  onWidth,
}: {
  /** Committed list width (dp). */
  width: number;
  /** Width the two panes split (beside the rail). */
  areaWidth: number;
  /** Called once per drag, on release (and on each TalkBack step). */
  onWidth: (width: number) => void;
}) {
  const [preview, setPreview] = useState<number | null>(null);
  const widthRef = useRef(width); widthRef.current = width;
  const areaRef = useRef(areaWidth); areaRef.current = areaWidth;
  const onWidthRef = useRef(onWidth); onWidthRef.current = onWidth;
  // 🔴 Created once (empty deps): a new PanResponder mid-drag restarts dx from 0.
  const pan = useMemo(() => PanResponder.create(dividerDragHandlers({
    getWidth: () => widthRef.current,
    getArea: () => areaRef.current,
    setPreview,
    commit: w => onWidthRef.current(w),
    lockSelection: Platform.OS === 'web' ? () => lockDocumentSelection() : undefined,
  })), []);

  const dragging = preview !== null;
  const shown = preview ?? width;
  return (
    <View
      testID="two-pane-divider"
      {...pan.panHandlers}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="拖动调整列表宽度"
      accessibilityValue={{ min: 0, max: Math.round(areaWidth), now: Math.round(width), text: `${Math.round(width)} dp` }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={e => {
        const a = e.nativeEvent.actionName;
        if (a === 'increment' || a === 'decrement') onWidth(dividerStep(width, areaWidth, a));
      }}
      {...({ dataSet: { dragging: dragging ? '1' : '0', listWidth: String(Math.round(shown)) } } as object)}
      style={[
        s.hit,
        { left: dividerHitLeft(shown) },
        Platform.OS === 'web' ? ({ cursor: 'col-resize', touchAction: 'none', userSelect: 'none' } as object) : null,
      ]}
    >
      {/* The line itself: the list pane already draws a 1 px border; while dragging, this
          accent line is where the border will land on release. */}
      {dragging ? <View style={[s.line, { left: DIVIDER_HIT_OVER_LIST - 1, backgroundColor: colors.accent }]} /> : null}
      <View
        testID="two-pane-divider-grip"
        style={[
          s.grip,
          { left: DIVIDER_HIT_OVER_LIST - (dragging ? 3 : 2) },
          dragging ? { width: 6, height: 44, marginTop: -22, backgroundColor: colors.accent, opacity: 1 } : { backgroundColor: colors.textMuted },
        ]}
      />
    </View>
  );
}

const s = {
  hit: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: DIVIDER_HIT_WIDTH,
    zIndex: 20,
  },
  line: { position: 'absolute', top: 0, bottom: 0, width: 2 },
  grip: {
    position: 'absolute',
    top: '50%',
    marginTop: -18,
    width: 4,
    height: 36,
    borderRadius: radius.pill,
    opacity: 0.45,
  },
} as const;
