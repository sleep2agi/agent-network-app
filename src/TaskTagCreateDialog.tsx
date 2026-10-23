import { useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import DialogFrame from './DialogFrame';
import { Text, TextInput } from './ui-text';
import { t as tr } from './i18n';
import { useTranslation } from './i18n-react';
import './i18n-task-tags';
import { colors, spacing } from './theme';
import { fieldStyles } from './TaskCreateDialog';
import { useTaskStyles } from './TaskBoardParts';
import type { TagCatalog } from './task-tag-catalog';
import { tagCreateError, tagCreateSupported } from './task-tag-create';

export default function TaskTagCreateDialog({ catalog, capabilities, initialParent, onCreate, onClose }: {
  catalog: TagCatalog;
  capabilities: readonly string[];
  initialParent: string | null;
  onCreate: (name: string, parent: string | null) => Promise<string | null>;
  onClose: () => void;
}) {
  useTranslation();
  const s = useTaskStyles();
  const f = fieldStyles();
  const [name, setName] = useState('');
  const [parent, setParent] = useState(initialParent);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const supported = tagCreateSupported(catalog, parent, capabilities);
  // Do not silently discard a stale/missing parent and create a root instead.
  const close = () => { if (!submitting.current) onClose(); };
  const submit = async () => {
    if (submitting.current) return;
    const invalid = tagCreateError(catalog, name, parent, capabilities);
    if (invalid) { setError(invalid); return; }
    submitting.current = true;
    setBusy(true);
    setError('');
    let failed: string | null;
    try { failed = await onCreate(name.trim(), parent); }
    catch { failed = 'tags.createUnconfirmed'; }
    submitting.current = false;
    setBusy(false);
    if (failed) setError(failed); else onClose();
  };
  return (
    <DialogFrame title={tr(initialParent === null ? 'tags.create' : 'tags.createChild')} closeLabel={tr('tags.cancel')} onClose={close} scroll={false} testID="tag-create-dialog"
      footer={<View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm }}>
        <Pressable accessibilityRole="button" disabled={busy} onPress={close} style={{ minHeight: 44, paddingHorizontal: spacing.md, justifyContent: 'center' }} testID="tag-create-cancel"><Text style={s.link}>{tr('tags.cancel')}</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={busy || !supported} accessibilityState={{ disabled: busy || !supported }} onPress={() => { void submit(); }} style={[s.primary, (busy || !supported) && { opacity: 0.5 }]} testID="tag-create-submit"><Text style={s.primaryText}>{tr(busy ? 'tags.saving' : 'tags.create')}</Text></Pressable>
      </View>}>
      <TextInput autoFocus editable={!busy && supported} value={name} onChangeText={value => { setName(value); setError(''); }} onSubmitEditing={() => { void submit(); }} returnKeyType="done" style={f.input} accessibilityLabel={tr('tags.name')} placeholder={tr('tags.name')} placeholderTextColor={colors.textMuted} testID="tag-create-name" />
      <Text style={s.muted}>{tr('tags.parent')}: {parent ?? tr('tags.root')}</Text>
      <TextInput value={query} onChangeText={setQuery} editable={!busy} placeholder={tr('tags.searchParent')} accessibilityLabel={tr('tags.searchParent')} placeholderTextColor={colors.textMuted} style={f.input} testID="tag-create-parent-search" />
      <ScrollView style={{ flexGrow: 0, flexShrink: 1, maxHeight: 216 }} keyboardShouldPersistTaps="handled" testID="tag-create-parents">
        {[null, ...catalog.tags.filter(tag => tag.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))].map(option => (
          <Pressable key={option === null ? 'root' : `tag:${option}`} accessibilityRole="button" accessibilityState={{ selected: parent === option }} aria-pressed={parent === option} disabled={busy || !tagCreateSupported(catalog, null, capabilities)} onPress={() => { setParent(option); setError(''); }} style={{ minHeight: 44, maxWidth: '100%', paddingHorizontal: spacing.sm, justifyContent: 'center', backgroundColor: parent === option ? colors.tonalBg : 'transparent' }} testID={option === null ? 'tag-create-parent-root' : `tag-create-parent-${option}`}>
            <Text numberOfLines={1} style={{ color: parent === option ? colors.accent : colors.textSecondary }}>{option ?? tr('tags.root')}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {!supported ? <Text style={s.muted} testID="tag-create-unsupported">{tr('tags.createUnsupported')}</Text> : null}
      {error ? <Text style={s.err} accessibilityRole="alert" testID="tag-create-error">{tr(error)}</Text> : null}
    </DialogFrame>
  );
}
