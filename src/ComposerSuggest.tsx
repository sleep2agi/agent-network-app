import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "./ui-text";
import AliasAvatar from "./AliasAvatar";
import { COMPOSER_CARD_INSET } from "./composer-resize";
import { elevated } from "./elevation";
import { colors, onThemeChange, radius, spacing, type, weight } from "./theme";

export type SuggestRow = {
  id: string;
  group: string;
  label: string;
  description: string;
  /** Alias whose AliasAvatar leads the row: the current node for `/`, the agent itself for `@`. */
  avatar: string;
};

// 输入框上方的圆角浮卡(与桌面输入卡片同一左右内缩、同一圆角档),不是一块贴边的列表。
// 每行:头像 | 名字一行 + 灰色说明一行;分组标题单独一行;键盘选中行用浅底。点选只填草稿(ChatScreen.pickSuggest)。
export function ComposerSuggest(props: {
  rows: SuggestRow[];
  active: number;
  empty: string;
  onPick: (index: number) => void;
}) {
  const { rows, active, empty, onPick } = props;
  return (
    <View style={styles.box} testID="composer-suggest">
      <ScrollView keyboardShouldPersistTaps="handled" style={styles.scroll} contentContainerStyle={styles.content}>
        {rows.length === 0 ? <Text style={styles.empty}>{empty}</Text> : rows.map((row, index) => {
          const showGroup = index === 0 || rows[index - 1]!.group !== row.group;
          return (
            <View key={row.id}>
              {showGroup ? <Text style={[styles.group, index > 0 && styles.groupGap]} numberOfLines={1}>{row.group}</Text> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${row.label} ${row.description}`}
                accessibilityState={{ selected: index === active }}
                onPress={() => onPick(index)}
                style={state => [
                  styles.row,
                  index === active ? styles.rowActive : (state as { hovered?: boolean }).hovered || state.pressed ? styles.rowHover : null,
                ]}
              >
                <AliasAvatar alias={row.avatar} size={28} />
                <View style={styles.text}>
                  <Text style={styles.label} numberOfLines={1}>{row.label}</Text>
                  <Text style={styles.desc} numberOfLines={1}>{row.description}</Text>
                </View>
              </Pressable>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  box: {
    marginHorizontal: COMPOSER_CARD_INSET,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
    maxHeight: 280,
    borderRadius: radius.surface,
    backgroundColor: colors.card,
    ...elevated("floating"),
    overflow: "hidden",
  },
  scroll: { maxHeight: 280 },
  content: { padding: spacing.xs },
  group: {
    color: colors.textMuted,
    fontSize: type.small,
    fontWeight: weight.medium,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs,
  },
  groupGap: { marginTop: spacing.xs },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.item,
  },
  rowHover: { backgroundColor: colors.rowHover },
  rowActive: { backgroundColor: colors.rowActive },
  text: { flex: 1, minWidth: 0 },
  label: { color: colors.text, fontSize: type.body, lineHeight: 20, fontWeight: weight.medium },
  desc: { color: colors.textMuted, fontSize: type.small, lineHeight: 16, marginTop: 1 },
  empty: { color: colors.textMuted, fontSize: type.small, padding: spacing.md },
});
let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
