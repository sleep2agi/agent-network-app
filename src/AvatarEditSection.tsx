import { useState } from 'react';
import { Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import AliasAvatar from './AliasAvatar';
import { fetchHubNodes, HubConfig, putNodeAvatar } from './api';
import { POOL_FILENAMES, POOL_RELATIVE_PATHS, validateCustomAvatarUrl } from './lib/avatar-resolve';
import { hydrateHubAvatars, isNodeBacked, setLocalAvatarEcho, sourceForFile, useAvatarsVersion } from './lib/avatars';
import { colors, spacing } from './theme';

// R2 (通信龙 08-01, B 轮): per-agent avatar editor on NodeDetailScreen. Two ways
// to set — a pool picker (tap a face → '/avatars/avatar-NN.webp', app-native) and
// a custom URL field (absolute http(s), mirrors web) — both land in the hub's
// valid value set (#550). NO photo upload: the hub stores a URL string, not image
// bytes, and a phone ImagePicker gives a file:// that other devices can't open.
//
// 🔴 Disclosure BEFORE the click (通信龙 判据): session-only aliases (no hub nodes
// row) can't set a hub avatar (PUT 404s), so the controls are disabled and the
// reason is shown up-front — not surfaced only after a failed save.
export default function AvatarEditSection({ cfg, alias }: { cfg: HubConfig; alias: string }) {
  useAvatarsVersion(); // re-eval editable + preview when /api/nodes hydration lands
  const editable = isNodeBacked(alias);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // value: absolute URL | '/avatars/avatar-NN.webp' (pool) | null (clear).
  const apply = async (value: string | null) => {
    if (!editable || busy) return;
    setBusy(true);
    setMsg(null);
    const r = await putNodeAvatar(cfg, alias, value);
    if (!r.ok) {
      setBusy(false);
      setMsg({ ok: false, text: r.reason || r.error || '保存失败' });
      return;
    }
    setLocalAvatarEcho(alias, value); // immediate local echo → preview updates now
    fetchHubNodes(cfg).then((x) => hydrateHubAvatars(x.nodes)).catch(() => {}); // re-pull hub truth
    setBusy(false);
    setMsg({ ok: true, text: '已保存，跨设备同步' });
  };

  const onSaveUrl = () => {
    const v = validateCustomAvatarUrl(url);
    if (!v.ok) {
      setMsg({ ok: false, text: v.reason });
      return;
    }
    void apply(v.url);
  };

  const dim = editable ? 1 : 0.4;
  const canSaveUrl = editable && !busy && !!url.trim();

  return (
    <View style={{ paddingVertical: spacing.md }}>
      <Text style={{ color: colors.textMuted, fontSize: 12, marginBottom: spacing.sm }}>头像</Text>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm }}>
        <AliasAvatar alias={alias} size={56} />
        <View style={{ flex: 1 }}>
          {!editable ? (
            <Text testID="avatar-no-node-note" style={{ color: colors.textMuted, fontSize: 12, lineHeight: 17 }}>
              该 agent 未注册为节点（hub 无 nodes 记录），头像暂不支持自定义 —— 当前是系统默认插画。
            </Text>
          ) : (
            <Text style={{ color: colors.textMuted, fontSize: 12, lineHeight: 17 }}>
              点一个默认图案，或填自定义图片 URL。保存后经 hub 跨设备同步。
            </Text>
          )}
        </View>
      </View>

      {/* pool picker — tap a face → set that pool image (relative path) */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ opacity: dim }}
        contentContainerStyle={{ gap: spacing.sm, paddingVertical: spacing.xs }}
      >
        {POOL_FILENAMES.map((file, i) => (
          <Pressable
            key={file}
            testID={`avatar-pool-${i}`}
            disabled={!editable || busy}
            onPress={() => void apply(POOL_RELATIVE_PATHS[i])}
          >
            <Image
              source={sourceForFile(file)!}
              style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.border }}
            />
          </Pressable>
        ))}
      </ScrollView>

      {/* custom URL + save */}
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
        <TextInput
          testID="avatar-url-input"
          editable={editable && !busy}
          value={url}
          onChangeText={setUrl}
          placeholder="图片 URL（https://…，留空用图案）"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          style={{
            flex: 1,
            color: colors.text,
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderWidth: 1,
            borderRadius: 8,
            paddingHorizontal: spacing.sm,
            paddingVertical: spacing.xs,
            fontSize: 13,
            opacity: dim,
          }}
        />
        <Pressable
          testID="avatar-save"
          disabled={!canSaveUrl}
          onPress={onSaveUrl}
          style={{
            paddingHorizontal: spacing.md,
            justifyContent: 'center',
            borderRadius: 8,
            backgroundColor: colors.accent,
            opacity: canSaveUrl ? 1 : 0.4,
          }}
        >
          <Text style={{ color: colors.bg, fontSize: 13, fontWeight: '600' }}>{busy ? '…' : '保存'}</Text>
        </Pressable>
      </View>

      {editable ? (
        <Pressable
          testID="avatar-clear"
          disabled={busy}
          onPress={() => {
            setUrl('');
            void apply(null);
          }}
          style={{ marginTop: spacing.sm }}
        >
          <Text style={{ color: colors.accent, fontSize: 12 }}>恢复默认</Text>
        </Pressable>
      ) : null}

      {msg ? (
        <Text
          testID={msg.ok ? 'avatar-save-ok' : 'avatar-save-error'}
          style={{ marginTop: spacing.sm, fontSize: 12, color: msg.ok ? '#34d399' : '#f87171' }}
        >
          {msg.text}
        </Text>
      ) : null}
    </View>
  );
}
