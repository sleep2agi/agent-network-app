import { ActivityIndicator, Pressable, StyleSheet, View, type GestureResponderEvent } from 'react-native';
import { Text } from './ui-text';
import { Ionicons } from './icons';
import { colors, onThemeChange, radius, themeMode, weight } from './theme';
import { filePresentation, fileStatusKey, formatFileSize, type FileCardStatus } from './attachment-file-model';
import { useTranslation } from './i18n-react';
import './i18n-chat';

export default function AttachmentFileCard({ name, mime, size, status = 'ready', detail, progress, onPress, testID = 'attachment-file-card' }: {
  name: string; mime?: string; size?: number; status?: FileCardStatus; detail?: string;
  /** 下载中的人话进度（「62% · 剩余约 8 秒」）；有就接在状态后面。 */
  progress?: string;
  onPress?: (event: GestureResponderEvent) => void; testID?: string;
}) {
  const { t } = useTranslation();
  const file = filePresentation(name, mime);
  const isDark = themeMode() === 'dark';
  const ink = isDark ? file.darkColor : file.color;
  const iconBg = `${ink}${isDark ? '1c' : '12'}`;
  const iconBorder = `${ink}${isDark ? '36' : '26'}`;
  const busy = status === 'uploading' || status === 'downloading';
  const failed = status === 'error' || status === 'sendFailed';
  const sizeText = formatFileSize(size);
  const statusText = t(fileStatusKey[status]);
  return (
    <Pressable testID={testID} style={({ pressed }) => [styles.card, pressed && onPress && styles.pressed]}
      accessibilityRole={onPress ? 'button' : undefined} accessibilityLabel={`${name}, ${sizeText ?? ''}, ${statusText}${detail ? `, ${detail}` : ''}`}
      accessibilityState={{ disabled: !onPress || busy, busy }} disabled={!onPress || busy} onPress={onPress}>
      <View style={styles.body}>
        <View style={styles.info}>
          <View style={styles.title} testID="attachment-file-name">
            <Text style={[styles.name, styles.stem]} numberOfLines={2} ellipsizeMode="tail">{file.extension ? name.slice(0, -file.extension.length) : name}</Text>
            {file.extension ? <Text style={[styles.name, styles.extension]} numberOfLines={1} ellipsizeMode="middle" testID="attachment-file-extension">{file.extension}</Text> : null}
          </View>
          <View style={styles.meta}>
            {sizeText ? <Text style={styles.secondary}>{sizeText}</Text> : null}
            {busy ? <ActivityIndicator size="small" color={colors.textMuted} testID="attachment-file-busy" /> : null}
            <Text style={[styles.secondary, failed && styles.error]} testID={`attachment-file-status-${status}`}>{statusText}{progress ? ` · ${progress}` : ''}</Text>
          </View>
        </View>
        <View
          testID="attachment-file-icon"
          style={[styles.iconTile, { backgroundColor: iconBg, borderColor: iconBorder }]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Ionicons name={file.icon} size={22} color={ink} />
          <Text style={[styles.iconBadge, { color: ink }]} numberOfLines={1} testID="attachment-file-badge">{file.badge}</Text>
        </View>
      </View>
      <View style={styles.footer}>
        <Text style={[styles.footerText, failed && styles.error]} numberOfLines={2}>{detail || `${file.extension ? file.extension.slice(1).toUpperCase() : file.label} ${t('chat.fileKindSuffix')}`}</Text>
      </View>
    </Pressable>
  );
}

const makeStyles = () => StyleSheet.create({
  card: { width: 300, maxWidth: '100%', alignSelf: 'flex-start', marginTop: 6, borderRadius: radius.control, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, overflow: 'hidden' },
  pressed: { opacity: 0.8 },
  body: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, gap: 14, minHeight: 82 },
  info: { flex: 1, minWidth: 0 },
  name: { fontSize: 15, lineHeight: 21, fontWeight: '500', color: colors.text },
  title: { flexDirection: 'row', alignItems: 'flex-end' },
  stem: { flexShrink: 1, minWidth: 0 },
  extension: { flexShrink: 0, maxWidth: '45%' },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 6 },
  secondary: { fontSize: 11, lineHeight: 16, color: colors.textMuted },
  iconTile: { width: 48, height: 54, borderRadius: radius.control, borderWidth: 1, justifyContent: 'center', alignItems: 'center', gap: 3, paddingHorizontal: 4 },
  iconBadge: { fontSize: 9, lineHeight: 11, fontWeight: weight.strong, letterSpacing: 0.5 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 7 },
  footerText: { color: colors.textMuted, fontSize: 11, lineHeight: 16 },
  error: { color: colors.failed },
});
let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
