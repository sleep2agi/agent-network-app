// 管理标签:改名、合并(多选 → 合并为一个)、删除(确认里写明影响几个任务)、颜色。
// 桌面 = 居中对话框(同「管理项目」):每行 勾选 / 色点 / 名字(点一下改名)/ 用量 / 删除,底部是合并栏。
// 手机 = 微信式:底部面板里一条条整行列表,点一行弹出操作面板(改名 / 颜色 / 删除 / 取消),
//        「选择」进入多选,底部「合并」;改名、颜色、删除确认、合并都是同一个面板里的下一页。
// 每个动作立即写 Hub(POST /api/requirements/tags/ops),失败留在原处提示;Hub 没有 tag_ops 时根本不渲染入口。
import { useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import ModalKeyboardAvoider from './ModalKeyboardAvoider';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';
import { t as tr } from './i18n';
import { useTranslation } from './i18n-react';
import './i18n-task-tags';
import { useModalSafePadding } from './safe-area-runtime';
import { withBasePadding } from './modal-safe-area';
import { colors, radius, spacing, themeMode, type as typeScale, weight } from './theme';
import { liftedShadow, useTaskStyles } from './TaskBoardParts';
import { fieldStyles } from './TaskCreateDialog';
import { MAX_MERGE_SOURCES, TAG_COLORS, tagName, type TagCatalog, type TagOp } from './task-tag-catalog';

type Page =
  | { kind: 'list' }
  | { kind: 'actions'; tag: string }
  | { kind: 'rename'; tag: string }
  | { kind: 'color'; tag: string }
  | { kind: 'delete'; tag: string }
  | { kind: 'merge' };

export default function TaskTagManager({ open, sheet, catalog, onOp, onClose }: {
  open: boolean;
  /** true = 手机底部面板(微信式);false = 桌面居中对话框。 */
  sheet: boolean;
  catalog: TagCatalog;
  /** 执行一个操作;返回 null = 成功,否则是错误文案的 key。 */
  onOp: (op: TagOp) => Promise<string | null>;
  onClose: () => void;
}) {
  useTranslation();
  const s = useTaskStyles();
  const f = fieldStyles();
  const styles = makeStyles();
  const safe = useModalSafePadding(sheet ? 'fullScreen' : 'overlay');
  const [page, setPage] = useState<Page>({ kind: 'list' });
  const [picked, setPicked] = useState<string[]>([]);
  const [selecting, setSelecting] = useState(false);
  const [draft, setDraft] = useState('');
  const [mergeName, setMergeName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!open) return null;
  const tags = [...catalog.tags].sort((a, b) => (catalog.counts[b] ?? 0) - (catalog.counts[a] ?? 0) || a.localeCompare(b));
  const count = (tag: string) => catalog.counts[tag] ?? 0;
  const colorOf = (tag: string) => catalog.colors[tag];
  const pickedLive = picked.filter(tag => catalog.tags.includes(tag));
  const mergeUpTo = pickedLive.reduce((n, tag) => n + count(tag), 0);

  const run = async (op: TagOp) => {
    if (busy) return false;
    setBusy(true);
    setError('');
    const failed = await onOp(op);
    setBusy(false);
    if (failed) { setError(failed); return false; }
    return true;
  };
  const back = () => { setPage({ kind: 'list' }); setError(''); setDraft(''); };
  const close = () => { back(); setPicked([]); setSelecting(false); setEditing(null); onClose(); };
  const toggle = (tag: string) => setPicked(p => (p.includes(tag) ? p.filter(x => x !== tag) : p.length >= MAX_MERGE_SOURCES ? p : [...p, tag]));
  const rename = async (tag: string, raw: string) => {
    const to = tagName(raw);
    if (!to) { setError('tags.invalidName'); return; }
    if (to === tag) { setEditing(null); back(); return; }
    if (await run({ op: 'rename', from: tag, to })) { setEditing(null); setPicked(p => p.filter(x => x !== tag)); back(); }
  };
  const merge = async () => {
    const to = tagName(mergeName || pickedLive[0] || '');
    if (!to || pickedLive.length < 2) { setError('tags.invalidName'); return; }
    if (await run({ op: 'merge', from: pickedLive, to })) { setPicked([]); setSelecting(false); setMergeName(''); back(); }
  };
  const remove = async (tag: string) => {
    if (await run({ op: 'delete', tag })) { setPicked(p => p.filter(x => x !== tag)); back(); }
  };
  const setColor = async (tag: string, color: string | null) => {
    if (await run({ op: 'color', tag, color })) back();
  };

  const dot = (tag: string, size = 12) => (
    <View style={{ width: size, height: size, borderRadius: radius.pill, backgroundColor: colorOf(tag) ?? 'transparent', borderWidth: colorOf(tag) ? 0 : 1.5, borderColor: colors.textMuted }} />
  );
  const palette = (tag: string) => (
    <View style={styles.palette} testID="tag-palette">
      {TAG_COLORS.map(c => (
        <Pressable key={c} accessibilityRole="radio" accessibilityState={{ checked: colorOf(tag) === c }} accessibilityLabel={c} disabled={busy} onPress={() => { void setColor(tag, c); }} style={styles.paletteHit} testID={`tag-color-${c.slice(1)}`}>
          <View style={[styles.paletteDot, { backgroundColor: c }, colorOf(tag) === c && { borderWidth: 2, borderColor: colors.text }]} />
        </Pressable>
      ))}
      <Pressable accessibilityRole="button" disabled={busy || !colorOf(tag)} onPress={() => { void setColor(tag, null); }} style={[styles.paletteHit, { width: 'auto', paddingHorizontal: spacing.sm }]} testID="tag-color-none">
        <Text style={[s.link, !colorOf(tag) && { color: colors.textMuted }]}>{tr('tags.colorNone')}</Text>
      </Pressable>
    </View>
  );
  const errorLine = error ? <Text style={s.err} accessibilityRole="alert" testID="tag-manager-error">{tr(error)}</Text> : null;

  // ── 桌面:一张表 ──
  const desktopRow = (tag: string) => {
    const on = pickedLive.includes(tag);
    const confirming = page.kind === 'delete' && page.tag === tag;
    const coloring = page.kind === 'color' && page.tag === tag;
    return (
      <View key={tag} testID={`tag-row-${tag}`} style={{ gap: spacing.xs }}>
        <View style={styles.row}>
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={tr('tags.pick', { tag })} onPress={() => toggle(tag)} style={styles.hit} testID={`tag-pick-${tag}`}>
            <Ionicons name={on ? 'checkbox' : 'square-outline'} size={16} color={on ? colors.accent : colors.textMuted} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={tr('tags.colorOf', { tag })} onPress={() => setPage(coloring ? { kind: 'list' } : { kind: 'color', tag })} style={styles.hit} testID={`tag-swatch-${tag}`}>
            {dot(tag, 14)}
          </Pressable>
          {editing === tag ? (
            <TextInput autoFocus value={draft} onChangeText={v => { setDraft(v); setError(''); }} onSubmitEditing={() => { void rename(tag, draft); }} onBlur={() => { if (!busy) setEditing(null); }} maxLength={20} style={[f.input, { flex: 1, minHeight: 32, paddingVertical: 4 }]} testID={`tag-name-input-${tag}`} accessibilityLabel={tr('tags.renameTitle', { tag })} />
          ) : (
            <Pressable style={{ flex: 1, minWidth: 0 }} onPress={() => { setEditing(tag); setDraft(tag); setError(''); }} accessibilityRole="button" accessibilityLabel={tr('tags.renameTitle', { tag })} testID={`tag-name-${tag}`}>
              <Text style={{ color: colors.text, fontSize: typeScale.body }} numberOfLines={1}>{tag}</Text>
            </Pressable>
          )}
          <Text style={[s.muted, styles.usage]} testID={`tag-usage-${tag}`}>{tr('tags.usage', { n: count(tag) })}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={tr('tags.deleteTitle', { tag })} onPress={() => setPage(confirming ? { kind: 'list' } : { kind: 'delete', tag })} style={styles.hit} testID={`tag-delete-${tag}`}>
            <Ionicons name="trash-outline" size={15} color={colors.textMuted} />
          </Pressable>
        </View>
        {coloring ? palette(tag) : null}
        {confirming ? (
          <View style={[styles.confirm, { borderColor: colors.failed }]} testID="tag-delete-confirm">
            <Text style={{ flex: 1, color: colors.text, fontSize: typeScale.small }}>{tr('tags.deleteBody', { n: count(tag) })}</Text>
            <Pressable accessibilityRole="button" onPress={back} style={styles.textBtn} testID="tag-delete-cancel"><Text style={s.link}>{tr('tags.cancel')}</Text></Pressable>
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => { void remove(tag); }} style={[styles.dangerBtn, { backgroundColor: colors.failed }, busy && { opacity: 0.5 }]} testID="tag-delete-go">
              <Text style={{ color: '#fff', fontSize: typeScale.small, fontWeight: weight.medium }}>{tr('tags.deleteConfirm', { n: count(tag) })}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  };
  const desktopMergeBar = pickedLive.length >= 2 ? (
    <View style={[styles.mergeBar, { backgroundColor: colors.subtleFill }]} testID="tag-merge-bar">
      <Text style={[s.muted, { flexShrink: 0 }]}>{tr('tags.selected', { n: pickedLive.length })} · {tr('tags.mergeInto')}</Text>
      <TextInput value={mergeName} placeholder={pickedLive[0]} placeholderTextColor={colors.textMuted} onChangeText={v => { setMergeName(v); setError(''); }} onSubmitEditing={() => { void merge(); }} maxLength={20} style={[f.input, { flex: 1, minHeight: 32, paddingVertical: 4 }]} testID="tag-merge-input" accessibilityLabel={tr('tags.mergeInto')} />
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => { void merge(); }} style={[s.primary, busy && { opacity: 0.5 }]} testID="tag-merge-go">
        <Text style={s.primaryText}>{tr('tags.merge')}</Text>
      </Pressable>
    </View>
  ) : <Text style={s.muted}>{tr('tags.mergeHint')}</Text>;

  // ── 手机:微信式分组列表 + 下一页 ──
  const sheetRow = (tag: string, last: boolean) => {
    const on = pickedLive.includes(tag);
    return (
      <Pressable key={tag} testID={`tag-row-${tag}`} accessibilityRole={selecting ? 'checkbox' : 'button'} accessibilityState={selecting ? { checked: on } : undefined} accessibilityLabel={selecting ? tr('tags.pick', { tag }) : tr('tags.actions', { tag })}
        onPress={() => (selecting ? toggle(tag) : setPage({ kind: 'actions', tag }))}
        style={state => [styles.sheetRow, { backgroundColor: state.pressed ? colors.groupedRowPressed : colors.groupedRow }]}>
        {selecting ? <Ionicons name={on ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={on ? colors.accent : colors.textMuted} /> : null}
        {dot(tag)}
        <View style={[styles.sheetRowBody, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
          <Text style={{ flex: 1, minWidth: 0, color: colors.text, fontSize: typeScale.body + 2 }} numberOfLines={1} testID={`tag-name-${tag}`}>{tag}</Text>
          <Text style={[s.muted, styles.usage]} testID={`tag-usage-${tag}`}>{tr('tags.usage', { n: count(tag) })}</Text>
          {!selecting ? <Ionicons name="chevron-forward" size={16} color={colors.textMuted} /> : null}
        </View>
      </Pressable>
    );
  };
  const actionSheet = (items: { key: string; label: string; danger?: boolean; onPress: () => void }[], title?: string) => (
    <View style={{ gap: spacing.sm }} testID="tag-action-sheet">
      <View style={[styles.group, { backgroundColor: colors.groupedRow }]}>
        {title ? <Text style={[styles.actionTitle, { color: colors.textMuted, borderBottomColor: colors.border }]}>{title}</Text> : null}
        {items.map((it, i) => (
          <Pressable key={it.key} accessibilityRole="button" disabled={busy} onPress={it.onPress} testID={`tag-action-${it.key}`}
            style={state => [styles.actionRow, i < items.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, state.pressed && { backgroundColor: colors.groupedRowPressed }]}>
            <Text style={{ color: it.danger ? colors.failed : colors.text, fontSize: typeScale.title }}>{it.label}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable accessibilityRole="button" onPress={back} testID="tag-action-cancel" style={state => [styles.group, styles.actionRow, { backgroundColor: state.pressed ? colors.groupedRowPressed : colors.groupedRow }]}>
        <Text style={{ color: colors.text, fontSize: typeScale.title, fontWeight: weight.medium }}>{tr('tags.cancel')}</Text>
      </Pressable>
    </View>
  );
  const formPage = (title: string, body: ReactNode, onSave: () => void, saveLabel = tr('tags.save')) => (
    <View style={{ gap: spacing.md }}>
      <View style={styles.sheetHead}>
        <Pressable accessibilityRole="button" onPress={back} style={styles.textBtn} testID="tag-form-cancel"><Text style={{ color: colors.text, fontSize: typeScale.body }}>{tr('tags.cancel')}</Text></Pressable>
        <Text style={[styles.sheetTitle, { color: colors.text }]} numberOfLines={1}>{title}</Text>
        <Pressable accessibilityRole="button" disabled={busy} onPress={onSave} style={[s.primary, busy && { opacity: 0.5 }]} testID="tag-form-save"><Text style={s.primaryText}>{saveLabel}</Text></Pressable>
      </View>
      {body}
      {errorLine}
    </View>
  );
  const sheetContent = (() => {
    if (page.kind === 'actions') {
      const tag = page.tag;
      return actionSheet([
        { key: 'rename', label: tr('tags.rename'), onPress: () => { setDraft(tag); setPage({ kind: 'rename', tag }); } },
        { key: 'color', label: tr('tags.color'), onPress: () => setPage({ kind: 'color', tag }) },
        { key: 'delete', label: tr('tags.delete'), danger: true, onPress: () => setPage({ kind: 'delete', tag }) },
      ], `${tag} · ${tr('tags.usage', { n: count(tag) })}`);
    }
    if (page.kind === 'delete') {
      const tag = page.tag;
      return (
        <View style={{ gap: spacing.sm }}>
          {actionSheet([{ key: 'delete-go', label: tr('tags.deleteConfirm', { n: count(tag) }), danger: true, onPress: () => { void remove(tag); } }], `${tr('tags.deleteTitle', { tag })}\n${tr('tags.deleteBody', { n: count(tag) })}`)}
          {errorLine}
        </View>
      );
    }
    if (page.kind === 'rename') {
      const tag = page.tag;
      return formPage(tr('tags.renameTitle', { tag }), (
        <View style={{ gap: spacing.sm }}>
          <TextInput autoFocus value={draft} onChangeText={v => { setDraft(v); setError(''); }} onSubmitEditing={() => { void rename(tag, draft); }} maxLength={20} style={[f.input, { minHeight: 44 }]} testID="tag-rename-input" accessibilityLabel={tr('tags.renameTitle', { tag })} />
          <Text style={s.muted}>{tr('tags.renameHint')}</Text>
        </View>
      ), () => { void rename(tag, draft); });
    }
    if (page.kind === 'color') {
      const tag = page.tag;
      return (
        <View style={{ gap: spacing.md }}>
          <View style={styles.sheetHead}>
            <Pressable accessibilityRole="button" onPress={back} style={styles.textBtn} testID="tag-form-cancel"><Text style={{ color: colors.text, fontSize: typeScale.body }}>{tr('tags.cancel')}</Text></Pressable>
            <Text style={[styles.sheetTitle, { color: colors.text }]} numberOfLines={1}>{tr('tags.colorOf', { tag })}</Text>
            <View style={{ width: 56 }} />
          </View>
          {palette(tag)}
          {errorLine}
        </View>
      );
    }
    if (page.kind === 'merge') {
      return formPage(tr('tags.mergeTitle', { n: pickedLive.length }), (
        <View style={{ gap: spacing.sm }}>
          <Text style={{ color: colors.text, fontSize: typeScale.body }}>{tr('tags.mergeBody', { tags: pickedLive.map(t => `「${t}」`).join(''), n: mergeUpTo })}</Text>
          <TextInput autoFocus value={mergeName} placeholder={pickedLive[0]} placeholderTextColor={colors.textMuted} onChangeText={v => { setMergeName(v); setError(''); }} onSubmitEditing={() => { void merge(); }} maxLength={20} style={[f.input, { minHeight: 44 }]} testID="tag-merge-input" accessibilityLabel={tr('tags.mergeInto')} />
        </View>
      ), () => { void merge(); }, tr('tags.merge'));
    }
    return (
      <View style={{ gap: spacing.md, flexShrink: 1 }}>
        <View style={styles.sheetHead}>
          <Pressable accessibilityRole="button" onPress={close} style={styles.textBtn} testID="tag-manager-close"><Text style={{ color: colors.text, fontSize: typeScale.body }}>{tr('tags.done')}</Text></Pressable>
          <Text style={[styles.sheetTitle, { color: colors.text }]} testID="tag-manager-title">{tr('tags.manage')}</Text>
          <Pressable accessibilityRole="button" disabled={!tags.length} onPress={() => { setSelecting(v => !v); setPicked([]); }} style={styles.textBtn} testID="tag-select-toggle">
            <Text style={{ color: tags.length ? colors.accent : colors.textMuted, fontSize: typeScale.body }}>{selecting ? tr('tags.cancel') : tr('tags.select')}</Text>
          </Pressable>
        </View>
        <ScrollView style={{ flexGrow: 0, flexShrink: 1 }} contentContainerStyle={[styles.group, { backgroundColor: colors.groupedRow }]} testID="tag-manager-list">
          {tags.length ? tags.map((tag, i) => sheetRow(tag, i === tags.length - 1)) : <Text style={[s.muted, { padding: spacing.lg }]}>{tr('tags.none')}</Text>}
        </ScrollView>
        {selecting ? (
          <Pressable accessibilityRole="button" disabled={pickedLive.length < 2} onPress={() => { setMergeName(''); setPage({ kind: 'merge' }); }} style={[s.primary, { justifyContent: 'center', minHeight: 44 }, pickedLive.length < 2 && { opacity: 0.5 }]} testID="tag-merge-open">
            <Text style={s.primaryText}>{pickedLive.length >= 2 ? `${tr('tags.merge')}（${pickedLive.length}）` : tr('tags.mergeHint')}</Text>
          </Pressable>
        ) : null}
        {errorLine}
      </View>
    );
  })();

  const panel = sheet
    ? { backgroundColor: colors.groupedBg, gap: spacing.md, padding: spacing.lg, borderTopLeftRadius: radius.surface, borderTopRightRadius: radius.surface, paddingBottom: spacing.lg + safe.paddingBottom, maxHeight: '85%' as const, ...liftedShadow() }
    : { backgroundColor: colors.card, gap: spacing.lg, padding: spacing.xl, width: '100%' as const, maxWidth: 560, maxHeight: '85%' as const, borderRadius: radius.surface, borderWidth: themeMode() === 'dark' ? 1 : 0, borderColor: colors.border, ...liftedShadow() };
  return (
    <Modal visible transparent animationType={sheet ? 'slide' : 'fade'} onRequestClose={page.kind === 'list' ? close : back}>
      <ModalKeyboardAvoider scrim="rgba(0,0,0,0.4)">
        <View style={[{ flex: 1 }, sheet ? { justifyContent: 'flex-end' } : [{ alignItems: 'center', justifyContent: 'center' }, withBasePadding(safe, spacing.lg)]]}>
          <Pressable accessibilityLabel={tr('tags.cancel')} onPress={close} style={StyleSheet.absoluteFill} />
          <View style={panel} accessibilityViewIsModal testID="tag-manager">
            {sheet ? sheetContent : (
              <>
                <View style={styles.desktopHead}>
                  <Text style={{ color: colors.text, fontSize: typeScale.title + 1, fontWeight: weight.strong }} testID="tag-manager-title">{tr('tags.manage')}</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel={tr('tags.cancel')} onPress={close} style={s.iconButton} testID="tag-manager-close">
                    <Ionicons name="close" size={18} color={colors.textSecondary} />
                  </Pressable>
                </View>
                <ScrollView style={{ flexGrow: 0, flexShrink: 1 }} contentContainerStyle={{ gap: 2 }} testID="tag-manager-list">
                  {tags.length ? tags.map(desktopRow) : <Text style={s.muted}>{tr('tags.none')}</Text>}
                </ScrollView>
                {tags.length ? desktopMergeBar : null}
                {errorLine}
              </>
            )}
          </View>
        </View>
      </ModalKeyboardAvoider>
    </Modal>
  );
}

const makeStyles = () => StyleSheet.create({
  desktopHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 40 },
  hit: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  usage: { flexShrink: 0, minWidth: 56, textAlign: 'right' },
  confirm: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderRadius: radius.item, padding: spacing.sm, marginLeft: 64 },
  textBtn: { minWidth: 56, minHeight: 36, justifyContent: 'center', paddingHorizontal: spacing.xs },
  dangerBtn: { minHeight: 32, borderRadius: radius.item, paddingHorizontal: spacing.md, justifyContent: 'center' },
  palette: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs, paddingLeft: 36 },
  paletteHit: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  paletteDot: { width: 22, height: 22, borderRadius: radius.pill },
  mergeBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: radius.item },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, minHeight: 44 },
  sheetTitle: { flex: 1, textAlign: 'center', fontSize: typeScale.title, fontWeight: weight.strong },
  group: { borderRadius: radius.item, overflow: 'hidden' },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingLeft: spacing.lg, minHeight: 56 },
  sheetRowBody: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, alignSelf: 'stretch', paddingRight: spacing.md },
  actionTitle: { textAlign: 'center', fontSize: typeScale.small, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  actionRow: { minHeight: 56, alignItems: 'center', justifyContent: 'center' },
});
