// 设置 → 技能广场。公开目录(skill-plaza-model.ts),能搜、能打开 SKILL.md。
// 节点页「技能」是那个节点已经能加载的,不在这里。这里不能安装。
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';
import { colors, onThemeChange, spacing } from './theme';
import { ds } from './ui-scale';
import { appFetch } from './app-fetch';
import { SettingsCardContent, SettingsGroup, SettingsRow, SettingsTextField } from './settings-kit';
import { setSettingsNestedBack } from './settings-model';
import {
  SKILL_CATALOG_URL,
  SKILL_PLAZA_NOTE,
  filterPublicSkills,
  isAbortError,
  loadPublicSkills,
  loadSkillBody,
  skillDetailMeta,
  type PublicSkill,
  type SkillFetch,
} from './skill-plaza-model';

const fetchSkill: SkillFetch = (url, init) => appFetch(url, { signal: init?.signal });

function messageOf(e: unknown, timeout: string): string {
  if (isAbortError(e)) return timeout;
  if (e instanceof Error && e.message) return e.message;
  return '打不开。';
}

function useSkillPlaza() {
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<'loading' | 'error' | 'ready'>('loading');
  const [error, setError] = useState('');
  const [skills, setSkills] = useState<PublicSkill[]>([]);
  const [query, setQuery] = useState('');
  const [openSkill, setOpenSkill] = useState<PublicSkill | null>(null);
  const [bodyPhase, setBodyPhase] = useState<'idle' | 'loading' | 'error' | 'ready'>('idle');
  const [body, setBody] = useState('');
  const [bodyError, setBodyError] = useState('');
  const openRef = useRef<PublicSkill | null>(null);
  const bodyGen = useRef(0);
  const bodyAbort = useRef<AbortController | null>(null);
  const closeRef = useRef<() => void>(() => {});
  openRef.current = openSkill;

  const closeBody = () => {
    bodyGen.current += 1;
    bodyAbort.current?.abort();
    setOpenSkill(null);
    setBodyPhase('idle');
    setBody('');
    setBodyError('');
  };
  closeRef.current = closeBody;

  useEffect(() => {
    setSettingsNestedBack(() => {
      if (!openRef.current) return false;
      closeRef.current();
      return true;
    });
    return () => setSettingsNestedBack(null);
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 20000);
    let dead = false;
    setPhase('loading');
    setError('');
    void loadPublicSkills(fetchSkill, SKILL_CATALOG_URL, ac.signal)
      .then((list) => { if (!dead) { setSkills(list); setPhase('ready'); } })
      .catch((e) => { if (!dead) { setPhase('error'); setError(messageOf(e, '目录超时，请重试。')); } });
    return () => { dead = true; clearTimeout(timer); ac.abort(); };
  }, [attempt]);

  const open = (skill: PublicSkill) => {
    const gen = ++bodyGen.current;
    bodyAbort.current?.abort();
    const ac = new AbortController();
    bodyAbort.current = ac;
    const timer = setTimeout(() => ac.abort(), 20000);
    setOpenSkill(skill);
    setBody('');
    setBodyError('');
    setBodyPhase('loading');
    void loadSkillBody(fetchSkill, skill, ac.signal)
      .then((text) => {
        if (gen !== bodyGen.current) return;
        setBody(text);
        setBodyPhase('ready');
      })
      .catch((e) => {
        if (gen !== bodyGen.current) return;
        setBodyPhase('error');
        setBodyError(messageOf(e, '正文超时，请重试。'));
      })
      .finally(() => clearTimeout(timer));
  };

  return {
    phase,
    error,
    query,
    setQuery,
    shown: filterPublicSkills(skills, query),
    reload: () => { closeBody(); setAttempt((n) => n + 1); },
    openSkill,
    bodyPhase,
    body,
    bodyError,
    open,
    closeBody,
  };
}

type Plaza = ReturnType<typeof useSkillPlaza>;

function PhoneBody({ plaza }: { plaza: Plaza }) {
  const skill = plaza.openSkill;
  if (!skill) return null;
  return (
    <SettingsGroup footer={skillDetailMeta(skill)} testID="settings-skill-plaza-detail">
      <SettingsRow testID="skill-plaza-back" label="返回目录" chevron={false} onPress={plaza.closeBody} />
      {plaza.bodyPhase === 'loading' ? <SettingsRow label="正在读取正文" busy /> : null}
      {plaza.bodyPhase === 'error' ? <SettingsRow testID="skill-plaza-retry" label="重试" subtitle={plaza.bodyError} onPress={() => plaza.open(skill)} /> : null}
      {plaza.bodyPhase === 'ready' ? (
        <SettingsCardContent>
          <Text testID="skill-plaza-body" selectable style={styles.bodyInCard}>{plaza.body}</Text>
        </SettingsCardContent>
      ) : null}
    </SettingsGroup>
  );
}

function PhonePlaza({ plaza }: { plaza: Plaza }) {
  if (plaza.openSkill) return <PhoneBody plaza={plaza} />;
  return (
    <SettingsGroup footer={SKILL_PLAZA_NOTE} testID="settings-skill-plaza">
      {plaza.phase === 'loading' ? <SettingsRow label="正在读取公开目录" busy /> : null}
      {plaza.phase === 'error' ? <SettingsRow testID="skill-plaza-retry" label="重试" subtitle={plaza.error} onPress={plaza.reload} /> : null}
      {plaza.phase === 'ready' ? (
        <SettingsTextField
          testID="skill-plaza-search"
          accessibilityLabel="搜索技能"
          placeholder="搜索技能"
          value={plaza.query}
          onChangeText={plaza.setQuery}
        />
      ) : null}
      {plaza.phase === 'ready' && plaza.shown.length === 0 ? <SettingsRow label={plaza.query.trim() ? '没有匹配的技能' : '目录是空的'} /> : null}
      {plaza.phase === 'ready' ? plaza.shown.map((skill) => (
        <SettingsRow
          key={skill.slug}
          testID={`skill-plaza-row-${skill.slug}`}
          label={skill.name}
          subtitle={skill.description || skill.slug}
          value={skill.version || undefined}
          onPress={() => plaza.open(skill)}
        />
      )) : null}
    </SettingsGroup>
  );
}

