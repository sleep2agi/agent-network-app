import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';
import type { HubConfig } from './api';
import { fetchAuthMe, forgetAuthMeFor, HubRequestError, putUserAvatar } from './user-admin-api';
import { POOL_FILENAMES, poolFileNameForAlias, validateCustomAvatarUrl } from './lib/avatar-resolve';
import { sourceForFile } from './lib/avatars';
import { SettingsButton, SettingsCardContent, SettingsGroup } from './settings-kit';
import { colors, onThemeChange, avatarRadius, radius, spacing } from './theme';
import { useTranslation } from './i18n-react';
import { t } from './i18n';
import './i18n-user-avatar';
import { pickUserAvatar, prepareUserAvatar, uploadLocalUserAvatar } from './user-avatar-local';
import { uploadUserAvatarWith, UserAvatarFileError, UserAvatarUnsupportedError, userAvatarPath } from './user-avatar-upload';
import UserAvatarImage from './UserAvatarImage';

// Remount on account/Hub/token change. An old request can finish for its original
// account, but its disposed editor must never update the new account's UI.
export default function UserAvatarEditor({ cfg }: { cfg: HubConfig }) {
  return <Editor key={JSON.stringify([cfg.serverUrl, cfg.profileId, cfg.token])} cfg={cfg} />;
}

