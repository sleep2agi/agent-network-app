import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { colors, radius } from './theme';
import { t } from './i18n';
import { useTranslation } from './i18n-react';
import './i18n-task-tags';
import { normalizeTags } from './requirement-tags';
import type { Requirement } from './requirements-model';
import type { EditPatch } from './task-board-model';
import type { HubConfig } from './api';
import { appFetch } from './app-fetch';
import { setTaskFilter, useTaskBoard } from './task-board-store';

export function TaskTagFilter() {
  useTranslation();
  const [open, setOpen] = useState(false);
  const items = useTaskBoard(s => s.items), filter = useTaskBoard(s => s.filter);
  const tags = [...new Set(items.flatMap(item => item.tags ?? []))];
  return <View style={{ maxWidth: 260 }}>
    <Pressable testID="task-tags-filter" accessibilityRole="button" onPress={() => setOpen(!open)} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 }}><Text numberOfLines={1} style={{ color: filter.tag ? colors.accent : colors.textMuted }}>{filter.tag || t('tags.title')}</Text></Pressable>
    {open ? <ScrollView horizontal style={{ maxHeight: 52 }} contentContainerStyle={{ gap: 6 }}>{['', ...tags].map(tag => <Pressable key={tag} testID={`task-tags-pick-${tag || 'all'}`} accessibilityRole="button" onPress={() => { setTaskFilter({ ...filter, tag }); setOpen(false); }} style={{ minHeight: 44, paddingHorizontal: 10, justifyContent: 'center', backgroundColor: colors.subtleFill, borderRadius: radius.control }}><Text style={{ color: colors.text }}>{tag || t('tags.all')}</Text></Pressable>)}</ScrollView> : null}
  </View>;
}

export function TaskTagChips({ tags }: { tags?: readonly string[] }) {
  return <View testID="task-tag-chips" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, maxWidth: '100%' }}>
    {tags?.map(tag => <View key={tag} style={{ backgroundColor: colors.subtleFill, borderRadius: radius.control, paddingHorizontal: 7, paddingVertical: 3, maxWidth: '100%' }}><Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 11 }}>{tag}</Text></View>)}
  </View>;
}

export default function TaskTags({ cfg, item, onSave }: { cfg: HubConfig; item: Requirement; onSave: (patch: EditPatch) => Promise<string | null> }) {
  useTranslation();
  const [input, setInput] = useState(''), [choices, setChoices] = useState<string[]>([]);
  const [error, setError] = useState(''), [loadFailed, setLoadFailed] = useState(false), [saving, setSaving] = useState(false);
  const busy = useRef(false), live = useRef(true);
  useEffect(() => {
    live.current = true;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    if (item.tags !== undefined) void appFetch(`${cfg.serverUrl}/api/requirements/tags${cfg.networkId ? `?network_id=${encodeURIComponent(cfg.networkId)}` : ''}`, { headers: { Authorization: `Bearer ${cfg.token}` }, signal: ctrl.signal })
      .then(async res => { if (!res.ok) throw new Error(); const data = await res.json(); if (live.current) setChoices(Array.isArray(data.tags) ? data.tags.filter((x: unknown): x is string => typeof x === 'string') : []); })
      .catch(() => { if (live.current) setLoadFailed(true); }).finally(() => clearTimeout(timer));
    return () => { live.current = false; ctrl.abort(); clearTimeout(timer); };
  }, [cfg.serverUrl, cfg.token, cfg.networkId, item.id]);
  const tags = item.tags ?? [];
  const save = async (next: string[]) => {
    if (busy.current || item.tags === undefined) return;
    const valid = normalizeTags(next);
    if (!valid) { setError('tags.invalid'); return; }
    busy.current = true; setSaving(true); setError('');
    try {
      const failed = await onSave({ tags: valid });
      if (!live.current) return;
      if (failed) setError(failed === 'invalid_tags' ? 'tags.invalid' : 'tags.failed');
      else { setInput(''); setChoices(current => [...new Set([...current, ...valid])]); }
    } catch { if (live.current) setError('tags.failed'); }
    finally { busy.current = false; if (live.current) setSaving(false); }
  };
  return <View testID="req-tags" style={{ gap: 8 }}>
    <Text style={{ color: colors.textMuted, fontSize: 12 }}>{t('tags.title')}</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{tags.map(tag => <Pressable key={tag} disabled={saving} accessibilityRole="button" accessibilityLabel={t('tags.remove', { tag })} onPress={() => void save(tags.filter(x => x !== tag))} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 10, borderRadius: radius.control, backgroundColor: colors.subtleFill, maxWidth: '100%' }}><Text numberOfLines={1} style={{ color: colors.text }}>{tag} ×</Text></Pressable>)}</View>
    {item.tags === undefined ? <Text style={{ color: colors.textMuted }}>{t('tags.unsupported')}</Text> : <>
      <View style={{ flexDirection: 'row', gap: 8 }}><TextInput testID="req-tag-input" accessibilityLabel={t('tags.input')} placeholder={t('tags.input')} value={input} onChangeText={setInput} editable={!saving} onSubmitEditing={() => void save([...tags, input])} style={{ flex: 1, minWidth: 0, minHeight: 44, paddingHorizontal: 10, borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, color: colors.text }} /><Pressable testID="req-tag-add" accessibilityRole="button" disabled={saving} onPress={() => void save([...tags, input])} style={{ minHeight: 44, paddingHorizontal: 12, justifyContent: 'center' }}><Text style={{ color: colors.accent }}>{t('tags.add')}</Text></Pressable></View>
      <View testID="req-tag-options" style={{ gap: 2 }}>{choices.filter(tag => !tags.includes(tag) && tag.toLocaleLowerCase().includes(input.toLocaleLowerCase())).slice(0, 12).map(tag => <Pressable key={tag} accessibilityRole="button" disabled={saving} onPress={() => void save([...tags, tag])} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 10 }}><Text numberOfLines={1} style={{ color: colors.text }}>{tag}</Text></Pressable>)}</View>
    </>}
    {loadFailed ? <Text style={{ color: colors.textMuted }}>{t('tags.loadingFailed')}</Text> : null}
    {saving ? <Text style={{ color: colors.textMuted }}>{t('tags.saving')}</Text> : null}
    {error ? <Text accessibilityRole="alert" style={{ color: colors.failed }}>{t(error)}</Text> : null}
  </View>;
}
