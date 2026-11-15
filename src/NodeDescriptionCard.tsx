// 节点页「职责介绍」卡(admin 2026-11-15「每个节点的职责需要让其他节点也能看到;desc 里放介绍而不是 AGENTS.md」)。
// 读:整段原样(保留换行)。写:有权限时「编辑」→ 多行输入 + 字数 + 保存;空着时可一键填模板(负责 / 能干什么 / 什么事找我 / 不做)。
// 存:PUT /api/nodes/:id/attrs { base_attrs_revision, description }(api.ts putNodeAttrs);409 → 读回最新再让人保存。
// 只在 Hub 支持时出现(node 上有 description 这个键);旧 Hub 不画。
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';
import { colors, radius, spacing, type as typeScale, weight } from './theme';
import { t } from './i18n';
import { useTranslation } from './i18n-react';
import './i18n-node-desc';
import { putNodeAttrs, type HubConfig, type HubNode } from './api';
import { DESCRIPTION_MAX, DESCRIPTION_TEMPLATE, descriptionDraftError, descriptionLength, normalizeDraft, saveErrorKey } from './node-description';

export default function NodeDescriptionCard(p: { cfg: HubConfig; node: HubNode; canEdit: boolean; onSaved: (description: string | null, attrsRevision: number) => void; onConflict?: () => void }) {
  useTranslation();
  const current = p.node.description ?? null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(current ?? '');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ key: string; ok: boolean } | null>(null);
  useEffect(() => { if (!editing) setDraft(current ?? ''); }, [current, editing]);
  useEffect(() => {
    if (!note?.ok) return;
    const id = setTimeout(() => setNote(null), 3000);
    return () => clearTimeout(id);
  }, [note]);
  const tooLong = descriptionDraftError(draft) === 'tooLong';
  const save = async () => {
    if (busy || tooLong) return;
    setBusy(true); setNote(null);
    const r = await putNodeAttrs(p.cfg, p.node.node_id || p.node.alias, { base_attrs_revision: p.node.attrs_revision ?? 0, description: normalizeDraft(draft) });
    setBusy(false);
    if (r.ok) { p.onSaved(r.description, r.attrs_revision); setEditing(false); setNote({ key: 'nodeDesc.saved', ok: true }); return; }
    if (r.error === 'attrs_revision_conflict') p.onConflict?.();
    setNote({ key: saveErrorKey(r.error, r.status), ok: false });
  };
  const cardStyle = { backgroundColor: colors.card, borderRadius: radius.surface, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.sm } as const;
  return (
    <View testID="node-description">
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, marginBottom: 4 }}>
        <Text style={{ color: colors.text, fontSize: typeScale.title, fontWeight: weight.strong }}>{t('nodeDesc.title')}</Text>
        {p.canEdit && !editing ? (
          <Pressable testID="node-description-edit" accessibilityRole="button" onPress={() => { setDraft(current ?? ''); setEditing(true); setNote(null); }} hitSlop={8}
            style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => ({ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm, height: 30, borderRadius: radius.item, backgroundColor: hovered || pressed ? colors.rowHover : 'transparent' })}>
            <Ionicons name="create-outline" size={15} color={colors.accent} />
            <Text style={{ color: colors.accent, fontSize: typeScale.small, fontWeight: weight.strong }}>{t(current ? 'nodeDesc.edit' : 'nodeDesc.write')}</Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={{ color: colors.textMuted, fontSize: typeScale.small, lineHeight: 18, marginBottom: spacing.md }}>{t('nodeDesc.hint')}</Text>
      {editing ? (
        <View style={cardStyle}>
          <TextInput testID="node-description-input" multiline autoFocus value={draft} onChangeText={setDraft} editable={!busy}
            placeholder={t('nodeDesc.placeholder')} placeholderTextColor={colors.textMuted} accessibilityLabel={t('nodeDesc.title')}
            style={{ minHeight: 140, color: colors.text, fontSize: typeScale.body, lineHeight: 22, textAlignVertical: 'top', padding: spacing.sm, borderRadius: radius.control, borderWidth: 1, borderColor: tooLong ? colors.failed : colors.border, backgroundColor: colors.inputBg }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm }}>
            {!draft.trim() ? (
              <Pressable testID="node-description-template" accessibilityRole="button" onPress={() => setDraft(DESCRIPTION_TEMPLATE)} style={{ paddingHorizontal: spacing.sm, height: 32, justifyContent: 'center', borderRadius: radius.item, borderWidth: 1, borderColor: colors.border }}>
                <Text style={{ color: colors.textSecondary, fontSize: typeScale.small }}>{t('nodeDesc.template')}</Text>
              </Pressable>
            ) : null}
            <Text testID="node-description-count" style={{ color: tooLong ? colors.failed : colors.textMuted, fontSize: typeScale.small, fontVariant: ['tabular-nums'] }}>{t('nodeDesc.count', { count: descriptionLength(draft), max: DESCRIPTION_MAX })}</Text>
            <View style={{ flex: 1 }} />
            <Pressable testID="node-description-cancel" accessibilityRole="button" disabled={busy} onPress={() => { setEditing(false); setNote(null); }} style={{ paddingHorizontal: spacing.md, height: 34, justifyContent: 'center', borderRadius: radius.control }}>
              <Text style={{ color: colors.textSecondary, fontSize: typeScale.body }}>{t('nodeDesc.cancel')}</Text>
            </Pressable>
            <Pressable testID="node-description-save" accessibilityRole="button" disabled={busy || tooLong} onPress={() => void save()}
              style={{ paddingHorizontal: spacing.lg, height: 34, justifyContent: 'center', borderRadius: radius.control, backgroundColor: colors.accent, opacity: busy || tooLong ? 0.5 : 1 }}>
              <Text style={{ color: colors.onAccent, fontSize: typeScale.body, fontWeight: weight.strong }}>{t(busy ? 'nodeDesc.saving' : 'nodeDesc.save')}</Text>
            </Pressable>
          </View>
          {tooLong ? <Text style={{ color: colors.failed, fontSize: typeScale.small }}>{t('nodeDesc.tooLong', { max: DESCRIPTION_MAX })}</Text> : null}
        </View>
      ) : (
        <View style={cardStyle}>
          {current
            ? <Text testID="node-description-text" selectable style={{ color: colors.text, fontSize: typeScale.body, lineHeight: 22 }}>{current}</Text>
            : <Text testID="node-description-empty" style={{ color: colors.textMuted, fontSize: typeScale.body, lineHeight: 22 }}>{t('nodeDesc.empty')}</Text>}
        </View>
      )}
      {note ? <Text testID="node-description-note" accessibilityLiveRegion="polite" style={{ marginTop: spacing.sm, color: note.ok ? colors.running : colors.failed, fontSize: typeScale.small }}>{t(note.key, { max: DESCRIPTION_MAX })}</Text> : null}
    </View>
  );
}
