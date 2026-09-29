import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';
import { colors, radius, spacing } from './theme';
import { t } from './i18n';
import { useTranslation } from './i18n-react';
import './i18n-task-issues';
import { openExternal } from './open-external';
import type { Requirement } from './requirements-model';
import type { EditPatch } from './task-board-model';
import { issueCount, issueLabel, issueUrl, issuesWire, MAX_REQUIREMENT_ISSUES, parseIssue, type RequirementIssue } from './requirement-issues';

export function TaskIssueCount({ item }: { item: Requirement }) {
 useTranslation();
 const count = issueCount(item);
 return count ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 }} testID={`req-issue-count-${item.id}`} accessibilityLabel={t('issues.count', { count })}>
  <Ionicons name="logo-github" size={13} color={colors.textMuted} /><Text style={{ color: colors.textMuted, fontSize: 11 }}>{count}</Text>
 </View> : null;
}

/** Parent keys this editor by task; it uses the board's scoped write queue, not a second API/cache. */
export default function TaskIssueBindings({ item, onSave }: { item: Requirement; onSave: (patch: EditPatch) => Promise<string | null> }) {
 useTranslation();
 const [editing, setEditing] = useState(false), [input, setInput] = useState('');
 const [error, setError] = useState(''), [saving, setSaving] = useState(false);
 const busy = useRef(false), live = useRef(true);
 useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
 const issues = item.issues ?? [];
 const source = item.externalUrl ? parseIssue(item.externalUrl, false) : null;
 const save = async (next: RequirementIssue[]) => {
  if (busy.current || item.issues === undefined) return;
  busy.current = true; setSaving(true); setError('');
  try {
   const failed = await onSave({ issues: issuesWire(next) });
   if (!live.current) return;
   if (failed) setError(failed === 'invalid_issues' ? 'issues.rejected' : 'issues.failed');
   else { setEditing(false); setInput(''); }
  } catch { if (live.current) setError('issues.failed'); }
  finally { busy.current = false; if (live.current) setSaving(false); }
 };
 const add = () => {
  if (busy.current) return;
  const issue = parseIssue(input);
  if (!issue) { setError('issues.invalid'); return; }
  if (issues.some(i => issueLabel(i) === issueLabel(issue))) { setError('issues.duplicate'); return; }
  if (issues.length >= MAX_REQUIREMENT_ISSUES) { setError('issues.limit'); return; }
  void save([...issues, issue]);
 };
 const open = async (issue: RequirementIssue) => {
  try { if (!await openExternal(issueUrl(issue)) && live.current) setError('issues.openFailed'); }
  catch { if (live.current) setError('issues.openFailed'); }
 };
 const labelStyle = { fontSize: 12, color: colors.textMuted };
 return <View style={{ gap: spacing.sm }} testID="req-issues">
  <Text style={labelStyle}>{t('issues.heading')}</Text>
  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
   {issues.map((issue, index) => <View key={issueLabel(issue)} style={{ flexDirection: 'row', alignItems: 'center', maxWidth: '100%', backgroundColor: colors.subtleFill, borderRadius: radius.control }}>
    <Pressable accessibilityRole="link" accessibilityLabel={issueLabel(issue)} onPress={() => void open(issue)} testID={`req-issue-link-${index}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 10, minHeight: 44, flexShrink: 1 }}>
     <Ionicons name="logo-github" size={14} color={colors.accent} /><Text numberOfLines={1} style={{ color: colors.accent, fontSize: 13, flexShrink: 1 }}>{issueLabel(issue)}</Text>
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={t('issues.remove', { issue: issueLabel(issue) })} disabled={saving} onPress={() => void save(issues.filter((_, i) => i !== index))} testID={`req-issue-remove-${index}`} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: saving ? .45 : 1 }}>
     <Ionicons name="close" size={15} color={colors.textMuted} />
    </Pressable>
   </View>)}
  </View>
  {source ? <View style={{ gap: 4 }} testID="req-issue-source">
   <Text style={labelStyle}>{t('issues.source')}</Text>
   <Pressable accessibilityRole="link" onPress={() => void open(source)} testID="req-issue-source-link" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 }}>
    <Ionicons name="logo-github" size={14} color={colors.textMuted} /><Text numberOfLines={1} style={{ color: colors.accent, flexShrink: 1 }}>{issueLabel(source)}</Text>
   </Pressable>
  </View> : null}
  {item.issues === undefined ? <Text style={labelStyle}>{t('issues.unsupported')}</Text> : editing ? <View style={{ gap: 8 }}>
   <TextInput value={input} onChangeText={v => { setInput(v); setError(''); }} placeholder={t('issues.input')} accessibilityLabel={t('issues.input')} autoCapitalize="none" autoCorrect={false} editable={!saving} onSubmitEditing={add} testID="req-issue-input" style={{ minHeight: 44, borderWidth: 1, borderColor: error ? colors.failed : colors.border, borderRadius: radius.control, paddingHorizontal: 10, color: colors.text, fontSize: 13 }} />
   <View style={{ flexDirection: 'row', gap: 12 }}>
    <Pressable accessibilityRole="button" disabled={saving} onPress={add} testID="req-issue-confirm" style={{ backgroundColor: colors.accent, borderRadius: radius.control, minHeight: 44, paddingHorizontal: 18, justifyContent: 'center', opacity: saving ? .45 : 1 }}><Text style={{ color: colors.onAccent }}>{t('issues.confirm')}</Text></Pressable>
    <Pressable accessibilityRole="button" disabled={saving} onPress={() => { setEditing(false); setError(''); setInput(''); }} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: colors.textMuted }}>{t('issues.cancel')}</Text></Pressable>
   </View>
  </View> : <Pressable accessibilityRole="button" disabled={saving} onPress={() => { setEditing(true); setError(''); }} testID="req-issue-add" style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: colors.accent }}>{t('issues.bind')}</Text></Pressable>}
  <Text style={labelStyle}>{t('issues.hint')}</Text>
  {saving ? <Text style={labelStyle} accessibilityLiveRegion="polite">{t('issues.saving')}</Text> : null}
  {error ? <Text style={{ fontSize: 12, color: colors.failed }} accessibilityRole="alert" testID="req-issue-error">{t(error)}</Text> : null}
 </View>;
}
