// 部门群(RFC-042,看板 #457 第 4 步;Hub ≥ .93)—— 「成员与部门」/「管理本部门」里的那一块。
//
// 功能门:useGroupSupport 探 GET …/chat-groups,2xx 才画;旧 Hub(404)整块不出现,不报错。
// 权限:按钮只给能管的人画 —— 优先 Hub 的 viewer_can.manage(§10),没有就按 canManageDeptGroup(owner / admin;负责人 = 本部门子树)。Hub 仍是最后的判定,
// 被拒时照 Hub 的原因说(groupErrorText)。
// 内容:还没有群 →「创建部门群」;有群 → 群名(可改)、成员列表(每人标「部门 / 手动」)、添加成员、移出手动拉进来的人。
// 两套交互:
//   电脑(desktop):部门详情右栏里的一张卡片,小按钮在卡片标题行,改名 / 添加成员都在卡片里就地展开。
//   手机:部门页底下一行「部门群 ›」推入的整页(OrgPhoneModal 的栈),52 dp 的行,底部整宽主按钮。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';
import AliasAvatar from './AliasAvatar';
import GroupAvatar from './GroupAvatar';
import { colors, radius, spacing, type as typeScale, weight } from './theme';
import type { HubConfig } from './api';
import { addableMembers, canManageGroup, groupMemberRows, validGroupName } from './group-chat';
import { addGroupMember, createDepartmentGroup, fetchDepartmentGroup, probeGroupSupport, removeGroupMember, renameGroup, type GroupDetail } from './group-chat-api';
import { emitGroupChat } from './group-chat-bus';
import { pinyinMatch } from './lib/pinyin';

type Person = { user_id: string; username: string; display_name?: string | null };

/** 这个 Hub 有没有群。探之前 / 探失败 = false(不画)。 */
export function useGroupSupport(cfg: HubConfig, networkId: string): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let live = true;
    void probeGroupSupport(cfg, networkId).then(v => { if (live) setOk(v); });
    return () => { live = false; };
  }, [cfg.serverUrl, cfg.token, networkId]);
  return ok;
}

type State = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'none' } | { kind: 'ok'; detail: GroupDetail };
type Mode = 'view' | 'rename' | 'add';

