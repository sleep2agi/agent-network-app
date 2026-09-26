// Text / TextInput that apply the 字体大小 setting (src/ui-scale.ts). Every screen imports
// these instead of react-native's — ui-scale-wiring.test.ts fails any file that goes back to
// importing Text/TextInput straight from 'react-native'.
//
// Why a wrapper and not fs() on every style: 429 fontSize literals live in 36 StyleSheets AND
// in ~105 inline style objects (LogsScreen, NodeFilesSection, NodeModelSection…); a wrapper
// reaches all 710 <Text> and 42 <TextInput> — including inline styles, `type.*` tokens and
// text with no fontSize at all — with a one-line import change per file and no per-literal
// edits that could be missed or doubled.
//
// OS font scale: the wrapper renders with allowFontScaling={false} and applies the combined
// multiplier itself (in-app choice × OS scale clamped to 0.85–1.15, total 0.8–1.5; see
// fontMultiplier). Letting RN also apply the OS scale would multiply twice and would bring back
// the uncapped blow-up on large system fonts.
//
// Nested <Text> inherits its parent's fontSize in RN; the context below keeps a nested Text
// with no fontSize from being given a (second) default size.
import { createContext, forwardRef, useContext } from 'react';
import {
  StyleSheet,
  Text as RNText,
  TextInput as RNTextInput,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
} from 'react-native';
import { scaleTextStyle, uiScale, type TextStyleLike } from './ui-scale';

const InsideText = createContext(false);


const scaled = (style: StyleProp<TextStyle>, dense: boolean, nested: boolean, fixed = false): StyleProp<TextStyle> => {
  if (fixed) return style;
  const s = uiScale();
  const m = dense ? s.denseFontMultiplier : s.fontMultiplier;
  if (m === 1) return style;
  return scaleTextStyle(StyleSheet.flatten(style) as TextStyleLike | undefined, m, nested) as TextStyle | undefined;
};

export type ScaledTextProps = TextProps & {
  /** List rows, rail labels, badges: the OS scale may not push these past DENSE_FONT_CAP. */
  dense?: boolean;
  /**
   * Glyphs sized to a box rather than read as text (the avatar initial): no font scaling at all —
   * the box already follows 界面密度, and a font multiplier on top would overflow it.
   */
  fixedSize?: boolean;
};

export const Text = forwardRef<RNText, ScaledTextProps>(function Text({ style, dense = false, fixedSize = false, ...rest }, ref) {
  const nested = useContext(InsideText);
  const node = <RNText ref={ref} {...rest} allowFontScaling={false} style={scaled(style, dense, nested, fixedSize)} />;
  return nested ? node : <InsideText.Provider value={true}>{node}</InsideText.Provider>;
});

export type ScaledTextInputProps = TextInputProps & { dense?: boolean };

export const TextInput = forwardRef<RNTextInput, ScaledTextInputProps>(function TextInput({ style, dense = false, ...rest }, ref) {
  return <RNTextInput ref={ref} {...rest} allowFontScaling={false} style={scaled(style, dense, false)} />;
});

// `Text`/`TextInput` are also used as types (useRef<TextInput>) across the app.
export type Text = RNText;
export type TextInput = RNTextInput;
