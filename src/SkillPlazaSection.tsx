// Browse-only public content, deliberately rendered as selectable plain text.
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './ui-text';
import { colors, onThemeChange, spacing } from './theme';
import { appFetch } from './app-fetch';
import { SettingsCardContent, SettingsGroup, SettingsRow, SettingsTextField } from './settings-kit';
import type { SettingsHeaderOverride } from './settings-model';
import { useTranslation } from './i18n-react';
import { t } from './i18n';
import './i18n-skill-plaza';
import { filterPublicSkills, isAbortError, loadPublicSkills, loadSkillBody, skillDetailMeta, SkillPlazaError, type PublicSkill, type SkillFetch } from './skill-plaza-model';

type Navigation = { openDetail: () => void; closeDetail: () => void; setHeader: (header: SettingsHeaderOverride | null) => void };
// No Hub config, credentials or authorization headers cross this boundary.
const fetchSkill: SkillFetch = (url, init) => appFetch(url, { signal: init?.signal, credentials: 'omit', redirect: 'error' });
function errorText(error: unknown): string {
  if (isAbortError(error)) return t('skillPlaza.timeout');
  if (error instanceof SkillPlazaError) return t(`skillPlaza.${error.code}`) + (error.status ? ` (HTTP ${error.status})` : '');
  return t('skillPlaza.body');
}

export default function SkillPlazaSection({ layout, navigation, detailOpen }: { layout: 'desktop' | 'phone'; navigation?: Navigation; detailOpen?: boolean }) {
  const { language } = useTranslation();
  const [attempt, setAttempt] = useState(0);
  const [skills, setSkills] = useState<PublicSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<PublicSkill | null>(null);
  const [body, setBody] = useState<string | null>(null);
  const [bodyError, setBodyError] = useState<unknown>(null);
  const [bodyAttempt, setBodyAttempt] = useState(0);
  const nav = useRef(navigation);
  nav.current = navigation;
  const close = () => { setSelected(null); setBody(null); setBodyError(null); nav.current?.closeDetail(); };
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (navigation && detailOpen === false && selected) closeRef.current();
  }, [detailOpen, selected]);

  useEffect(() => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 20_000);
    let live = true;
    setLoading(true); setError(null);
    void loadPublicSkills(fetchSkill, undefined, ac.signal)
      .then(list => { if (live) setSkills(list); })
      .catch(e => { if (live) setError(e); })
      .finally(() => { clearTimeout(timer); if (live) setLoading(false); });
    return () => { live = false; clearTimeout(timer); ac.abort(); };
  }, [attempt]);

  useEffect(() => {
    if (!selected) return;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 20_000);
    let live = true;
    setBody(null); setBodyError(null);
    void loadSkillBody(fetchSkill, selected, ac.signal)
      .then(text => { if (live) setBody(text); })
      .catch(e => { if (live) setBodyError(e); })
      .finally(() => clearTimeout(timer));
    return () => { live = false; clearTimeout(timer); ac.abort(); };
  }, [selected, bodyAttempt]);

  useEffect(() => {
    nav.current?.setHeader(selected ? { title: selected.name, onBack: () => closeRef.current() } : null);
    return () => nav.current?.setHeader(null);
  }, [selected, language]);

  const shown = filterPublicSkills(skills, query);
  const content = selected ? (
    <SettingsGroup footer={skillDetailMeta(selected)} testID="settings-skill-plaza-detail">
      <SettingsRow testID="skill-plaza-back" label={t('skillPlaza.back')} chevron={false} onPress={close} />
      {!bodyError && body === null ? <SettingsRow label={t('skillPlaza.loadingBody')} busy /> : null}
      {bodyError ? <SettingsRow testID="skill-plaza-retry" label={t('skillPlaza.retry')} subtitle={errorText(bodyError)} onPress={() => setBodyAttempt(n => n + 1)} /> : null}
      {body !== null ? <SettingsCardContent><Text testID="skill-plaza-body" selectable style={styles.body}>{body}</Text></SettingsCardContent> : null}
    </SettingsGroup>
  ) : (
    <SettingsGroup footer={t('skillPlaza.note')} testID="settings-skill-plaza">
      {loading ? <SettingsRow label={t('skillPlaza.loading')} busy /> : error ? (
        <SettingsRow testID="skill-plaza-retry" label={t('skillPlaza.retry')} subtitle={errorText(error)} onPress={() => setAttempt(n => n + 1)} />
      ) : <>
        <SettingsTextField testID="skill-plaza-search" accessibilityLabel={t('skillPlaza.search')} placeholder={t('skillPlaza.search')} value={query} onChangeText={setQuery} />
        {query ? <Pressable accessibilityRole="button" accessibilityLabel={t('skillPlaza.clear')} onPress={() => setQuery('')} style={styles.clear}><Text style={styles.clearText}>{t('skillPlaza.clear')}</Text></Pressable> : null}
        {!shown.length ? <SettingsRow label={t(query.trim() ? 'skillPlaza.noMatch' : 'skillPlaza.empty')} /> : null}
        {shown.map(skill => <SettingsRow key={skill.slug} testID={`skill-plaza-row-${skill.slug}`} label={skill.name} subtitle={skill.description || skill.slug}
          value={skill.version || undefined} onPress={() => { setBody(null); setBodyError(null); setSelected(skill); nav.current?.openDetail(); }} />)}
      </>}
    </SettingsGroup>
  );
  return <View style={layout === 'desktop' ? styles.desktop : undefined}>{content}</View>;
}
const makeStyles = () => StyleSheet.create({
  desktop: { maxWidth: 880 },
  body: { color: colors.text, fontSize: 13, lineHeight: 20 },
  clear: { alignSelf: 'flex-start', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  clearText: { color: colors.accent, fontSize: 13 },
});
let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
