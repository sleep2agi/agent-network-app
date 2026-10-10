// 未接通入口的可点击演示。只调用 backend-pending-demo.ts，不读 Hub / Daemon，不写配置。
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { useTranslation } from './i18n-react';
import './i18n-backend-pending';
import './i18n-provider';
import { providerIssueI18nKey, type ProviderFormValue } from './provider-create-options';
import {
  demoProviderSeed,
  simulateEnvSave,
  simulateProviderProbe,
  simulateProviderSave,
  simulateProviderUpsert,
  simulateSecretSave,
  simulateSkillOpen,
  type DemoProviderRow,
  type EnvSaveResult,
  type ProbeResult,
  type ProviderSaveResult,
  type ProviderUpsertResult,
  type SecretSaveResult,
  type SkillOpenResult,
} from './backend-pending-demo';
import { colors, radius, spacing } from './theme';

function inputStyle() {
  return {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.inputBg,
    borderRadius: radius.control,
    paddingHorizontal: spacing.md,
    minHeight: 36,
    color: colors.text,
    fontSize: 14,
  };
}

function DemoBanner() {
  const { t } = useTranslation();
  return (
    <View testID="backend-pending-banner" accessibilityRole="text" style={{ borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.tonalBg, borderRadius: radius.control, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}>
      <Text style={{ color: colors.accent, fontSize: 13, lineHeight: 18, fontWeight: '600' }}>{t('backendPending.banner')}</Text>
    </View>
  );
}

function DemoButton({ testID, label, onPress }: { testID: string; label: string; onPress: () => void }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [{
        alignSelf: 'flex-start',
        minHeight: 44,
        paddingHorizontal: spacing.md,
        borderRadius: radius.control,
        borderWidth: 1,
        borderColor: colors.accent,
        backgroundColor: colors.tonalBg,
        alignItems: 'center',
        justifyContent: 'center',
      }, pressed && { opacity: 0.7 }]}
    >
      <Text style={{ color: colors.accent, fontSize: 14, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

function ResultLine({ testID, ok, text }: { testID: string; ok: boolean; text: string }) {
  return <Text testID={testID} accessibilityLiveRegion="polite" style={{ color: ok ? colors.running : colors.failed, fontSize: 12, lineHeight: 18 }}>{text}</Text>;
}

function saveText(result: ProviderSaveResult, t: (key: string, values?: Record<string, string | number>) => string): { ok: boolean; text: string } {
  if (!result.ok) {
    if (result.issue === 'none') return { ok: false, text: t('backendPending.saveNone') };
    if (result.issue === 'secret') return { ok: false, text: t('backendPending.secretHidden') };
    return { ok: false, text: t(providerIssueI18nKey(result.issue)) };
  }
  const preset = result.preset === 'deepseek' ? t('provider.preset.deepseek') : result.preset === 'minimax' ? t('provider.preset.minimax') : t('provider.preset.custom');
  return { ok: true, text: t('backendPending.saved', { preset, model: result.model }) };
}

function probeText(result: ProbeResult, t: (key: string, values?: Record<string, string | number>) => string): { ok: boolean; text: string } {
  if (!result.ok) {
    if (result.reason === 'secret') return { ok: false, text: t('backendPending.secretHidden') };
    if (result.reason === 'provider') return { ok: false, text: t('backendPending.probeNeedProvider') };
    return { ok: false, text: t('backendPending.probeNeedModel') };
  }
  return { ok: true, text: t('backendPending.probeOk', { provider: result.providerId, model: result.model, ms: result.latencyMs }) };
}

export function ProviderConfigDemo({
  runtimeId,
  value,
  transportOk,
  onClearKey,
}: {
  runtimeId: string;
  value: ProviderFormValue;
  transportOk: boolean;
  onClearKey: () => void;
}) {
  const { t } = useTranslation();
  const [saved, setSaved] = useState<ProviderSaveResult | null>(null);
  const [providerId, setProviderId] = useState(value.choice === 'none' || value.choice === 'custom-openai-compat' ? '' : value.choice);
  const [model, setModel] = useState(value.model);
  const [probed, setProbed] = useState<ProbeResult | null>(null);
  const saveLine = saved ? saveText(saved, t) : null;
  const probeLine = probed ? probeText(probed, t) : null;
  return (
    <View testID="provider-config-demo" style={{ gap: spacing.sm, marginTop: spacing.sm }}>
      <DemoBanner />
      <Text style={{ color: colors.textMuted, fontSize: 12, lineHeight: 18 }}>{t('backendPending.realCreate')}</Text>
      <DemoButton
        testID="provider-demo-save"
        label={t('backendPending.save')}
        onPress={() => {
          const result = simulateProviderSave({
            runtimeId,
            choice: value.choice,
            baseUrl: value.baseUrl,
            model: value.model,
            apiKey: value.apiKey,
          }, transportOk);
          setSaved(result);
          if (result.ok) onClearKey();
        }}
      />
      {saveLine ? <ResultLine testID="provider-demo-save-result" ok={saveLine.ok} text={saveLine.text} /> : null}
      <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>{t('backendPending.section.probe')}</Text>
      <Text style={{ color: colors.textMuted, fontSize: 12 }}>{t('backendPending.probeProvider')}</Text>
      <TextInput
        testID="provider-demo-probe-provider"
        value={providerId}
        onChangeText={setProviderId}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={t('backendPending.probeProvider')}
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={t('backendPending.probeProvider')}
        style={inputStyle()}
      />
      <Text style={{ color: colors.textMuted, fontSize: 12 }}>{t('backendPending.probeModel')}</Text>
      <TextInput
        testID="provider-demo-probe-model"
        value={model}
        onChangeText={setModel}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={t('backendPending.probeModel')}
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={t('backendPending.probeModel')}
        style={inputStyle()}
      />
      <DemoButton
        testID="provider-demo-probe"
        label={t('backendPending.probe')}
        onPress={() => setProbed(simulateProviderProbe({ providerId, model }))}
      />
      {probeLine ? <ResultLine testID="provider-demo-probe-result" ok={probeLine.ok} text={probeLine.text} /> : null}
    </View>
  );
}

function SectionTitle({ title }: { title: string }) {
  return <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>{title}</Text>;
}

export function DaemonPendingDemos() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<DemoProviderRow[]>(() => demoProviderSeed());
  const [id, setId] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [providerResult, setProviderResult] = useState<ProviderUpsertResult | null>(null);
  const [probeProvider, setProbeProvider] = useState('demo-deepseek');
  const [probeModel, setProbeModel] = useState('deepseek-chat');
  const [probed, setProbed] = useState<ProbeResult | null>(null);
  const [skill, setSkill] = useState<SkillOpenResult | null>(null);
  const [secretName, setSecretName] = useState('');
  const [secretValue, setSecretValue] = useState('');
  const [secretResult, setSecretResult] = useState<SecretSaveResult | null>(null);
  const [envKey, setEnvKey] = useState('');
  const [envValue, setEnvValue] = useState('');
  const [envResult, setEnvResult] = useState<EnvSaveResult | null>(null);
  const probeLine = probed ? probeText(probed, t) : null;

  const providerLine = (() => {
    if (!providerResult) return null;
    if (!providerResult.ok) {
      const text = providerResult.reason === 'secret' ? t('backendPending.secretHidden')
        : providerResult.reason === 'id' ? t('backendPending.providerNeedId')
        : providerResult.reason === 'model' ? t('backendPending.providerNeedModel')
        : t('provider.err.base_url_invalid');
      return { ok: false, text };
    }
    return { ok: true, text: t('backendPending.providerAdded', { id: providerResult.id }) };
  })();

  const skillLine = (() => {
    if (!skill) return null;
    if (!skill.ok) return { ok: false, text: t('backendPending.skillMissing') };
    const title = skill.id === 'demo-summarize' ? t('backendPending.skill.summarize.title') : t('backendPending.skill.review.title');
    const body = skill.id === 'demo-summarize' ? t('backendPending.skill.summarize.body') : t('backendPending.skill.review.body');
    return { ok: true, text: `${title}: ${body}` };
  })();

  const secretLine = (() => {
    if (!secretResult) return null;
    if (!secretResult.ok) {
      return { ok: false, text: secretResult.reason === 'name' ? t('backendPending.secretNeedName') : t('backendPending.secretNeedValue') };
    }
    return { ok: true, text: t('backendPending.secretSaved', { name: secretResult.name }) };
  })();

  const envLine = (() => {
    if (!envResult) return null;
    if (!envResult.ok) {
      return { ok: false, text: envResult.reason === 'key' ? t('backendPending.envNeedKey') : t('backendPending.envNeedValue') };
    }
    return { ok: true, text: t('backendPending.envSaved', { key: envResult.key }) };
  })();

  return (
    <View testID="daemon-pending-demos" style={{ gap: spacing.md, paddingTop: spacing.sm }}>
      <DemoBanner />
      <Text style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 18 }}>{t('backendPending.daemonHint')}</Text>

      <View testID="daemon-demo-providers" style={{ gap: spacing.sm }}>
        <SectionTitle title={t('backendPending.section.providers')} />
        <View testID="daemon-demo-provider-list" style={{ gap: spacing.xs }}>
          {rows.map(row => (
            <Text key={row.id} style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 18 }}>{`${row.id} · ${row.model}`}</Text>
          ))}
        </View>
        <TextInput testID="daemon-demo-provider-id" value={id} onChangeText={setId} autoCapitalize="none" autoCorrect={false} placeholder={t('backendPending.providerId')} placeholderTextColor={colors.textMuted} accessibilityLabel={t('backendPending.providerId')} style={inputStyle()} />
        <TextInput testID="daemon-demo-provider-base" value={baseUrl} onChangeText={setBaseUrl} autoCapitalize="none" autoCorrect={false} placeholder={t('backendPending.providerBaseUrl')} placeholderTextColor={colors.textMuted} accessibilityLabel={t('backendPending.providerBaseUrl')} style={inputStyle()} />
        <TextInput testID="daemon-demo-provider-model" value={model} onChangeText={setModel} autoCapitalize="none" autoCorrect={false} placeholder={t('backendPending.providerModel')} placeholderTextColor={colors.textMuted} accessibilityLabel={t('backendPending.providerModel')} style={inputStyle()} />
        <TextInput testID="daemon-demo-provider-key" value={apiKey} onChangeText={setApiKey} secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="password" placeholder={t('backendPending.providerKey')} placeholderTextColor={colors.textMuted} accessibilityLabel={t('backendPending.providerKeyA11y')} style={inputStyle()} />
        <DemoButton
          testID="daemon-demo-provider-save"
          label={t('backendPending.providerAdd')}
          onPress={() => {
            const result = simulateProviderUpsert(rows, { id, baseUrl, model, apiKey });
            setProviderResult(result);
            if (result.ok) { setRows(result.rows); setApiKey(''); }
          }}
        />
        {providerLine ? <ResultLine testID="daemon-demo-provider-result" ok={providerLine.ok} text={providerLine.text} /> : null}
      </View>

      <View testID="daemon-demo-probe" style={{ gap: spacing.sm }}>
        <SectionTitle title={t('backendPending.section.probe')} />
        <TextInput testID="daemon-demo-probe-provider" value={probeProvider} onChangeText={setProbeProvider} autoCapitalize="none" autoCorrect={false} placeholder={t('backendPending.probeProvider')} placeholderTextColor={colors.textMuted} accessibilityLabel={t('backendPending.probeProvider')} style={inputStyle()} />
        <TextInput testID="daemon-demo-probe-model" value={probeModel} onChangeText={setProbeModel} autoCapitalize="none" autoCorrect={false} placeholder={t('backendPending.probeModel')} placeholderTextColor={colors.textMuted} accessibilityLabel={t('backendPending.probeModel')} style={inputStyle()} />
        <DemoButton testID="daemon-demo-probe-run" label={t('backendPending.probe')} onPress={() => setProbed(simulateProviderProbe({ providerId: probeProvider, model: probeModel }))} />
        {probeLine ? <ResultLine testID="daemon-demo-probe-result" ok={probeLine.ok} text={probeLine.text} /> : null}
      </View>

      <View testID="daemon-demo-skills" style={{ gap: spacing.sm }}>
        <SectionTitle title={t('backendPending.section.skills')} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          <DemoButton testID="daemon-demo-skill-summarize" label={t('backendPending.skill.summarize.title')} onPress={() => setSkill(simulateSkillOpen('demo-summarize'))} />
          <DemoButton testID="daemon-demo-skill-review" label={t('backendPending.skill.review.title')} onPress={() => setSkill(simulateSkillOpen('demo-review'))} />
        </View>
        {skillLine ? <ResultLine testID="daemon-demo-skill-result" ok={skillLine.ok} text={skillLine.text} /> : null}
      </View>

      <View testID="daemon-demo-secrets" style={{ gap: spacing.sm }}>
        <SectionTitle title={t('backendPending.section.secrets')} />
        <TextInput testID="daemon-demo-secret-name" value={secretName} onChangeText={setSecretName} autoCapitalize="none" autoCorrect={false} placeholder={t('backendPending.secretName')} placeholderTextColor={colors.textMuted} accessibilityLabel={t('backendPending.secretName')} style={inputStyle()} />
        <TextInput testID="daemon-demo-secret-value" value={secretValue} onChangeText={setSecretValue} secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="password" placeholder={t('backendPending.secretValue')} placeholderTextColor={colors.textMuted} accessibilityLabel={t('backendPending.secretValueA11y')} style={inputStyle()} />
        <DemoButton
          testID="daemon-demo-secret-save"
          label={t('backendPending.secretSave')}
          onPress={() => {
            const result = simulateSecretSave({ name: secretName, value: secretValue });
            setSecretResult(result);
            if (result.ok) setSecretValue('');
          }}
        />
        {secretLine ? <ResultLine testID="daemon-demo-secret-result" ok={secretLine.ok} text={secretLine.text} /> : null}
      </View>

      <View testID="daemon-demo-env" style={{ gap: spacing.sm }}>
        <SectionTitle title={t('backendPending.section.env')} />
        <TextInput testID="daemon-demo-env-key" value={envKey} onChangeText={setEnvKey} autoCapitalize="characters" autoCorrect={false} placeholder={t('backendPending.envKey')} placeholderTextColor={colors.textMuted} accessibilityLabel={t('backendPending.envKey')} style={inputStyle()} />
        <TextInput testID="daemon-demo-env-value" value={envValue} onChangeText={setEnvValue} autoCapitalize="none" autoCorrect={false} placeholder={t('backendPending.envValue')} placeholderTextColor={colors.textMuted} accessibilityLabel={t('backendPending.envValueA11y')} style={inputStyle()} />
        <DemoButton
          testID="daemon-demo-env-save"
          label={t('backendPending.envSave')}
          onPress={() => {
            const result = simulateEnvSave({ key: envKey, value: envValue });
            setEnvResult(result);
            if (result.ok) setEnvValue('');
          }}
        />
        {envLine ? <ResultLine testID="daemon-demo-env-result" ok={envLine.ok} text={envLine.text} /> : null}
      </View>
    </View>
  );
}