export function DeptGroupSection({ cfg, networkId, deptId, deptName, managed, people, desktop }: {
  cfg: HubConfig;
  networkId: string;
  deptId: string;
  deptName: string;
  /** 负责人模式:我负责的部门(含下级);null = owner / admin(「成员与部门」)。 */
  managed: ReadonlySet<string> | null;
  people: readonly Person[];
  desktop: boolean;
}) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  // Hub 给了 viewer_can.manage(§10)就照它;还没有群 / 旧 Hub 没给 → 本地规则(owner / admin,或本部门子树的负责人)。
  const canManage = canManageGroup(state.kind === 'ok' ? state.detail.group : null, managed, deptId);
  const [mode, setMode] = useState<Mode>('view');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [nameDraft, setNameDraft] = useState('');
  const [q, setQ] = useState('');
  const load = useCallback(async () => {
    try {
      const d = await fetchDepartmentGroup(cfg, networkId, deptId);
      setState(d ? { kind: 'ok', detail: d } : { kind: 'none' });
    } catch (e) {
      setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, [cfg.serverUrl, cfg.token, networkId, deptId]);
  useEffect(() => { setState({ kind: 'loading' }); setMode('view'); setError(''); void load(); }, [load]);

  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(true); setError('');
    try { await fn(); await load(); emitGroupChat(null); after?.(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  const detail = state.kind === 'ok' ? state.detail : null;
  const rows = useMemo(() => (detail ? groupMemberRows(detail.members, detail.group, people) : []), [detail, people]);
  const candidates = useMemo(() => {
    const list = detail ? addableMembers(people, detail.members) : [];
    const needle = q.trim();
    const name = (p: Person) => (p.display_name ?? '').trim() || p.username;
    return needle ? list.filter(p => pinyinMatch(name(p), needle) || pinyinMatch(p.username, needle)) : list;
  }, [detail, people, q]);

  // 没有群、我也管不了 → 整块不画(看不见的群 Hub 也回 404,不暴露有没有)。
  if (state.kind === 'none' && !canManage) return null;
  if (state.kind === 'loading') return desktop ? null : <Text style={{ color: colors.textMuted, padding: spacing.lg }} testID="dept-group-loading">读取中…</Text>;

  const button = (label: string, onPress: () => void, testID: string, tone: 'plain' | 'accent' | 'danger' = 'plain', disabled?: boolean) => desktop ? (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress} testID={testID}
      style={st => [{ height: 30, paddingHorizontal: spacing.md, borderRadius: radius.control, borderWidth: tone === 'accent' ? 0 : 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.45 : 1 }, ((st as { hovered?: boolean }).hovered || st.pressed) ? { backgroundColor: colors.rowHover } : null]}>
      <Text style={{ color: tone === 'danger' ? colors.failed : tone === 'accent' ? colors.accent : colors.text, fontSize: typeScale.small }}>{label}</Text>
    </Pressable>
  ) : (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress} testID={testID} hitSlop={6}
      style={st => [{ minHeight: 36, paddingHorizontal: spacing.sm, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.45 : 1 }, st.pressed ? { opacity: 0.6 } : null]}>
      <Text style={{ color: tone === 'danger' ? colors.failed : colors.accent, fontSize: typeScale.body }}>{label}</Text>
    </Pressable>
  );
  const primary = (label: string, onPress: () => void, testID: string, disabled?: boolean) => (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress} testID={testID}
      style={{ height: desktop ? 32 : 48, alignSelf: desktop ? 'flex-start' : 'stretch', paddingHorizontal: spacing.lg, borderRadius: radius.control, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent, opacity: disabled ? 0.45 : 1 }}>
      <Text style={{ color: colors.onAccent, fontSize: desktop ? typeScale.small : typeScale.body, fontWeight: weight.strong }}>{label}</Text>
    </Pressable>
  );
  const errorLine = error ? <Text style={{ color: colors.failed, fontSize: typeScale.small }} accessibilityRole="alert" testID="dept-group-error">{error}</Text> : null;
  const rowH = desktop ? 44 : 56;

  const body = (() => {
    if (state.kind === 'error') {
      return (
        <View style={{ gap: spacing.sm, alignItems: 'flex-start' }} testID="dept-group-load-error">
          <Text style={{ color: colors.failed, fontSize: typeScale.small }}>{state.message}</Text>
          {button('重试', () => { setState({ kind: 'loading' }); void load(); }, 'dept-group-retry')}
        </View>
      );
    }
    if (state.kind === 'none') {
      return (
        <View style={{ gap: spacing.md }} testID="dept-group-empty">
          <Text style={{ color: colors.textSecondary, fontSize: typeScale.small, lineHeight: 18 }}>
            「{deptName}」还没有部门群。建群后,本部门(含下级部门)的成员和各部门负责人会自动加入,调动部门时自动进出。
          </Text>
          {primary(busy ? '正在创建…' : '创建部门群', () => void run(() => createDepartmentGroup(cfg, networkId, deptId)), 'dept-group-create', busy)}
          {errorLine}
        </View>
      );
    }
    const d = state.detail;
    return (
      <View style={{ gap: spacing.md }} testID="dept-group-detail">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <GroupAvatar size={desktop ? 36 : 44} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: colors.text, fontSize: typeScale.body, fontWeight: weight.strong }} numberOfLines={1} testID="dept-group-name">{d.group.name}</Text>
            <Text style={{ color: colors.textMuted, fontSize: typeScale.small }} numberOfLines={1} testID="dept-group-count">{d.members.length} 人{d.is_member === false ? ' · 你不在这个群里' : ''}</Text>
          </View>
          {canManage && mode === 'view' ? (
            <>
              {button('改群名', () => { setError(''); setNameDraft(d.group.name); setMode('rename'); }, 'dept-group-rename')}
              {button('添加成员', () => { setError(''); setQ(''); setMode('add'); }, 'dept-group-add')}
            </>
          ) : null}
        </View>
        {mode === 'rename' ? (
          <View style={{ gap: spacing.sm }} testID="dept-group-rename-form">
            <TextInput value={nameDraft} onChangeText={setNameDraft} placeholder="群名称(1–40 个字)" placeholderTextColor={colors.textMuted} maxLength={40} accessibilityLabel="群名称" testID="dept-group-name-input"
              style={{ height: desktop ? 32 : 44, paddingHorizontal: spacing.md, borderRadius: radius.control, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.inputBg, color: colors.text, fontSize: typeScale.body } as object} />
            <View style={{ flexDirection: 'row', gap: spacing.sm, justifyContent: desktop ? 'flex-start' : 'flex-end' }}>
              {button('取消', () => setMode('view'), 'dept-group-rename-cancel')}
              {button('保存', () => void run(() => renameGroup(cfg, networkId, d.group.id, nameDraft.trim()), () => setMode('view')), 'dept-group-rename-save', 'accent', busy || !validGroupName(nameDraft) || nameDraft.trim() === d.group.name)}
            </View>
          </View>
        ) : null}
        {errorLine}
        {mode === 'add' ? (
          <View style={{ gap: spacing.sm }} testID="dept-group-add-form">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <TextInput value={q} onChangeText={setQ} placeholder="搜索成员" placeholderTextColor={colors.textMuted} accessibilityLabel="搜索成员" testID="dept-group-add-search"
                style={{ flex: 1, height: desktop ? 32 : 40, paddingHorizontal: spacing.md, borderRadius: radius.control, backgroundColor: colors.inputBg, color: colors.text, fontSize: typeScale.small } as object} />
              {button('完成', () => setMode('view'), 'dept-group-add-done')}
            </View>
            <Text style={{ color: colors.textMuted, fontSize: 11 }}>手动拉进来的人不随部门调动进出;移出要在这里手动移。</Text>
            <View style={{ borderTopWidth: 1, borderTopColor: colors.border }}>
              {candidates.length ? candidates.map(p => (
                <Pressable key={p.user_id} accessibilityRole="button" accessibilityLabel={`把 ${(p.display_name ?? '').trim() || p.username} 拉进群`} disabled={busy}
                  onPress={() => void run(() => addGroupMember(cfg, networkId, d.group.id, p.user_id))} testID={`dept-group-add-${p.username}`}
                  style={st => [{ minHeight: rowH, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border }, ((st as { hovered?: boolean }).hovered || st.pressed) ? { backgroundColor: colors.rowHover } : null]}>
                  <AliasAvatar alias={p.username} size={28} />
                  <Text style={{ flex: 1, color: colors.text, fontSize: typeScale.body }} numberOfLines={1}>{(p.display_name ?? '').trim() || p.username}</Text>
                  <Ionicons name="add-circle-outline" size={20} color={colors.accent} />
                </Pressable>
              )) : <Text style={{ color: colors.textMuted, padding: spacing.sm }} testID="dept-group-add-empty">{q.trim() ? `没有找到「${q.trim()}」` : '网络里的人都已经在群里了'}</Text>}
            </View>
          </View>
        ) : null}
        <View style={{ borderTopWidth: 1, borderTopColor: colors.border }} testID="dept-group-members">
          {rows.map(m => (
            <View key={m.user_id} style={{ minHeight: rowH, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: desktop ? spacing.sm : 0, borderBottomWidth: 1, borderBottomColor: colors.border }} testID={`dept-group-member-${m.username}`}>
              <AliasAvatar alias={m.username} size={desktop ? 28 : 36} />
              <Text style={{ flex: 1, color: colors.text, fontSize: typeScale.body }} numberOfLines={1}>{m.name}</Text>
              <View style={{ paddingHorizontal: 6, height: 18, borderRadius: radius.pill, justifyContent: 'center', backgroundColor: m.source === 'department' ? colors.accent + '1f' : colors.subtleFill }} testID={`dept-group-source-${m.username}`}>
                <Text style={{ color: m.source === 'department' ? colors.accent : colors.textSecondary, fontSize: 11 }}>{m.sourceLabel}</Text>
              </View>
              {canManage && m.removable ? button('移出', () => void run(() => removeGroupMember(cfg, networkId, d.group.id, m.user_id)), `dept-group-remove-${m.username}`, 'danger', busy) : null}
            </View>
          ))}
        </View>
        <Text style={{ color: colors.textMuted, fontSize: 11 }}>「部门」= 随部门自动加入,调动部门时自动进出;「手动」= 有人拉进来的。</Text>
      </View>
    );
  })();

  if (desktop) {
    return (
      <View style={{ gap: spacing.sm }} testID="dept-group-section">
        <Text style={{ color: colors.textSecondary, fontSize: typeScale.small, fontWeight: weight.medium }}>部门群</Text>
        <View style={{ padding: spacing.md, borderRadius: radius.control, borderWidth: 1, borderColor: colors.border }}>{body}</View>
      </View>
    );
  }
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl }} keyboardShouldPersistTaps="handled" testID="dept-group-section">
      <View style={{ padding: spacing.lg, borderRadius: radius.surface, backgroundColor: colors.card }}>{body}</View>
    </ScrollView>
  );
}
