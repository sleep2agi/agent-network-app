// 服务器管理侧栏里的 Hub 页：SKILLS、令牌、环境变量、Provider。
// 版式跟服务器概览同一套（深色地面、卡片、状态点），不是守护进程页那叠演示表单。
// 数据来自 hub-scope-demo.ts，不读 Hub。
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';
import { useTranslation } from './i18n-react';
import './i18n-hub-scope';
import './i18n-backend-pending';
import {
  hubEnvSeed,
  hubProviderSeed,
  hubSkillSeed,
  hubTokenSeed,
  openHubSkill,
  probeHubProvider,
  saveHubEnv,
  saveHubProvider,
  saveHubToken,
  toggleHubSkill,
  type HubEnvVar,
  type HubProvider,
  type HubSection,
  type HubSkill,
  type HubToken,
} from './hub-scope-demo';
import { colors, onThemeChange, radius, spacing, type, weight } from './theme';
import { elevated, buttonStyle, buttonTextStyle } from './elevation';

const WIDE_MIN = 760;

const PROTOCOL_LABEL = {
  'anthropic-messages': 'backendPending.protocol.anthropic',
  'openai-chat-completions': 'backendPending.protocol.chat',
  'openai-responses': 'backendPending.protocol.responses',
} as const;

const SECTION_ICON: Record<HubSection, keyof typeof Ionicons.glyphMap> = {
  skills: 'sparkles-outline',
  tokens: 'key-outline',
  env: 'options-outline',
  providers: 'cloud-outline',
};

type Notice = { ok: boolean; text: string };

