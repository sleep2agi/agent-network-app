// 节点页「权限 → 管理权限」卡(admin 11-11「节点的权限要好好设计,某些节点能管定时任务 / 管表,也可以只管某个部门」)。
// 只在 Hub /health 报 node_grants 时出现。能力 × 范围 × 级别,整份 PUT;Hub 决定谁能改(403 时说清楚为什么)。
// 样式约定同 NodePermissionSection:colors 用 live binding、不解构。
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Text } from './ui-text';
import { Ionicons } from './icons';
import { fetchNodeGrants, putNodeGrants, type HubConfig } from './api';
import { t } from './i18n';
import './i18n-node-grants';
import { useTranslation } from './i18n-react';
import type { DeptChoice, NodeChoice } from './node-allowlist-model';
import {
  GRANT_CAPABILITIES, addGrant, capabilityOffered, draftComplete, grantErrorText, grantLine, removeGrant, type GrantDraft,
} from './node-grants-model';
import { colors, radius, spacing, type as typeScale, weight } from './theme';

function Chip({ testID, text, on, disabled, note, onPress }: { testID: string; text: string; on: boolean; disabled?: boolean; note?: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ selected: on, disabled: !!disabled }} disabled={disabled} testID={testID} onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1,
        borderColor: on ? colors.accent : colors.border, backgroundColor: on ? colors.tonalBg : 'transparent', opacity: disabled ? 0.5 : 1 }}>
      <Text style={{ color: on ? colors.accent : colors.text, fontSize: typeScale.small, fontWeight: on ? weight.strong : weight.regular }}>{text}</Text>
      {note ? <Text style={{ color: colors.textMuted, fontSize: typeScale.caption }}>{note}</Text> : null}
    </Pressable>
  );
}

