import { useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import type { HubConfig } from './api';
import { fetchAuthMe, forgetAuthMeFor, HubRequestError, putUserAvatar } from './user-admin-api';
import { POOL_FILENAMES, poolFileNameForAlias, validateCustomAvatarUrl } from './lib/avatar-resolve';
import { sourceForFile } from './lib/avatars';
import { SettingsButton, SettingsCardContent, SettingsGroup } from './settings-kit';
import { colors, avatarRadius, onThemeChange, radius } from './theme';
import { useTranslation } from './i18n-react';
import { t } from './i18n';
import './i18n-user-avatar';

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
    busyRef.current = true; setBusy(true); setMessage('');
    try {
      const avatar = await putUserAvatar(cfg, user.id, value);
      if (live.current) { setUser({ ...user, avatar }); setMessage('userAvatar.saved'); }
    } catch (e) {
      if (live.current) setMessage(e instanceof HubRequestError && [404, 405].includes(e.status) ? 'userAvatar.unsupported' : 'userAvatar.failed');
    } finally { busyRef.current = false; if (live.current) setBusy(false); }
  };
  const avatar = user?.avatar;
  // Only bundled files or validated http(s). Never consult node alias maps.
  const source = avatar?.startsWith('/avatars/') ? sourceForFile(avatar.slice(9))
    : avatar && validateCustomAvatarUrl(avatar).ok ? { uri: avatar }
    : user ? sourceForFile(poolFileNameForAlias(user.id)) : null;
  // Selected pool face: the saved one, or the per-user default when nothing is saved.
  const chosenFile = avatar?.startsWith('/avatars/') ? avatar.slice(9) : !avatar && user ? poolFileNameForAlias(user.id) : null;
  // Unsupported is a Hub version fact, not an error: muted, like other hints.
  const tone = message === 'userAvatar.failed' || message === 'userAvatar.invalid' ? colors.failed
    : message === 'userAvatar.unsupported' ? colors.textSecondary : colors.running;
  return <SettingsGroup title={t('userAvatar.title')} testID="user-avatar-editor">
    <SettingsCardContent>
      {/* Header: what you look like now, and what this card changes. */}
      <View style={s.header}>
        {source && !imageError
          ? <Image testID="user-avatar-preview" source={source} onError={() => setImageError(true)} style={s.preview} />
          : <View style={[s.preview, s.previewFallback]}><Text style={s.previewInitial} testID="user-avatar-fallback">{(cfg.username || '·').slice(0, 1).toUpperCase()}</Text></View>}
        <View style={s.headerCopy}>
          <Text style={s.name} numberOfLines={1}>{cfg.username || '—'}</Text>
          <Text testID="user-avatar-hint" style={s.hint}>{t('userAvatar.hint')}</Text>
          {loading ? <Text style={s.meta}>{t('userAvatar.loading')}</Text> : null}
          {busy ? <Text style={s.meta}>{t('userAvatar.busy')}</Text> : null}
        </View>
      </View>
      {user ? <>
        <View style={s.grid}>
          {POOL_FILENAMES.map((file, i) => {
            const on = file === chosenFile;
            return <Pressable key={file} accessibilityRole="button" accessibilityLabel={t('userAvatar.pick', { n: i + 1 })} accessibilityState={{ selected: on, disabled: busy || loading }} testID={`user-avatar-pick-${i + 1}`} disabled={busy || loading} onPress={() => void apply(`/avatars/${file}`)} style={({ hovered }: any) => [s.face, on && s.faceOn, !on && hovered && s.faceHover, busy && s.dim]}>
              <Image source={sourceForFile(file)!} style={s.faceImage} />
            </Pressable>;
          })}
        </View>
        <View style={s.divider} />
        <Text style={s.sectionLabel}>{t('userAvatar.url')}</Text>
        <View style={s.urlRow}>
          <TextInput testID="user-avatar-url" accessibilityLabel={t('userAvatar.url')} placeholder="https://" placeholderTextColor={colors.textMuted} value={url} onChangeText={setUrl} editable={!busy && !loading} autoCapitalize="none" style={s.input} />
          <SettingsButton inline testID="user-avatar-save" label={t('userAvatar.save')} variant={busy || loading || !url.trim() ? 'plain' : 'primary'} disabled={busy || loading || !url.trim()} onPress={() => {
            const v = validateCustomAvatarUrl(url);
            if (!v.ok) setMessage('userAvatar.invalid'); else void apply(v.url);
          }} />
        </View>
        <Text style={[s.meta, s.remote]}>{t('userAvatar.remote')}</Text>
        <View style={s.footer}>
          <SettingsButton inline testID="user-avatar-reset" variant="plain" label={t('userAvatar.reset')} disabled={busy || loading} onPress={() => void apply(null)} />
        </View>
      </> : !loading ? <View style={s.footer}><SettingsButton inline variant="plain" label={t('userAvatar.retry')} testID="user-avatar-retry" onPress={() => void load()} /></View> : null}
      {message ? <Text style={[s.message, { color: tone }]} testID="user-avatar-message" accessibilityLiveRegion="polite">{t(message)}</Text> : null}
    </SettingsCardContent>
  </SettingsGroup>;
}

const PREVIEW = 64;
const FACE = 40;
const makeStyles = () => StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  headerCopy: { flex: 1, minWidth: 0, gap: 4 },
  preview: { width: PREVIEW, height: PREVIEW, borderRadius: avatarRadius(PREVIEW) },
  previewFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.railActiveBg },
  previewInitial: { color: colors.accent, fontSize: 24, fontWeight: '600' },
  name: { color: colors.text, fontSize: 16, fontWeight: '600' },
  hint: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
  meta: { color: colors.textMuted, fontSize: 12, lineHeight: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  face: { padding: 2, borderRadius: radius.pill, borderWidth: 2, borderColor: 'transparent' },
  faceOn: { borderColor: colors.accent },
  faceHover: { borderColor: colors.border },
  faceImage: { width: FACE, height: FACE, borderRadius: avatarRadius(FACE) },
  dim: { opacity: 0.5 },
  remote: { marginTop: 4 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: 16 },
  sectionLabel: { color: colors.textSecondary, fontSize: 13, fontWeight: '500', marginBottom: 8 },
  urlRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 6 },
  input: { flexGrow: 1, flexBasis: 220, minHeight: 40, color: colors.text, backgroundColor: colors.inputBg, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, fontSize: 14 },
  footer: { flexDirection: 'row', justifyContent: 'flex-start', marginTop: 16 },
  message: { marginTop: 12, fontSize: 13, lineHeight: 18 },
});
// Colors live in the stylesheet: rebuild on theme switch like settings-kit does.
let s = makeStyles();
onThemeChange(() => { s = makeStyles(); });
