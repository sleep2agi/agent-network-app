// Chat time stamps that are never cut (board #683) — see chat-time-layout.ts for the defect and
// the rule. Used by every chat surface that shows a time next to a name or in a centred pill:
// ChatScreen (author lines of sent / foreign / reply bubbles, the search result meta, the time
// pill) and DmChatScreen (author line, time pill).
import { memo } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { Text } from './ui-text';
import { uiScale, RN_DEFAULT_FONT_SIZE } from './ui-scale';
import { chatTimeLayout, META_SEPARATOR, timeTextFloor } from './chat-time-layout';

/**
 * The floor for `text` at the size the ui-text wrapper will actually draw `style` with.
 * Native only: the short measurement is a native-text-layout effect (the owner's iPhone; #312's
 * Android 「06:1」). The browser lays a Text out at exactly the width it paints (the web drive
 * measures it: before the fix the pill was already exact in Chromium), so on web — the desktop
 * shell — a floor would only add slack: a sent bubble's 「me · 08:20」 would end ≈ 9 px short of
 * the bubble's right edge (measured). Web gets the structural half of the fix alone.
 */
function floorFor(text: string, style: StyleProp<TextStyle>): number {
  if (Platform.OS === 'web') return 0;
  const base = (StyleSheet.flatten(style)?.fontSize as number | undefined) ?? RN_DEFAULT_FONT_SIZE;
  return timeTextFloor(text, base * uiScale().fontMultiplier);
}

// Layout fragments hold no spacing tokens, so one set serves every render.
const L = chatTimeLayout();

// One style object per (floor, alignment): a long chat renders hundreds of these, and a fresh
// inline object per row per render is re-resolved every time on react-native-web.
const timeStyles = new Map<string, TextStyle>();
function timeStyle(minWidth: number, align: 'left' | 'center'): TextStyle {
  const k = `${minWidth}|${align}`;
  let s = timeStyles.get(k);
  if (!s) { s = { minWidth, fontVariant: ['tabular-nums'], textAlign: align }; timeStyles.set(k, s); }
  return s;
}

/**
 * 「name · time」 on one line: the name is ellipsized when the line is too narrow, the time never
 * is. `textStyle` is the line's text look (colour / size / lineHeight); `style` the row's box
 * (margins). The row sits wherever its column aligns it (sent bubbles: right). The floor's slack
 * always sits at the line's outer end (time left-aligned in its box): a gap inside 「name · time」
 * reads as a bug, a few points at the end of the line does not.
 */
export const ChatMetaLine = memo(function ChatMetaLine({ name, time, textStyle, style, testID }: {
  name: string;
  time?: string;
  textStyle: StyleProp<TextStyle>;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const timeText = time ? `${META_SEPARATOR}${time}` : '';
  return (
    <View style={[L.metaRow, style]} testID={testID}>
      <Text style={[textStyle, L.metaName]} numberOfLines={1} ellipsizeMode="tail" testID={testID ? `${testID}-name` : undefined}>{name}</Text>
      {timeText ? (
        <Text style={[textStyle, L.metaTime, timeStyle(floorFor(timeText, textStyle), 'left')]} numberOfLines={1} testID={testID ? `${testID}-time` : undefined}>{timeText}</Text>
      ) : null}
    </View>
  );
});

/** Centred time pill between message clusters. `boxStyle` = background / radius / padding / margins. */
export const ChatTimePill = memo(function ChatTimePill({ time, boxStyle, textStyle, testID }: {
  time: string;
  boxStyle: StyleProp<ViewStyle>;
  textStyle: StyleProp<TextStyle>;
  testID?: string;
}) {
  return (
    <View style={[L.pillBox, boxStyle]} testID={testID}>
      <Text style={[textStyle, L.pillText, timeStyle(floorFor(time, textStyle), 'center')]} numberOfLines={1}>{time}</Text>
    </View>
  );
});