export default function NodeGrantsCard({ cfg, nodeId, depts, nodes, compact }: {
  cfg: HubConfig; nodeId: string; depts: readonly DeptChoice[]; nodes: readonly NodeChoice[]; compact?: boolean;
}) {
  useTranslation();
  const [grants, setGrants] = useState<GrantDraft[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [adding, setAdding] = useState(false);
  // 服务器声明的能力（GET /grants 的 capabilities）。undefined = 老 Hub 没这个字段 ⇒ 未知 ⇒ 放行（全仓口径）。
  const [serverCaps, setServerCaps] = useState<readonly string[] | undefined>(undefined);
  const [draft, setDraft] = useState<GrantDraft>({ capability: 'schedules', scope_kind: 'network', scope_id: '', level: 'edit' });

  useEffect(() => {
    let alive = true;
    setGrants(null); setError('');
    void fetchNodeGrants(cfg, nodeId).then(r => {
      if (!alive) return;
      if (r.ok) { setGrants(r.grants.map(({ capability, scope_kind, scope_id, level }) => ({ capability, scope_kind, scope_id, level }))); setServerCaps(r.capabilities); }
      else { setGrants([]); setError(grantErrorText(r)); }
    });
    return () => { alive = false; };
  }, [cfg, nodeId]);

  // 能力是否真的可用：本地声明 **且** 服务器没明确排除。服务器没给清单 ⇒ 不知道 ⇒ 放行。
  const capAvailable = (key: string) => capabilityOffered(serverCaps, key);

  const save = async (next: GrantDraft[]): Promise<boolean> => {
    setBusy(true); setError(''); setNote('');
    const r = await putNodeGrants(cfg, nodeId, next);
    setBusy(false);
    if (!r.ok) { setError(grantErrorText(r)); return false; }
    setGrants(r.grants.map(({ capability, scope_kind, scope_id, level }) => ({ capability, scope_kind, scope_id, level })));
    setNote(t('nodeGrants.saved'));
    return true;
  };

  const label = (text: string) => <Text style={{ color: colors.textMuted, fontSize: typeScale.small }}>{text}</Text>;
  const row = (children: React.ReactNode, testID: string) => <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }} testID={testID}>{children}</View>;

  return (
    <View style={{ backgroundColor: colors.card, borderRadius: radius.surface, padding: spacing.lg, gap: spacing.md }} testID="node-grants-card">
      <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' }}>
        <Ionicons name="key-outline" size={20} color={colors.accent} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: colors.text, fontSize: typeScale.body, fontWeight: weight.strong }}>{t('nodeGrants.title')}</Text>
          <Text style={{ color: colors.textMuted, fontSize: typeScale.small, lineHeight: 18 }}>{t('nodeGrants.hint')}</Text>
        </View>
      </View>

      {grants === null ? <ActivityIndicator size="small" color={colors.accent} /> : grants.length === 0 ? (
        <Text style={{ color: colors.textSecondary, fontSize: typeScale.small }} testID="node-grants-empty">{t('nodeGrants.none')}</Text>
      ) : (
        <View style={{ gap: 6 }} testID="node-grants-list">
          {grants.map(g => {
            const key = `${g.capability}-${g.scope_kind}-${g.scope_id || 'all'}`;
            return (
              <View key={key} testID={`node-grant-${key}`} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6, paddingHorizontal: spacing.sm, borderRadius: radius.item, backgroundColor: colors.subtleFill }}>
                <Text style={{ flex: 1, color: colors.text, fontSize: typeScale.small }}>{grantLine(g, depts, nodes)}</Text>
                <Pressable accessibilityRole="button" disabled={busy} onPress={() => void save(removeGrant(grants, g))} testID={`node-grant-revoke-${key}`}
                  style={{ minHeight: compact ? 44 : 28, justifyContent: 'center', paddingHorizontal: spacing.sm }}>
                  <Text style={{ color: colors.failed, fontSize: typeScale.small }}>{t('nodeGrants.revoke')}</Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      )}

      {adding ? (
        <View style={{ gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md }} testID="node-grants-form">
          {label(t('nodeGrants.capability'))}
          {row(GRANT_CAPABILITIES.map(c => (
            <Chip key={c.key} testID={`node-grants-cap-${c.key}`} text={t(`nodeGrants.cap.${c.key}`)} on={draft.capability === c.key} disabled={!c.available || !capAvailable(c.key) || busy}
              note={c.available && capAvailable(c.key) ? undefined : t('nodeGrants.comingSoon')} onPress={() => setDraft(d => ({ ...d, capability: c.key }))} />
          )), 'node-grants-caps')}
          {label(t('nodeGrants.scope'))}
          {row((['network', 'department', 'node'] as const).map(k => (
            <Chip key={k} testID={`node-grants-scope-${k}`} on={draft.scope_kind === k} disabled={busy || (k === 'department' && !depts.length) || (k === 'node' && !nodes.length)}
              text={t(k === 'network' ? 'nodeGrants.scope.pickNetwork' : k === 'department' ? 'nodeGrants.scope.pickDepartment' : 'nodeGrants.scope.pickNode')}
              onPress={() => setDraft(d => ({ ...d, scope_kind: k, scope_id: '' }))} />
          )), 'node-grants-scopes')}
          {draft.scope_kind === 'department' ? row(depts.map(d => (
            <Chip key={d.id} testID={`node-grants-dept-${d.id}`} text={d.path} on={draft.scope_id === d.id} disabled={busy} onPress={() => setDraft(x => ({ ...x, scope_id: d.id }))} />
          )), 'node-grants-depts') : null}
          {draft.scope_kind === 'node' ? row(nodes.map(n => (
            <Chip key={n.node_id} testID={`node-grants-node-${n.node_id}`} text={n.alias || n.node_id} on={draft.scope_id === n.node_id} disabled={busy} onPress={() => setDraft(x => ({ ...x, scope_id: n.node_id }))} />
          )), 'node-grants-nodes') : null}
          {label(t('nodeGrants.level'))}
          {row((['read', 'edit'] as const).map(l => (
            <Chip key={l} testID={`node-grants-level-${l}`} text={t(l === 'read' ? 'nodeGrants.level.read' : 'nodeGrants.level.edit')} on={draft.level === l} disabled={busy} onPress={() => setDraft(d => ({ ...d, level: l }))} />
          )), 'node-grants-levels')}
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm }}>
            <Pressable accessibilityRole="button" testID="node-grants-cancel" onPress={() => setAdding(false)} disabled={busy}
              style={{ minHeight: 36, paddingHorizontal: spacing.lg, borderRadius: radius.control, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' }}>
              <Text style={{ color: colors.textSecondary, fontSize: typeScale.small }}>{t('nodeGrants.cancel')}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" testID="node-grants-save" disabled={busy || !draftComplete(draft) || grants === null}
              onPress={async () => { if (grants && await save(addGrant(grants, draft))) setAdding(false); }}
              style={{ minHeight: 36, paddingHorizontal: spacing.lg, borderRadius: radius.control, backgroundColor: colors.accent, justifyContent: 'center', opacity: busy || !draftComplete(draft) ? 0.4 : 1 }}>
              <Text style={{ color: colors.onAccent, fontSize: typeScale.small, fontWeight: weight.strong }}>{t('nodeGrants.save')}</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable accessibilityRole="button" testID="node-grants-add" disabled={busy || grants === null} onPress={() => { setAdding(true); setNote(''); setError(''); }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: compact ? 44 : 32 }}>
          <Ionicons name="add-circle-outline" size={18} color={colors.accent} />
          <Text style={{ color: colors.accent, fontSize: typeScale.small, fontWeight: weight.strong }}>{t('nodeGrants.add')}</Text>
        </Pressable>
      )}

      {busy ? <ActivityIndicator size="small" color={colors.accent} /> : null}
      {error ? <Text style={{ color: colors.failed, fontSize: typeScale.small, lineHeight: 18 }} testID="node-grants-error">{error}</Text> : null}
      {note && !error ? <Text style={{ color: colors.running, fontSize: typeScale.small }} testID="node-grants-note">{note}</Text> : null}
    </View>
  );
}
