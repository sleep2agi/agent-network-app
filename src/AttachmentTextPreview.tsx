// admin 2026-11-11「能不能新增 md 文档预览啊」：聊天里的 .md / 文本附件点「预览」直接在应用里看，
// 不必先下载再去文件夹里找。Markdown 用聊天同一套 MarkdownMessage 渲染；其它文本等宽显示。
// 只读、只在内存里：不落盘、不改文件。
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './ui-text';
import { Ionicons } from './icons';
import MarkdownMessage from './MarkdownMessage';
import { appFetch } from './app-fetch';
import { downloadAuthedBytes } from './desktop-download';
import { decodePreviewText, isMarkdownFile } from './attachment-file-model';
import { colors, radius, onThemeChange } from './theme';
import { useTranslation } from './i18n-react';
import { useModalSafePadding } from './safe-area-runtime';
import './i18n-chat';

export function TextPreviewLink({ onPress, name }: { onPress: () => void; name: string }) {
  const { t } = useTranslation();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${t('chat.file.preview')} ${name}`} testID="attachment-file-preview" onPress={onPress} hitSlop={6}>
      <Text style={{ color: colors.accent, fontSize: 12 }}>{t('chat.file.preview')}</Text>
    </Pressable>
  );
}

export default function AttachmentTextPreview({ url, token, name, mime, onClose }: {
  url: string; token: string; name: string; mime?: string; onClose: () => void;
}) {
  const { t } = useTranslation();
  const safe = useModalSafePadding('overlay');
  const [state, setState] = useState<{ kind: 'loading' } | { kind: 'ready'; text: string; truncated: boolean } | { kind: 'error'; message: string }>({ kind: 'loading' });
  const [raw, setRaw] = useState(false);
  useEffect(() => {
    let live = true;
    downloadAuthedBytes(appFetch, url, token).then(bytes => {
      if (!live) return;
      const decoded = decodePreviewText(bytes);
      setState(decoded.ok ? { kind: 'ready', text: decoded.text, truncated: decoded.truncated }
        : { kind: 'error', message: t(decoded.reason === 'binary' ? 'chat.file.previewBinary' : 'chat.file.previewTooLarge') });
    }).catch(error => { if (live) setState({ kind: 'error', message: error instanceof Error ? error.message : String(error) }); });
    return () => { live = false; };
  }, [url, token]);
  const markdown = isMarkdownFile(name, mime);
  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <Pressable style={[styles.backdrop, { paddingTop: safe.paddingTop + 16, paddingBottom: safe.paddingBottom + 16, paddingLeft: safe.paddingLeft + 16, paddingRight: safe.paddingRight + 16 }]} onPress={onClose} accessibilityLabel={t('chat.file.previewClose')}>
        <Pressable style={styles.sheet} onPress={() => {}} testID="attachment-text-preview">
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1} testID="attachment-text-preview-name">{name}</Text>
            {markdown && state.kind === 'ready' ? (
              <Pressable accessibilityRole="button" testID="attachment-text-preview-raw" onPress={() => setRaw(v => !v)} hitSlop={6}>
                <Text style={styles.toggle}>{raw ? t('chat.file.previewRendered') : t('chat.file.previewSource')}</Text>
              </Pressable>
            ) : null}
            <Pressable accessibilityRole="button" accessibilityLabel={t('chat.file.previewClose')} testID="attachment-text-preview-close" onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </Pressable>
          </View>
          {state.kind === 'loading' ? (
            <View style={styles.center}><ActivityIndicator color={colors.textMuted} /></View>
          ) : state.kind === 'error' ? (
            <Text style={styles.error} testID="attachment-text-preview-error">{t('chat.file.previewFailed', { error: state.message })}</Text>
          ) : (
            <ScrollView style={styles.body} contentContainerStyle={{ padding: 16 }}>
              {markdown && !raw
                ? <MarkdownMessage>{state.text}</MarkdownMessage>
                : <Text selectable style={styles.mono}>{state.text}</Text>}
              {state.truncated ? <Text style={styles.note}>{t('chat.file.previewTruncated')}</Text> : null}
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = () => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#00000066', alignItems: 'center', justifyContent: 'center', padding: 16 },
  sheet: { width: '100%', maxWidth: 820, height: '86%', borderRadius: radius.surface, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  title: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text },
  toggle: { fontSize: 12, color: colors.accent },
  body: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  mono: { fontFamily: 'monospace', fontSize: 12, lineHeight: 18, color: colors.text },
  note: { marginTop: 12, fontSize: 11, color: colors.textMuted },
  error: { padding: 16, color: colors.failed, fontSize: 13 },
});
let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