function Editor({ cfg }: { cfg: HubConfig }) {
  useTranslation();
  const live = useRef(true);
  const busyRef = useRef(false);
  const [user, setUser] = useState<{ id: string; avatar: string | null } | null>(null);
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('userAvatar.busy');
  const [message, setMessage] = useState('');
  const [imageError, setImageError] = useState(false);
  const load = async () => {
    setLoading(true); setMessage('');
    try {
      forgetAuthMeFor(cfg);
      const me = await fetchAuthMe(cfg);
      if (!live.current) return;
      if (!me.user?.user_id || !Object.hasOwn(me.user, 'avatar_url')) {
        setMessage('userAvatar.unsupported'); return;
      }
      setUser({ id: me.user.user_id, avatar: me.user.avatar_url ?? null });
    } catch { if (live.current) setMessage('userAvatar.failed'); }
    finally { if (live.current) setLoading(false); }
  };
  useEffect(() => { live.current = true; void load(); return () => { live.current = false; }; }, []);
  useEffect(() => { setImageError(false); }, [user?.avatar]);
  const apply = async (value: string | null) => {
    if (!user || busyRef.current) return;
    busyRef.current = true; setBusy(true); setStage('userAvatar.busy'); setMessage('');
    try {
      const avatar = await putUserAvatar(cfg, user.id, value);
      if (live.current) { setUser({ ...user, avatar }); setMessage('userAvatar.saved'); }
    } catch (e) {
      if (live.current) setMessage(e instanceof HubRequestError && [404, 405].includes(e.status) ? 'userAvatar.unsupported' : 'userAvatar.failed');
    } finally { busyRef.current = false; if (live.current) setBusy(false); }
  };
  const upload = async () => {
    if (!user || busyRef.current) return;
    busyRef.current = true; setBusy(true); setStage('userAvatar.selecting'); setMessage('');
    try {
      const avatar = await uploadUserAvatarWith(cfg, user.id, {
        pick: pickUserAvatar, prepare: prepareUserAvatar,
        upload: uploadLocalUserAvatar, active: () => live.current,
        stage: value => { if (live.current) setStage(`userAvatar.${value}`); },
      });
      if (live.current && avatar !== undefined) { setUser({ ...user, avatar }); setMessage('userAvatar.saved'); }
    } catch (e) {
      if (live.current) setMessage(e instanceof UserAvatarFileError ? `userAvatar.file.${e.key}`
        : e instanceof UserAvatarUnsupportedError ? 'userAvatar.uploadUnsupported' : 'userAvatar.failed');
    } finally { busyRef.current = false; if (live.current) setBusy(false); }
  };
  const avatar = user?.avatar;
  // Bundled files, dedicated protected avatar paths, or validated public URLs; never node alias maps.
  const source = avatar?.startsWith('/avatars/') ? sourceForFile(avatar.slice(9))
    : avatar && (userAvatarPath(avatar) || validateCustomAvatarUrl(avatar).ok) ? { uri: avatar }
    : user ? sourceForFile(poolFileNameForAlias(user.id)) : null;
  const activePoolFile = avatar?.startsWith('/avatars/')
    ? avatar.slice(9)
    : !avatar && user ? poolFileNameForAlias(user.id) : null;
  const disabled = busy || loading;
  const canSaveUrl = !disabled && !!url.trim();
  const isErrorMsg = message !== '' && message !== 'userAvatar.saved';

  return <SettingsGroup title={t('userAvatar.title')} testID="user-avatar-editor">
    <SettingsCardContent>
      <View style={styles.heroRow}>
        <View style={styles.previewFrame}>
          <Text style={styles.fallbackText} numberOfLines={1} testID="user-avatar-fallback">{cfg.username || '·'}</Text>
          {source && !imageError ? avatar && !avatar.startsWith('/avatars/')
            ? <UserAvatarImage key={avatar} value={avatar} hubUrl={cfg.serverUrl} token={cfg.token} testID="user-avatar-preview" onError={() => setImageError(true)} style={styles.previewImg} />
            : <Image testID="user-avatar-preview" source={source} onError={() => setImageError(true)} style={styles.previewImg} /> : null}
        </View>
        <View style={styles.heroCopy}>
          <Text testID="user-avatar-hint" style={styles.heroHint}>{t('userAvatar.hint')}</Text>
          {user ? <Text testID="user-avatar-upload-hint" style={styles.uploadHint}>{t('userAvatar.uploadHint')}</Text> : null}
        </View>
      </View>
      {user ? <View style={styles.actionRow}>
        <Pressable
          testID="user-avatar-upload"
          accessibilityRole="button"
          accessibilityLabel={t('userAvatar.upload')}
          disabled={disabled}
          onPress={() => void upload()}
          style={({ pressed, hovered }: any) => [
            styles.uploadBtn,
            disabled && styles.dim,
            (pressed || hovered) && !disabled && { opacity: 0.86 },
          ]}
        >
          <Ionicons name="cloud-upload-outline" size={15} color={colors.onAccent} />
          <Text style={styles.uploadBtnText}>{t('userAvatar.upload')}</Text>
        </Pressable>
        <Pressable
          testID="user-avatar-reset"
          accessibilityRole="button"
          accessibilityLabel={t('userAvatar.reset')}
          disabled={disabled}
          onPress={() => void apply(null)}
          style={({ pressed, hovered }: any) => [
            styles.resetBtn,
            disabled && styles.dim,
            (pressed || hovered) && !disabled && styles.neutralHover,
          ]}
        >
          <Ionicons name="refresh-outline" size={14} color={colors.textSecondary} />
          <Text style={styles.resetBtnText}>{t('userAvatar.reset')}</Text>
        </Pressable>
      </View> : null}

      {loading ? <View style={styles.statusRow}>
        <ActivityIndicator size="small" color={colors.textMuted} />
        <Text style={styles.statusMuted}>{t('userAvatar.loading')}</Text>
      </View> : null}

      {user ? <>
        <View style={styles.divider} />
        <Text style={styles.sectionLabel}>{t('userAvatar.presets')}</Text>
        <View style={styles.presetGrid}>
          {POOL_FILENAMES.map((file, i) => {
            const selected = activePoolFile === file;
            return <Pressable
              key={file}
              accessibilityRole="button"
              accessibilityLabel={t('userAvatar.pick', { n: i + 1 })}
              accessibilityState={{ selected, disabled }}
              testID={`user-avatar-pick-${i + 1}`}
              disabled={disabled}
              onPress={() => void apply(`/avatars/${file}`)}
              style={({ pressed, hovered }: any) => [
                styles.presetTile,
                selected && styles.presetTileSelected,
                disabled && styles.dim,
                (pressed || hovered) && !disabled && !selected && styles.presetTileHover,
              ]}
            >
              <Image source={sourceForFile(file)!} style={styles.presetImg} />
            </Pressable>;
          })}
        </View>

        <View style={styles.divider} />
        <View style={styles.urlRow}>
          <TextInput
            testID="user-avatar-url"
            accessibilityLabel={t('userAvatar.url')}
            placeholder={t('userAvatar.url')}
            placeholderTextColor={colors.textMuted}
            value={url}
            onChangeText={setUrl}
            editable={!disabled}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.urlInput}
          />
          <Pressable
            testID="user-avatar-save"
            accessibilityRole="button"
            accessibilityLabel={t('userAvatar.save')}
            accessibilityState={{ disabled: !canSaveUrl }}
            disabled={!canSaveUrl}
            onPress={() => {
              const v = validateCustomAvatarUrl(url);
              if (!v.ok) setMessage('userAvatar.invalid'); else void apply(v.url);
            }}
            style={({ pressed, hovered }: any) => [
              styles.saveBtn,
              canSaveUrl ? styles.saveBtnActive : styles.saveBtnIdle,
              (pressed || hovered) && canSaveUrl && { opacity: 0.86 },
            ]}
          >
            <Text style={[styles.saveBtnText, canSaveUrl ? styles.saveBtnTextActive : styles.saveBtnTextIdle]}>
              {t('userAvatar.save')}
            </Text>
          </Pressable>
        </View>
        <Text style={styles.remoteNote}>{t('userAvatar.remote')}</Text>
      </> : !loading ? <SettingsButton label={t('userAvatar.retry')} testID="user-avatar-retry" onPress={() => void load()} /> : null}

      {busy ? <View style={styles.statusRow}>
        <ActivityIndicator size="small" color={colors.accent} />
        <Text testID="user-avatar-progress" accessibilityLiveRegion="polite" style={styles.statusMuted}>{t(stage)}</Text>
      </View> : null}
      {message ? <View style={[styles.messageBanner, isErrorMsg ? styles.messageBannerError : styles.messageBannerOk]}>
        <Text style={[styles.messageText, isErrorMsg && styles.messageTextError]} testID="user-avatar-message" accessibilityLiveRegion="polite">
          {t(message)}
        </Text>
      </View> : null}
    </SettingsCardContent>
  </SettingsGroup>;
}