export default function HubScopeScreen({ section }: { section: HubSection }) {
  const { t } = useTranslation();
  const [width, setWidth] = useState(0);
  const [skills, setSkills] = useState<HubSkill[]>(() => hubSkillSeed());
  const [tokens, setTokens] = useState<HubToken[]>(() => hubTokenSeed());
  const [envs, setEnvs] = useState<HubEnvVar[]>(() => hubEnvSeed());
  const [providers, setProviders] = useState<HubProvider[]>(() => hubProviderSeed());
  const [selected, setSelected] = useState<string | null>(() => initialId(section));
  const [notice, setNotice] = useState<Notice | null>(null);
  const [tokenName, setTokenName] = useState('');
  const [tokenValue, setTokenValue] = useState('');
  const [envKey, setEnvKey] = useState('');
  const [envValue, setEnvValue] = useState('');
  const [providerId, setProviderId] = useState('');
  const [providerBase, setProviderBase] = useState('');
  const [providerModel, setProviderModel] = useState('');
  const [providerKey, setProviderKey] = useState('');

  const wide = width >= WIDE_MIN;
  const titleKey = `hubScope.${section}.title` as const;
  const subtitleKey = `hubScope.${section}.subtitle` as const;
  const scopeKey = `hubScope.${section}.scope` as const;
  const rows = rowsFor(section, skills, tokens, envs, providers, t);
  const stats = statsFor(section, skills, tokens, envs, providers, t);
  const openedSkill = section === 'skills' && selected ? openHubSkill(skills, selected) : null;
  const token = section === 'tokens' ? tokens.find(row => row.name === selected) ?? null : null;
  const env = section === 'env' ? envs.find(row => row.key === selected) ?? null : null;
  const provider = section === 'providers' ? providers.find(row => row.id === selected) ?? null : null;

  const onToggleSkill = () => {
    if (!selected) return;
    const result = toggleHubSkill(skills, selected);
    if (!result.ok) {
      setNotice({ ok: false, text: t('hubScope.skill.missing') });
      return;
    }
    setSkills(result.rows);
    setNotice({ ok: true, text: t(result.enabled ? 'hubScope.skill.turnedOn' : 'hubScope.skill.turnedOff') });
  };

  const onSaveToken = () => {
    const result = saveHubToken(tokens, { name: tokenName, value: tokenValue });
    if (!result.ok) {
      setNotice({ ok: false, text: tokenFailure(result.reason, t) });
      return;
    }
    setTokens(result.rows);
    setSelected(result.name);
    setTokenName('');
    setTokenValue('');
    setNotice({ ok: true, text: t('hubScope.token.saved', { name: result.name }) });
  };

  const onSaveEnv = () => {
    const result = saveHubEnv(envs, { key: envKey, value: envValue });
    if (!result.ok) {
      setNotice({ ok: false, text: envFailure(result.reason, t) });
      return;
    }
    setEnvs(result.rows);
    setSelected(result.key);
    setEnvKey('');
    setEnvValue('');
    setNotice({ ok: true, text: t('hubScope.env.saved', { key: result.key }) });
  };

  const onSaveProvider = () => {
    const result = saveHubProvider(providers, { id: providerId, baseUrl: providerBase, model: providerModel, apiKey: providerKey });
    if (!result.ok) {
      setNotice({ ok: false, text: providerFailure(result.reason, t) });
      return;
    }
    setProviders(result.rows);
    setSelected(result.id);
    setProviderId('');
    setProviderBase('');
    setProviderModel('');
    setProviderKey('');
    setNotice({ ok: true, text: t('hubScope.provider.saved', { id: result.id }) });
  };

  const onProbe = () => {
    if (!provider) return;
    const result = probeHubProvider({ providerId: provider.id, model: provider.model, protocol: provider.protocol });
    if (!result.ok) {
      const text = result.reason === 'secret' ? t('backendPending.secretHidden')
        : result.reason === 'provider' ? t('backendPending.probeNeedProvider')
        : t('backendPending.probeNeedModel');
      setNotice({ ok: false, text });
      return;
    }
    setNotice({ ok: true, text: t('backendPending.probeOk', { provider: result.providerId, model: result.model, protocol: t(PROTOCOL_LABEL[result.protocol]), ms: result.latencyMs }) });
  };

  const list = (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{t('hubScope.list')}</Text>
        <Text style={styles.sectionMeta}>{rows.length}</Text>
      </View>
      <View style={styles.panel} testID="hub-scope-list">
        {rows.map((row, index) => {
          const on = selected === row.id;
          return (
            <Pressable
              key={row.id}
              testID={`hub-scope-row-${row.id}`}
              accessibilityRole="button"
              accessibilityLabel={`${row.title}, ${row.subtitle}, ${row.status}`}
              accessibilityState={{ selected: on }}
              onPress={() => { setSelected(row.id); setNotice(null); }}
              style={({ pressed }) => [styles.row, index > 0 && styles.rowBorder, on && styles.rowOn, pressed && styles.pressed]}
            >
              <View style={styles.rowIcon}>
                <Ionicons name={SECTION_ICON[section]} size={16} color={on ? colors.accent : colors.textSecondary} />
              </View>
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle} numberOfLines={1}>{row.title}</Text>
                <Text style={styles.rowSub} numberOfLines={1}>{row.subtitle}</Text>
              </View>
              <View style={styles.statusPill}>
                <View style={[styles.statusDot, { backgroundColor: row.on ? colors.running : colors.textMuted }]} />
                <Text style={styles.statusText}>{row.status}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      {section === 'skills' ? <Text style={styles.caption}>{t('hubScope.skill.catalog')}</Text> : null}
    </View>
  );

  const detail = (
    <View style={styles.section} testID="hub-scope-detail">
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{t('hubScope.detail')}</Text>
      </View>
      <View style={styles.panel}>
        {section === 'skills' && openedSkill?.ok ? (
          <>
            <Text style={styles.detailTitle}>{t(openedSkill.titleKey)}</Text>
            <Text style={styles.detailBody}>{t(openedSkill.bodyKey)}</Text>
            <Fact label={t('hubScope.scopeLabel')} value={t('hubScope.scopeValue')} />
            <Fact label={t('hubScope.field.status')} value={t(openedSkill.enabled ? 'hubScope.status.enabled' : 'hubScope.status.disabled')} last />
            <View style={styles.actionRow}>
              <Pressable testID="hub-skill-toggle" accessibilityRole="button" accessibilityLabel={t(openedSkill.enabled ? 'hubScope.skill.disable' : 'hubScope.skill.enable')} onPress={onToggleSkill} style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}>
                <Text style={styles.primaryBtnText}>{t(openedSkill.enabled ? 'hubScope.skill.disable' : 'hubScope.skill.enable')}</Text>
              </Pressable>
            </View>
          </>
        ) : null}
        {section === 'skills' && openedSkill && !openedSkill.ok ? <Text style={styles.detailBody}>{t('hubScope.skill.missing')}</Text> : null}
        {token ? (
          <>
            <Text style={styles.detailTitle}>{token.name}</Text>
            <Fact label={t('hubScope.field.use')} value={t(token.hintKey)} />
            <Fact label={t('hubScope.scopeLabel')} value={t('hubScope.scopeValue')} />
            <Fact label={t('hubScope.field.value')} value={t('hubScope.valueHidden')} last />
          </>
        ) : null}
        {env ? (
          <>
            <Text style={styles.detailTitle}>{env.key}</Text>
            <Fact label={t('hubScope.scopeLabel')} value={t('hubScope.scopeValue')} />
            <Fact label={t('hubScope.field.value')} value={t('hubScope.valueHidden')} last />
          </>
        ) : null}
        {provider ? (
          <>
            <Text style={styles.detailTitle}>{provider.id}</Text>
            <Fact label={t('hubScope.field.baseUrl')} value={provider.baseUrl} mono />
            <Fact label={t('hubScope.field.model')} value={provider.model} mono />
            <Fact label={t('hubScope.scopeLabel')} value={t('hubScope.scopeValue')} />
            <Fact label={t('hubScope.field.credential')} value={t(provider.credential === 'entered' ? 'hubScope.status.entered' : 'hubScope.status.none')} last />
            <View style={styles.actionRow}>
              <Pressable testID="hub-provider-probe" accessibilityRole="button" accessibilityLabel={t('hubScope.provider.probe')} onPress={onProbe} style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}>
                <Text style={styles.primaryBtnText}>{t('hubScope.provider.probe')}</Text>
              </Pressable>
            </View>
          </>
        ) : null}
      </View>
    </View>
  );

  const form = section === 'tokens' ? (
    <FormCard title={t('hubScope.token.add')} saveLabel={t('hubScope.token.save')} testID="hub-token-save" onSave={onSaveToken}>
      <LabeledInput testID="hub-token-name" label={t('hubScope.token.name')} value={tokenName} onChangeText={setTokenName} />
      <LabeledInput testID="hub-token-value" label={t('hubScope.token.value')} a11y={t('hubScope.token.valueA11y')} value={tokenValue} onChangeText={setTokenValue} secure />
    </FormCard>
  ) : section === 'env' ? (
    <FormCard title={t('hubScope.env.add')} saveLabel={t('hubScope.env.save')} testID="hub-env-save" onSave={onSaveEnv}>
      <LabeledInput testID="hub-env-key" label={t('hubScope.env.key')} value={envKey} onChangeText={setEnvKey} autoCapitalize="characters" />
      <LabeledInput testID="hub-env-value" label={t('hubScope.env.value')} a11y={t('hubScope.env.valueA11y')} value={envValue} onChangeText={setEnvValue} />
    </FormCard>
  ) : section === 'providers' ? (
    <FormCard title={t('hubScope.provider.add')} saveLabel={t('hubScope.provider.save')} testID="hub-provider-save" onSave={onSaveProvider}>
      <LabeledInput testID="hub-provider-id" label={t('hubScope.provider.id')} value={providerId} onChangeText={setProviderId} />
      <LabeledInput testID="hub-provider-base" label={t('hubScope.provider.baseUrl')} value={providerBase} onChangeText={setProviderBase} />
      <LabeledInput testID="hub-provider-model" label={t('hubScope.provider.model')} value={providerModel} onChangeText={setProviderModel} />
      <LabeledInput testID="hub-provider-key" label={t('hubScope.provider.key')} a11y={t('hubScope.provider.keyA11y')} value={providerKey} onChangeText={setProviderKey} secure />
    </FormCard>
  ) : null;

  const side = (
    <View style={wide ? styles.colSide : undefined}>
      {detail}
      {form}
      {notice ? <Text testID="hub-scope-notice" accessibilityLiveRegion="polite" style={[styles.notice, { color: notice.ok ? colors.running : colors.failed }]}>{notice.text}</Text> : null}
    </View>
  );

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, wide && styles.contentWide]}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      keyboardShouldPersistTaps="handled"
      testID={`hub-scope-${section}`}
    >
      <View style={styles.header}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title}>{t(titleKey)}</Text>
          <Text style={styles.subtitle} numberOfLines={1}>{t(subtitleKey)}</Text>
        </View>
        <View style={styles.hubPill} testID="hub-scope-kicker">
          <View style={[styles.statusDot, { backgroundColor: colors.accent }]} />
          <Text style={styles.hubPillText}>{t('hubScope.scopeValue')}</Text>
        </View>
      </View>
      <View testID="hub-scope-banner" accessibilityRole="text" style={styles.banner}>
        <Text style={styles.bannerText}>{t('backendPending.banner')}</Text>
      </View>
      <Text style={styles.scope}>{t(scopeKey)}</Text>
      <View style={styles.cardGrid}>
        {stats.map(card => (
          <View key={card.label} style={[styles.statCard, wide ? styles.statWide : styles.statNarrow]} testID={`hub-scope-stat-${card.id}`}>
            <Text style={styles.statLabel}>{card.label}</Text>
            <Text style={styles.statValue}>{card.value}</Text>
          </View>
        ))}
      </View>
      {wide ? (
        <View style={styles.columns}>
          <View style={styles.colMain}>{list}</View>
          {side}
        </View>
      ) : (
        <View>
          {list}
          {side}
        </View>
      )}
    </ScrollView>
  );
}

