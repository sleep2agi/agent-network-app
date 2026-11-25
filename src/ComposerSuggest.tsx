import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "./ui-text";
import AliasAvatar from "./AliasAvatar";
import { Ionicons } from "./icons";
import { t } from "./i18n";
import { colors, onThemeChange, radius, spacing } from "./theme";
import { ds } from "./ui-scale";

export type SuggestRow = {
  id: string;
  group: string;
  label: string;
  description: string;
  /** Optional avatar alias for @ mention rows. */
  avatarAlias?: string;
  /** Optional display name when distinct from @alias. */
  sublabel?: string;
  /** Optional online presence indicator for @ mention rows. */
  online?: boolean;
};

export function ComposerSuggest(props: {
  rows: SuggestRow[];
  active: number;
  empty: string;
  loading?: boolean;
  loadingText?: string;
  error?: string | null;
  onRetry?: () => void;
  /** 选中的候选里含节点技能时的一句边界说明：#886「技能发送先区分调用提示和原生执行」。 */
  note?: string;
  onPick: (index: number) => void;
}) {
  const { rows, active, empty, loading = false, loadingText, error, onRetry, note, onPick } = props;
  const showKeyHint = Platform.OS === "web" && rows.length > 0;
  return (
    <View style={styles.box} testID="composer-suggest">
      {loading && rows.length === 0 ? (
        <View style={styles.stateRow} testID="composer-suggest-loading">
          <ActivityIndicator size="small" color={colors.accent} />
          <Text style={styles.stateText}>{loadingText || t("chat.mention.loading")}</Text>
        </View>
      ) : error && rows.length === 0 ? (
        <View style={styles.stateRow} testID="composer-suggest-error">
          <Ionicons name="alert-circle-outline" size={16} color={colors.failed} />
          <Text style={styles.stateError} numberOfLines={2}>{error}</Text>
          {onRetry ? (
            <Pressable
              testID="composer-suggest-retry"
              accessibilityRole="button"
              onPress={onRetry}
              style={({ pressed }) => [styles.retryPill, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.retryText}>{t("chat.mention.retry")}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : rows.length === 0 ? (
        <View style={styles.stateRow} testID="composer-suggest-empty">
          <Ionicons name="search-outline" size={15} color={colors.textMuted} />
          <Text style={styles.empty}>{empty}</Text>
        </View>
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled" style={styles.scroll} showsVerticalScrollIndicator>
          {rows.map((row, index) => {
            const showGroup = index === 0 || rows[index - 1]!.group !== row.group;
            const isActive = index === active;
            const isMention = typeof row.avatarAlias === "string" && row.avatarAlias.length > 0;
            return (
              <View key={row.id}>
                {showGroup ? (
                  <View style={styles.groupRow}>
                    <Text style={styles.group}>{row.group}</Text>
                    {index === 0 && showKeyHint ? (
                      <Text style={styles.keyHint}>{t("chat.mention.keyHint")}</Text>
                    ) : null}
                  </View>
                ) : null}
                <Pressable
                  testID={`composer-suggest-row-${row.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={row.label}
                  accessibilityState={{ selected: isActive }}
                  onPress={() => onPick(index)}
                  style={({ pressed }) => [
                    styles.row,
                    isActive && styles.rowActive,
                    pressed && styles.rowPressed,
                  ]}
                >
                  {isMention ? (
                    <View style={styles.avatarWrap}>
                      <AliasAvatar alias={row.avatarAlias!} size={26} />
                      <View
                        style={[
                          styles.statusDot,
                          { backgroundColor: row.online ? colors.running : colors.rest },
                        ]}
                      />
                    </View>
                  ) : null}
                  <View style={styles.rowBody}>
                    <View style={styles.titleLine}>
                      <Text style={[styles.label, isActive && styles.labelActive]} numberOfLines={1}>
                        {row.label}
                      </Text>
                      {row.sublabel ? (
                        <Text style={styles.sublabel} numberOfLines={1}>{row.sublabel}</Text>
                      ) : null}
                    </View>
                    {row.description ? (
                      <Text style={styles.desc} numberOfLines={1}>{row.description}</Text>
                    ) : null}
                  </View>
                  {isMention ? (
                    <View style={[styles.presencePill, row.online ? styles.presenceOnline : styles.presenceOffline]}>
                      <Text style={[styles.presenceText, { color: row.online ? colors.running : colors.textMuted }]}>
                        {row.online ? t("chat.mention.online") : t("chat.mention.offline")}
                      </Text>
                    </View>
                  ) : null}
                </Pressable>
              </View>
            );
          })}
        </ScrollView>
      )}
      {note ? <Text style={styles.note} testID="composer-suggest-note">{note}</Text> : null}
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  box: {
    width: "100%",
    maxWidth: 440,
    alignSelf: "flex-start",
    maxHeight: 280,
    borderRadius: radius.surface,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
    elevation: 10,
    shadowColor: "#000",
    shadowOpacity: 0.14,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
  scroll: { maxHeight: 244, paddingVertical: 4 },
  groupRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingTop: 6,
    paddingBottom: 4,
    gap: 8,
  },
  group: { color: colors.textMuted, fontSize: ds(11), fontWeight: "600" },
  keyHint: { color: colors.textMuted, fontSize: ds(10), opacity: 0.85 },
  note: { color: colors.textMuted, fontSize: ds(11), lineHeight: 15, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 6,
    marginVertical: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: radius.item,
  },
  rowActive: { backgroundColor: colors.inputBg },
  rowPressed: { opacity: 0.72 },
  avatarWrap: { position: "relative", width: 26, height: 26, flexShrink: 0 },
  statusDot: {
    position: "absolute",
    right: -1,
    bottom: -1,
    width: 8,
    height: 8,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.card,
  },
  rowBody: { flex: 1, minWidth: 0 },
  titleLine: { flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 },
  label: { color: colors.text, fontSize: ds(13.5), fontWeight: "500", flexShrink: 1 },
  labelActive: { color: colors.accent },
  sublabel: { color: colors.textMuted, fontSize: ds(11.5), flexShrink: 1 },
  desc: { color: colors.textMuted, fontSize: ds(11.5), marginTop: 1 },
  presencePill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.pill,
    flexShrink: 0,
  },
  presenceOnline: { backgroundColor: "rgba(34, 197, 94, 0.12)" },
  presenceOffline: { backgroundColor: colors.inputBg },
  presenceText: { fontSize: ds(10.5), fontWeight: "500" },
  stateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  stateText: { color: colors.textMuted, fontSize: ds(12.5) },
  stateError: { flex: 1, color: colors.failed, fontSize: ds(12.5) },
  retryPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.item,
    backgroundColor: colors.inputBg,
  },
  retryText: { color: colors.accent, fontSize: ds(12), fontWeight: "600" },
  empty: { color: colors.textMuted, fontSize: ds(12.5) },
});
let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
