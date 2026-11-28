import { useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import { Text } from './ui-text';
import { Ionicons } from './icons';
import { colors, onThemeChange, radius, themeMode, weight } from './theme';
import { filePresentation, formatFileSize } from './attachment-file-model';
import { clampAudioProgress, formatAudioTime, formatPlaybackRate } from './attachment-audio-model';
import { useTranslation } from './i18n-react';
import './i18n-chat';

export interface AttachmentAudioAction {
  key: string;
  label: string;
  accessibilityLabel?: string;
  onPress: (event: GestureResponderEvent) => void;
  disabled?: boolean;
  testID?: string;
}

export interface AttachmentAudioCardProps {
  name: string;
  mime?: string;
  size?: number;
  playing: boolean;
  loading: boolean;
  loaded: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
  progressText?: string;
  error?: string | null;
  detail?: string;
  onTogglePlay: () => void;
  onSeek: (ratio: number) => void;
  onCycleRate: () => void;
  actions?: AttachmentAudioAction[];
  testID?: string;
}

export default function AttachmentAudioCard({
  name,
  mime,
  size,
  playing,
  loading,
  loaded,
  currentTime,
  duration,
  playbackRate,
  progressText,
  error,
  detail,
  onTogglePlay,
  onSeek,
  onCycleRate,
  actions,
  testID = 'attachment-audio-card',
}: AttachmentAudioCardProps) {
  const { t } = useTranslation();
  const file = filePresentation(name, mime);
  const isDark = themeMode() === 'dark';
  const ink = isDark ? file.darkColor : file.color;
  const playBtnBg = file.color;
  const softBg = `${ink}${isDark ? '24' : '14'}`;
  const softBorder = `${ink}${isDark ? '44' : '2c'}`;
  const trackBg = `${ink}${isDark ? '28' : '1a'}`;
  const sizeText = formatFileSize(size);
  const ratio = clampAudioProgress(currentTime, duration);
  const trackWidthRef = useRef(0);
  const [trackWidth, setTrackWidth] = useState(0);

  const onTrackLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    trackWidthRef.current = w;
    setTrackWidth(w);
  };

  const handleTrackPress = (e: GestureResponderEvent) => {
    if (!loaded || duration <= 0) return;
    const width = trackWidthRef.current;
    if (width <= 0) return;
    const ne = e.nativeEvent as { locationX?: number; offsetX?: number };
    const x = typeof ne.locationX === 'number' ? ne.locationX : typeof ne.offsetX === 'number' ? ne.offsetX : 0;
    onSeek(Math.max(0, Math.min(1, x / width)));
  };

  const statusLine = error
    ? error
    : loading
      ? (progressText ? `${t('chat.audio.loading')} · ${progressText}` : t('chat.audio.loading'))
      : loaded && duration > 0
        ? undefined
        : t('chat.audio.tapToPlay');

  const timeText = loaded && duration > 0
    ? `${formatAudioTime(currentTime)} / ${formatAudioTime(duration)}`
    : formatAudioTime(currentTime);

  const rateLabel = formatPlaybackRate(playbackRate);
  const showFooter = !!detail || !!(actions && actions.length > 0);

  return (
    <View testID={testID} style={styles.card}>
      <View style={styles.body}>
        <Pressable
          testID="attachment-audio-play"
          accessibilityRole="button"
          accessibilityLabel={playing ? `${t('chat.audio.pause')} ${name}` : `${t('chat.audio.play')} ${name}`}
          accessibilityState={{ busy: loading }}
          onPress={onTogglePlay}
          disabled={loading}
          style={({ pressed }) => [
            styles.playBtn,
            { backgroundColor: playBtnBg },
            pressed && !loading && styles.pressed,
          ]}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#ffffff" testID="attachment-audio-loading" />
          ) : (
            <Ionicons
              name={playing ? 'pause' : 'play'}
              size={20}
              color="#ffffff"
              style={playing ? undefined : styles.playIconOffset}
            />
          )}
        </Pressable>

        <Pressable
          onPress={onTogglePlay}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel={playing ? `${t('chat.audio.pause')} ${name}` : `${t('chat.audio.play')} ${name}`}
          style={({ pressed }) => [styles.info, pressed && !loading && styles.pressed]}
        >
          <View style={styles.title} testID="attachment-audio-name">
            <Text style={[styles.name, styles.stem]} numberOfLines={2} ellipsizeMode="tail">
              {file.extension ? name.slice(0, -file.extension.length) : name}
            </Text>
            {file.extension ? (
              <Text style={[styles.name, styles.extension]} numberOfLines={1} ellipsizeMode="middle" testID="attachment-audio-extension">
                {file.extension}
              </Text>
            ) : null}
          </View>

          <View style={styles.meta}>
            <View style={[styles.badge, { backgroundColor: softBg, borderColor: softBorder }]}>
              <Ionicons name="musical-notes" size={10} color={ink} />
              <Text style={[styles.badgeText, { color: ink }]} testID="attachment-audio-badge">{file.badge}</Text>
            </View>
            {sizeText ? <Text style={styles.secondary}>{sizeText}</Text> : null}
            {statusLine ? (
              <Text
                style={[styles.secondary, error ? styles.error : undefined]}
                numberOfLines={2}
                testID={error ? 'attachment-audio-error' : 'attachment-audio-status'}
              >
                {statusLine}
              </Text>
            ) : null}
          </View>
        </Pressable>
      </View>

      <View style={styles.controls}>
        <Pressable
          testID="attachment-audio-seek"
          accessibilityRole="adjustable"
          accessibilityLabel={t('chat.audio.seek')}
          disabled={!loaded || duration <= 0}
          onLayout={onTrackLayout}
          onPress={handleTrackPress}
          style={styles.trackHit}
        >
          <View style={[styles.track, { backgroundColor: trackBg }]}>
            <View style={[styles.trackFill, { backgroundColor: ink, width: `${Math.round(ratio * 1000) / 10}%` }]} />
          </View>
          {loaded && duration > 0 && trackWidth > 0 ? (
            <View
              pointerEvents="none"
              style={[
                styles.thumb,
                {
                  backgroundColor: ink,
                  borderColor: colors.card,
                  left: Math.max(0, Math.min(trackWidth - 12, ratio * trackWidth - 6)),
                },
              ]}
            />
          ) : null}
        </Pressable>

        <View style={styles.timeRow}>
          <Text style={styles.timeText} testID="attachment-audio-time">{timeText}</Text>
          <Pressable
            testID="attachment-audio-rate"
            accessibilityRole="button"
            accessibilityLabel={t('chat.audio.speed', { rate: rateLabel })}
            onPress={onCycleRate}
            hitSlop={6}
            style={({ pressed }) => [
              styles.ratePill,
              { backgroundColor: softBg, borderColor: softBorder },
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.rateText, { color: ink }]}>{rateLabel}</Text>
          </Pressable>
        </View>
      </View>

      {showFooter ? (
        <View style={styles.footer}>
          {detail ? <Text style={styles.footerDetail} numberOfLines={1}>{detail}</Text> : null}
          {actions && actions.length > 0 ? (
            <View style={styles.actions}>
              {actions.map(action => (
                <Pressable
                  key={action.key}
                  testID={action.testID}
                  accessibilityRole="button"
                  accessibilityLabel={action.accessibilityLabel ?? action.label}
                  disabled={action.disabled}
                  onPress={action.onPress}
                  hitSlop={6}
                  style={({ pressed }) => [pressed && !action.disabled && styles.pressed]}
                >
                  <Text style={[styles.actionText, action.disabled && styles.actionDisabled]}>{action.label}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  card: {
    width: 300,
    maxWidth: '100%',
    alignSelf: 'flex-start',
    marginTop: 6,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    overflow: 'hidden',
  },
  pressed: { opacity: 0.78 },
  body: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 6,
    gap: 12,
  },
  playBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  playIconOffset: { marginLeft: 2 },
  info: { flex: 1, minWidth: 0 },
  title: { flexDirection: 'row', alignItems: 'flex-end' },
  name: { fontSize: 14, lineHeight: 20, fontWeight: '500', color: colors.text },
  stem: { flexShrink: 1, minWidth: 0 },
  extension: { flexShrink: 0, maxWidth: '45%' },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 4 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.inline,
    borderWidth: 1,
  },
  badgeText: { fontSize: 9, lineHeight: 12, fontWeight: weight.strong, letterSpacing: 0.4 },
  secondary: { fontSize: 11, lineHeight: 15, color: colors.textMuted, flexShrink: 1 },
  error: { color: colors.failed },
  controls: { paddingHorizontal: 14, paddingBottom: 10, paddingTop: 2 },
  trackHit: {
    height: 22,
    justifyContent: 'center',
    ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as object) : {}),
  },
  track: {
    height: 5,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  trackFill: {
    height: '100%',
    borderRadius: radius.pill,
  },
  thumb: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    top: 5,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  timeText: {
    fontSize: 11,
    lineHeight: 15,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
  },
  ratePill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.inline,
    borderWidth: 1,
  },
  rateText: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: weight.strong,
    fontVariant: ['tabular-nums'],
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    flexWrap: 'wrap',
  },
  footerDetail: {
    fontSize: 11,
    lineHeight: 15,
    color: colors.textMuted,
    flexShrink: 1,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginLeft: 'auto',
  },
  actionText: {
    fontSize: 12,
    lineHeight: 16,
    color: colors.accent,
    fontWeight: '500',
  },
  actionDisabled: { opacity: 0.45 },
});

let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