function initialId(section: HubSection): string {
  if (section === 'skills') return hubSkillSeed()[0].id;
  if (section === 'tokens') return hubTokenSeed()[0].name;
  if (section === 'env') return hubEnvSeed()[0].key;
  return hubProviderSeed()[0].id;
}

type RowView = { id: string; title: string; subtitle: string; status: string; on: boolean };

function rowsFor(
  section: HubSection,
  skills: readonly HubSkill[],
  tokens: readonly HubToken[],
  envs: readonly HubEnvVar[],
  providers: readonly HubProvider[],
  t: (key: string, values?: Record<string, string | number>) => string,
): RowView[] {
  if (section === 'skills') {
    return skills.map(row => ({
      id: row.id,
      title: t(row.titleKey),
      subtitle: t(row.summaryKey),
      status: t(row.enabled ? 'hubScope.status.enabled' : 'hubScope.status.disabled'),
      on: row.enabled,
    }));
  }
  if (section === 'tokens') {
    return tokens.map(row => ({ id: row.name, title: row.name, subtitle: t(row.hintKey), status: t('hubScope.status.set'), on: true }));
  }
  if (section === 'env') {
    return envs.map(row => ({ id: row.key, title: row.key, subtitle: t('hubScope.scopeValue'), status: t('hubScope.status.set'), on: true }));
  }
  return providers.map(row => ({
    id: row.id,
    title: row.id,
    subtitle: row.model,
    status: t(row.credential === 'entered' ? 'hubScope.status.entered' : 'hubScope.status.none'),
    on: row.credential === 'entered',
  }));
}