function DesktopPlaza({ plaza }: { plaza: Plaza }) {
  if (plaza.openSkill) {
    const skill = plaza.openSkill;
    return (
      <View testID="settings-skill-plaza-detail">
        <Pressable accessibilityRole="button" accessibilityLabel="返回目录" testID="skill-plaza-back" onPress={plaza.closeBody} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
          <Ionicons name="chevron-back" size={16} color={colors.textSecondary} />
          <Text style={styles.name}>返回目录</Text>
        </Pressable>
        <Text style={styles.meta}>{skill.name}</Text>
        <Text style={styles.hint}>{skillDetailMeta(skill)}</Text>
        {plaza.bodyPhase === 'loading' ? <ActivityIndicator color={colors.accent} style={styles.spinner} /> : null}
        {plaza.bodyPhase === 'error' ? (
          <View>
            <Text style={styles.error}>{plaza.bodyError}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="重试" testID="skill-plaza-retry" onPress={() => plaza.open(skill)} style={({ pressed }) => [styles.retry, pressed && styles.pressed]}>
              <Text style={styles.retryText}>重试</Text>
            </Pressable>
          </View>
        ) : null}
        {plaza.bodyPhase === 'ready' ? <Text testID="skill-plaza-body" selectable style={styles.body}>{plaza.body}</Text> : null}
      </View>
    );
  }
  return (
    <View testID="settings-skill-plaza">
      <Text style={styles.hint}>{SKILL_PLAZA_NOTE}</Text>
      {plaza.phase === 'loading' ? <ActivityIndicator color={colors.accent} style={styles.spinner} /> : null}
      {plaza.phase === 'error' ? (
        <View>
          <Text style={styles.error}>{plaza.error}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="重试" testID="skill-plaza-retry" onPress={plaza.reload} style={({ pressed }) => [styles.retry, pressed && styles.pressed]}>
            <Text style={styles.retryText}>重试</Text>
          </Pressable>
        </View>
      ) : null}
      {plaza.phase === 'ready' ? (
        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={15} color={colors.textMuted} />
          <TextInput
            testID="skill-plaza-search"
            accessibilityLabel="搜索技能"
            value={plaza.query}
            onChangeText={plaza.setQuery}
            placeholder="搜索技能"
            placeholderTextColor={colors.textMuted}
            style={styles.searchInput}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {plaza.query ? (
            <Pressable accessibilityLabel="清除搜索" onPress={() => plaza.setQuery('')} hitSlop={6}>
              <Ionicons name="close-circle" size={15} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {plaza.phase === 'ready' && plaza.shown.length === 0 ? <Text style={styles.hint}>{plaza.query.trim() ? '没有匹配的技能' : '目录是空的'}</Text> : null}
      {plaza.phase === 'ready' ? plaza.shown.map((skill, i) => (
        <View key={skill.slug}>
          {i ? <View style={styles.divider} /> : null}
          <Pressable
            testID={`skill-plaza-row-${skill.slug}`}
            accessibilityRole="button"
            accessibilityLabel={skill.name}
            onPress={() => plaza.open(skill)}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <View style={styles.rowCopy}>
              <Text style={styles.name} numberOfLines={1}>{skill.name}</Text>
              {skill.description ? <Text style={styles.desc} numberOfLines={2}>{skill.description}</Text> : null}
            </View>
            <View style={styles.valueBox}>
              {skill.version ? <Text style={styles.version}>{skill.version}</Text> : null}
              <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} />
            </View>
          </Pressable>
        </View>
      )) : null}
    </View>
  );
}

export default function SkillPlazaSection({ layout }: { layout: 'desktop' | 'phone' }) {
  const plaza = useSkillPlaza();
  return layout === 'phone' ? <PhonePlaza plaza={plaza} /> : <DesktopPlaza plaza={plaza} />;
}

const makeStyles = () => StyleSheet.create({
  hint: { color: colors.textMuted, fontSize: 12, lineHeight: 18, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  meta: { color: colors.text, fontSize: 16, fontWeight: '600', paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  error: { color: colors.failed, fontSize: 12, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  spinner: { alignSelf: 'flex-start', marginHorizontal: spacing.md, marginVertical: spacing.md },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.inputBg,
    paddingHorizontal: spacing.md,
    minHeight: ds(36),
    marginBottom: spacing.sm,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 13, padding: 0, outlineStyle: 'none' } as any,
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md + 2,
  },
  pressed: { opacity: 0.6 },
  rowCopy: { flex: 1, minWidth: 0, gap: 3 },
  name: { color: colors.text, fontSize: 14 },
  desc: { color: colors.textMuted, fontSize: 12 },
  valueBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexShrink: 0 },
  version: { color: colors.textSecondary, fontSize: 14 },
  divider: { height: 1, backgroundColor: colors.border, marginLeft: spacing.md },
  retry: {
    alignSelf: 'flex-start',
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  retryText: { color: colors.text, fontSize: 13 },
  body: { color: colors.text, fontSize: 13, lineHeight: 20, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  bodyInCard: { color: colors.text, fontSize: 13, lineHeight: 20 },
});

let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
