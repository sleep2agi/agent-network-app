// 设置 → 外观:字体大小 + 界面密度 两个分段控件、实时预览、恢复默认。
// The model (options, defaults, OS-scale composition, storage) is src/ui-scale.ts. Choosing an
// option re-keys the whole tree (App.tsx), so the preview below — built from the same Text /
// Ionicons / AliasAvatar / ds() as the real screens — is always rendered at the chosen scale.
import { useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './ui-text';
import { Ionicons } from './icons';
import AliasAvatar from './AliasAvatar';
import { colors, radius, spacing } from './theme';
import { saveUiScalePrefs } from './storage';
import { AGENT_ROW_AVATAR, AGENT_ROW_DOT, AGENT_ROW_GAP, AGENT_ROW_HEIGHT, AGENT_ROW_PAD_X, AGENT_ROW_PAD_Y, AGENT_ROW_TOUCH_MIN } from './agent-row-model';
import {
  DENSITY_OPTIONS,
  FONT_SIZE_OPTIONS,
  ds,
  listFont,
  onUiScalePrefsChange,
  setUiScalePrefs,
  uiScale,
  uiScaleLayoutWide,
  uiScalePrefs,
  uiScalePrefsKey,
  uiScaleSummary,
  type UiScalePrefs,
} from './ui-scale';

type SharedStyles = {
  row: object; themeRow: object; rowCopy: object; themeRowCopy: object; rowLabel: object; rowHint: object;
  segmented: object; segment: object; segmentSelected: object; segmentText: object; segmentTextSelected: object;
  actionButton: object; actionButtonText: object;
};

const persist = (next: Partial<UiScalePrefs>) => {
  setUiScalePrefs(next);
  void saveUiScalePrefs(uiScalePrefs());
};

function Segmented<K extends string>({ label, options, selectedKey, isDefault, onPick, s, testPrefix }: {
  label: string;
  options: readonly { key: K; label: string }[];
  selectedKey: K;
  isDefault: boolean;
  onPick: (k: K) => void;
  s: SharedStyles;
  testPrefix: string;
}) {
  return (
    <View style={s.segmented} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map(o => {
        const selected = selectedKey === o.key;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="radio"
            accessibilityState={{ selected, checked: selected }}
            accessibilityLabel={o.label}
            testID={`${testPrefix}-${o.key}`}
            style={({ pressed }) => [s.segment, selected && s.segmentSelected, pressed && !selected && { opacity: 0.6 }]}
            // Picking the option that is only the *default* stores it explicitly (so unfolding /
            // folding no longer changes it); picking the already-stored one is a no-op.
            onPress={() => { if (!selected || isDefault) onPick(o.key); }}
          >
            <Text style={[s.segmentText, selected && s.segmentTextSelected]} numberOfLines={1}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function UiScaleSettings({ s, showFont, showDensity }: { s: SharedStyles; showFont: boolean; showDensity: boolean }) {
  // Re-render on a preference change even when nothing visible changes (「默认」 label).
  useSyncExternalStore(onUiScalePrefsChange, uiScalePrefsKey, uiScalePrefsKey);
  const r = uiScale();
  const wide = uiScaleLayoutWide();
  const summary = uiScaleSummary(r, wide);
  const anyStored = !r.fontIsDefault || !r.densityIsDefault;
  if (!showFont && !showDensity) return null;
  return (
    <View testID="settings-ui-scale">
      {showFont ? (
        <View style={[s.row, s.themeRow]} testID="settings-font-size-row">
          <View style={[s.rowCopy, s.themeRowCopy]}>
            <Text style={s.rowLabel}>字体大小</Text>
            <Text style={s.rowHint} testID="settings-font-size-summary">{summary.font}</Text>
            {summary.osNote ? <Text style={s.rowHint} testID="settings-font-size-os">{summary.osNote}</Text> : null}
          </View>
          <Segmented label="字体大小" options={FONT_SIZE_OPTIONS} selectedKey={r.font} isDefault={r.fontIsDefault} s={s} testPrefix="settings-font-size" onPick={font => persist({ font })} />
        </View>
      ) : null}
      {showDensity ? (
        <View style={[s.row, s.themeRow]} testID="settings-density-row">
          <View style={[s.rowCopy, s.themeRowCopy]}>
            <Text style={s.rowLabel}>界面密度</Text>
            <Text style={s.rowHint} testID="settings-density-summary">{summary.density}</Text>
            <Text style={s.rowHint}>图标、头像、行高和间距</Text>
          </View>
          <Segmented label="界面密度" options={DENSITY_OPTIONS} selectedKey={r.density} isDefault={r.densityIsDefault} s={s} testPrefix="settings-density" onPick={density => persist({ density })} />
        </View>
      ) : null}
      <UiScalePreview />
      <View style={[s.row, { justifyContent: 'flex-end' }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="恢复默认字体大小和界面密度"
          testID="settings-ui-scale-reset"
          disabled={!anyStored}
          onPress={() => persist({ font: null, density: null })}
          style={({ pressed }) => [s.actionButton, !anyStored && { opacity: 0.45 }, pressed && { opacity: 0.6 }]}
        >
          <Text style={s.actionButtonText}>恢复默认</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** A sample agent row + a chat bubble pair + a button, built from the real primitives. */
export function UiScalePreview() {
  const st = makePreviewStyles();
  return (
    <View style={st.frame} testID="settings-ui-scale-preview" accessibilityLabel="预览">
      <Text style={st.caption}>预览</Text>
      <View style={st.row}>
        <View style={st.avatar}>
          <AliasAvatar alias="预览助手" size={AGENT_ROW_AVATAR} />
          <View style={[st.dot, { backgroundColor: colors.running, borderColor: colors.card }]} />
        </View>
        <View style={st.body}>
          <View style={st.line}>
            <Text dense numberOfLines={1} style={st.name}>预览助手</Text>
            <Ionicons name="pin" size={12} color={colors.textMuted} />
            <Text dense style={st.time}>10:24</Text>
          </View>
          <View style={st.line}>
            <Text dense numberOfLines={1} style={st.preview}>好的，我来整理今天的任务清单</Text>
            <View style={st.badge}><Text dense style={st.badgeText}>2</Text></View>
          </View>
        </View>
      </View>
      <View style={st.chat}>
        <View style={[st.bubble, st.bubbleThem]}><Text style={st.bubbleText}>这周的构建都通过了吗？</Text></View>
        <View style={[st.bubble, st.bubbleMe]}><Text style={[st.bubbleText, { color: colors.onAccent }]}>都通过了，报告已发到群里。</Text></View>
      </View>
      <View style={st.buttons}>
        <View style={st.button}>
          <Ionicons name="send" size={16} color={colors.onAccent} />
          <Text style={st.buttonText}>发送</Text>
        </View>
      </View>
    </View>
  );
}

// Built per render (cheap, a handful of entries): it must follow both the theme and the scale.
const makePreviewStyles = () => StyleSheet.create({
  frame: { marginHorizontal: spacing.md, marginTop: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.card, overflow: 'hidden' },
  caption: { color: colors.textMuted, fontSize: 11, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  // Same geometry and list text as AgentsScreen's phone row (makeRowStyles).
  row: { flexDirection: 'row', alignItems: 'center', gap: ds(AGENT_ROW_GAP), minHeight: ds(AGENT_ROW_HEIGHT, AGENT_ROW_TOUCH_MIN), paddingHorizontal: ds(AGENT_ROW_PAD_X), paddingVertical: ds(AGENT_ROW_PAD_Y) },
  avatar: { width: ds(AGENT_ROW_AVATAR), height: ds(AGENT_ROW_AVATAR) },
  dot: { position: 'absolute', right: -1, bottom: -1, width: ds(AGENT_ROW_DOT), height: ds(AGENT_ROW_DOT), borderRadius: ds(AGENT_ROW_DOT) / 2, borderWidth: 2 },
  body: { flex: 1, minWidth: 0, gap: ds(3) },
  line: { flexDirection: 'row', alignItems: 'center', gap: ds(6), minHeight: ds(20) },
  name: { flexShrink: 1, color: colors.text, fontSize: listFont(16), fontWeight: '500' },
  time: { marginLeft: 'auto', color: colors.textMuted, fontSize: listFont(12) },
  preview: { flex: 1, minWidth: 0, color: colors.textMuted, fontSize: listFont(14) },
  badge: { minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, backgroundColor: colors.failed, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#ffffff', fontSize: 10, fontWeight: '600', lineHeight: 12 },
  chat: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.bg },
  bubble: { maxWidth: '80%', borderRadius: 12, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  bubbleThem: { alignSelf: 'flex-start', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  bubbleMe: { alignSelf: 'flex-end', backgroundColor: colors.accent },
  bubbleText: { color: colors.text, fontSize: 14, lineHeight: 20 },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', padding: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  button: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, height: ds(36), paddingHorizontal: spacing.lg, borderRadius: radius.sm, backgroundColor: colors.accent },
  buttonText: { color: colors.onAccent, fontSize: 13, fontWeight: '600' },
});