function statsFor(
  section: HubSection,
  skills: readonly HubSkill[],
  tokens: readonly HubToken[],
  envs: readonly HubEnvVar[],
  providers: readonly HubProvider[],
  t: (key: string) => string,
): Array<{ id: string; label: string; value: number }> {
  if (section === 'skills') {
    const enabled = skills.filter(row => row.enabled).length;
    return [
      { id: 'total', label: t('hubScope.stat.total'), value: skills.length },
      { id: 'enabled', label: t('hubScope.stat.enabled'), value: enabled },
      { id: 'disabled', label: t('hubScope.stat.disabled'), value: skills.length - enabled },
    ];
  }
  if (section === 'tokens') {
    return [
      { id: 'total', label: t('hubScope.stat.total'), value: tokens.length },
      { id: 'set', label: t('hubScope.stat.set'), value: tokens.length },
    ];
  }
  if (section === 'env') {
    return [
      { id: 'total', label: t('hubScope.stat.total'), value: envs.length },
      { id: 'set', label: t('hubScope.stat.set'), value: envs.length },
    ];
  }
  const entered = providers.filter(row => row.credential === 'entered').length;
  return [
    { id: 'total', label: t('hubScope.stat.total'), value: providers.length },
    { id: 'credential', label: t('hubScope.stat.credential'), value: entered },
    { id: 'none', label: t('hubScope.stat.noCredential'), value: providers.length - entered },
  ];
}

