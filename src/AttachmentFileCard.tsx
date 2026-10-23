import { ActivityIndicator, Pressable, StyleSheet, View, type GestureResponderEvent } from 'react-native';
import { Text } from './ui-text';
import { colors, onThemeChange, radius, weight } from './theme';
import { filePresentation, fileStatusText, formatFileSize, type FileCardStatus } from './attachment-file-model';

export default function AttachmentFileCard({ name, mime, size, status = 'ready', detail, onPress, testID = 'attachment-file-card' }: {
  name: string; mime?: string; size?: number; status?: FileCardStatus; detail?: string;
  onPress?: (event: GestureResponderEvent) => void; testID?: string;
}) {
  const file = filePresentation(name, mime);
  const busy = status === 'uploading' || status === 'downloading';
  const failed = status === 'error' || status === 'sendFailed';
  const sizeText = formatFileSize(size);
  const statusText = fileStatusText[status];
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
            <Text style={[styles.secondary, failed && styles.error]} testID={`attachment-file-status-${status}`}>{statusText}</Text>
          </View>
        </View>
        <View style={[styles.icon, { backgroundColor: file.color }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View style={styles.fold} /><View style={styles.foldCut} />
          <Text style={styles.iconLabel}>{file.label}</Text>
        </View>
      </View>
      <View style={styles.footer}>
        <Text style={[styles.footerText, failed && styles.error]} numberOfLines={2}>{detail || `${file.extension ? file.extension.slice(1).toUpperCase() : file.label} 文件`}</Text>
      </View>
    </Pressable>
  );
}

const makeStyles = () => StyleSheet.create({
  card: { width: 300, maxWidth: '100%', alignSelf: 'flex-start', marginTop: 6, borderRadius: radius.control, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, overflow: 'hidden' },
  pressed: { opacity: 0.8 },
  body: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 16, minHeight: 100 },
  info: { flex: 1, minWidth: 0 },
  name: { fontSize: 15, lineHeight: 21, fontWeight: '500', color: colors.text },
  title: { flexDirection: 'row', alignItems: 'flex-end' },
  stem: { flexShrink: 1, minWidth: 0 },
  extension: { flexShrink: 0, maxWidth: '45%' },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 8 },
  secondary: { fontSize: 11, lineHeight: 16, color: colors.textMuted },
  icon: { width: 46, height: 56, borderRadius: radius.mark, overflow: 'hidden', justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 9 },
  foldCut: { position: 'absolute', top: 0, right: 0, borderTopWidth: 13, borderLeftWidth: 13, borderTopColor: colors.card, borderLeftColor: 'transparent' },
  fold: { position: 'absolute', top: 0, right: 0, width: 13, height: 13, backgroundColor: '#ffffff55', borderBottomLeftRadius: radius.inline },
  iconLabel: { color: '#ffffff', fontSize: 10, fontWeight: weight.strong },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 7 },
  footerText: { color: colors.textMuted, fontSize: 11, lineHeight: 16 },
  error: { color: colors.failed },
});
let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