const makeStyles = () => StyleSheet.create({
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md + 2,
  },
  previewFrame: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    backgroundColor: colors.subtleFill,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    flexShrink: 0,
  },
  fallbackText: {
    color: colors.textSecondary,
    fontSize: 18,
    fontWeight: '600',
    paddingHorizontal: spacing.xs,
  },
  previewImg: {
    position: 'absolute',
    width: 64,
    height: 64,
    borderRadius: avatarRadius(64),
  },
  heroCopy: {
    flex: 1,
    minWidth: 0,
  },
  heroHint: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
  uploadHint: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: spacing.xs,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: radius.control,
    backgroundColor: colors.accent,
  },
  uploadBtnText: {
    color: colors.onAccent,
    fontSize: 13,
    fontWeight: '600',
  },
  resetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: 12,
    borderRadius: radius.control,
    backgroundColor: colors.groupedRow,
    borderWidth: 1,
    borderColor: colors.border,
  },
  resetBtnText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '500',
  },
  neutralHover: {
    backgroundColor: colors.groupedRowPressed,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: spacing.lg,
  },
  sectionLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
    marginBottom: spacing.sm + 2,
  },
  presetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    maxWidth: 534,
  },
  presetTile: {
    width: 46,
    height: 46,
    borderRadius: radius.pill,
    backgroundColor: colors.subtleFill,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  presetTileSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.tonalBg,
  },
  presetTileHover: {
    borderColor: colors.border,
  },
  presetImg: {
    width: 40,
    height: 40,
    borderRadius: avatarRadius(40),
  },
  urlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  urlInput: {
    flex: 1,
    minWidth: 0,
    height: 38,
    color: colors.text,
    backgroundColor: colors.inputBg,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.control,
    fontSize: 13,
  },
  saveBtn: {
    height: 38,
    paddingHorizontal: 14,
    borderRadius: radius.control,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  saveBtnActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  saveBtnIdle: {
    backgroundColor: colors.groupedRow,
    borderColor: colors.border,
  },
  saveBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  saveBtnTextActive: {
    color: colors.onAccent,
  },
  saveBtnTextIdle: {
    color: colors.textMuted,
  },
  remoteNote: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: spacing.xs + 2,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  statusMuted: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  messageBanner: {
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.item,
  },
  messageBannerOk: {
    backgroundColor: colors.subtleFill,
  },
  messageBannerError: {
    backgroundColor: colors.subtleFill,
  },
  messageText: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 19,
  },
  messageTextError: {
    color: colors.failed,
  },
  dim: {
    opacity: 0.48,
  },
});

let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