function tokenFailure(reason: 'name' | 'value' | 'duplicate' | 'hidden', t: (key: string) => string): string {
  if (reason === 'duplicate') return t('hubScope.token.duplicate');
  if (reason === 'name') return t('backendPending.secretNeedName');
  if (reason === 'hidden') return t('backendPending.secretHidden');
  return t('backendPending.secretNeedValue');
}

function envFailure(reason: 'key' | 'value' | 'duplicate' | 'hidden', t: (key: string) => string): string {
  if (reason === 'duplicate') return t('hubScope.env.duplicate');
  if (reason === 'key') return t('backendPending.envNeedKey');
  if (reason === 'hidden') return t('backendPending.secretHidden');
  return t('backendPending.envNeedValue');
}

function providerFailure(reason: 'id' | 'base_url' | 'model' | 'secret' | 'hidden', t: (key: string) => string): string {
  if (reason === 'id') return t('backendPending.providerNeedId');
  if (reason === 'base_url') return t('hubScope.provider.needBase');
  if (reason === 'model') return t('backendPending.providerNeedModel');
  return t('backendPending.secretHidden');
}

function Fact({ label, value, last, mono }: { label: string; value: string; last?: boolean; mono?: boolean }) {
  return (
    <View style={[styles.field, !last && styles.fieldBorder]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={[styles.fieldValue, mono && styles.mono]} numberOfLines={2}>{value}</Text>
    </View>
  );
}

function LabeledInput({
  testID, label, a11y, value, onChangeText, secure, autoCapitalize = 'none',
}: {
  testID: string;
  label: string;
  a11y?: string;
  value: string;
  onChangeText: (value: string) => void;
  secure?: boolean;
  autoCapitalize?: 'none' | 'characters';
}) {
  return (
    <View style={styles.inputBlock}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={!!secure}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        textContentType={secure ? 'password' : 'none'}
        placeholder={label}
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={a11y ?? label}
        style={styles.input}
      />
    </View>
  );
}

function FormCard({ title, saveLabel, testID, onSave, children }: {
  title: string;
  saveLabel: string;
  testID: string;
  onSave: () => void;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      <View style={styles.panel}>
        <View style={styles.formBody}>
          {children}
          <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={saveLabel} onPress={onSave} style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}>
            <Text style={styles.primaryBtnText}>{saveLabel}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const makeStyles = () =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    content: { padding: spacing.lg, paddingBottom: spacing.xl, width: '100%', maxWidth: 720, alignSelf: 'center' },
    contentWide: { maxWidth: 1180, paddingHorizontal: spacing.xl, paddingTop: spacing.xl },
    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
    title: { color: colors.text, fontSize: type.heading, fontWeight: weight.strong },
    subtitle: { color: colors.textMuted, fontSize: type.small, marginTop: 2 },
    hubPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, height: 28, borderRadius: radius.pill, backgroundColor: colors.subtleFill },
    hubPillText: { color: colors.text, fontSize: type.small, fontWeight: weight.medium },
    banner: { borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.tonalBg, borderRadius: radius.control, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginBottom: spacing.md },
    bannerText: { color: colors.accent, fontSize: type.body, lineHeight: 20, fontWeight: weight.strong },
    scope: { color: colors.textSecondary, fontSize: type.body, lineHeight: 22, marginBottom: spacing.lg },
    cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
    statCard: { backgroundColor: colors.card, borderRadius: radius.surface, paddingHorizontal: spacing.md, paddingVertical: spacing.md, minHeight: 84, justifyContent: 'space-between', ...elevated('raised') },
    statNarrow: { flexBasis: '48%', flexGrow: 1 },
    statWide: { flexBasis: 0, flexGrow: 1, minWidth: 120 },
    statLabel: { color: colors.textSecondary, fontSize: type.small },
    statValue: { color: colors.text, fontSize: 28, fontWeight: weight.strong, fontVariant: ['tabular-nums'], marginTop: spacing.sm },
    columns: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xl },
    colMain: { flex: 3, minWidth: 0 },
    colSide: { flex: 2, minWidth: 0 },
    section: { marginBottom: spacing.lg },
    sectionHead: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, marginBottom: spacing.sm },
    sectionTitle: { color: colors.textSecondary, fontSize: type.small, fontWeight: weight.medium },
    sectionMeta: { color: colors.textMuted, fontSize: type.caption, marginLeft: 'auto', fontVariant: ['tabular-nums'] },
    panel: { backgroundColor: colors.card, borderRadius: radius.surface, overflow: 'hidden', ...elevated('raised') },
    caption: { color: colors.textMuted, fontSize: type.small, lineHeight: 18, marginTop: spacing.sm },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, minHeight: 58, paddingVertical: spacing.sm },
    rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    rowOn: { backgroundColor: colors.rowActive },
    pressed: { opacity: 0.7 },
    rowIcon: { width: 30, height: 30, borderRadius: radius.item, backgroundColor: colors.subtleFill, alignItems: 'center', justifyContent: 'center' },
    rowBody: { flex: 1, minWidth: 0 },
    rowTitle: { color: colors.text, fontSize: type.body, fontWeight: weight.medium },
    rowSub: { color: colors.textMuted, fontSize: type.small, marginTop: 2 },
    statusPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, height: 22, borderRadius: radius.pill, backgroundColor: colors.subtleFill },
    statusDot: { width: 7, height: 7, borderRadius: radius.pill },
    statusText: { color: colors.textSecondary, fontSize: type.caption, fontWeight: weight.medium },
    detailTitle: { color: colors.text, fontSize: type.title, fontWeight: weight.strong, paddingHorizontal: spacing.md, paddingTop: spacing.md },
    detailBody: { color: colors.text, fontSize: type.body, lineHeight: 22, paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.sm },
    field: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, minHeight: 40 },
    fieldBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    fieldLabel: { color: colors.textSecondary, fontSize: type.body, width: 88 },
    fieldValue: { flex: 1, color: colors.text, fontSize: type.body, textAlign: 'right' },
    mono: { fontFamily: 'monospace', fontSize: type.small },
    actionRow: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, paddingTop: spacing.sm },
    formBody: { padding: spacing.md, gap: spacing.sm },
    inputBlock: { gap: 4 },
    inputLabel: { color: colors.textSecondary, fontSize: type.small },
    input: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.inputBg, borderRadius: radius.control, paddingHorizontal: spacing.md, minHeight: 36, color: colors.text, fontSize: type.body },
    primaryBtn: { ...buttonStyle('primary'), alignSelf: 'flex-start', paddingHorizontal: spacing.lg },
    primaryBtnText: { ...buttonTextStyle('primary') },
    notice: { fontSize: type.small, lineHeight: 18, marginTop: -spacing.sm },
  });

let styles = makeStyles();
onThemeChange(() => {
  styles = makeStyles();
});
