// 未接通入口的可点击演示。只调用 backend-pending-demo.ts，不读 Hub / Daemon，不写配置。
import { useState, type ReactNode } from 'react';
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
import {
  PendingCardTitle,
  PendingDemoBanner,
  PendingFieldLabel,
  PendingIntegrationFrame,
  PendingPanelCard,
  PendingSegmentedTabs,
  pendingFieldStyle,
  type PendingLayer,
  type PendingTab,
} from './backend-pending-ui';
import { buttonStyle, buttonTextStyle } from './elevation';
import { colors, radius, spacing, weight } from './theme';

const LAYER_HINT: Record<PendingLayer, string> = {
  hub: 'backendPending.hubHint',
  daemon: 'backendPending.daemonHint',
  node: 'backendPending.nodeHint',
};

function DemoButton({ testID, label, onPress, primary }: { testID: string; label: string; onPress: () => void; primary?: boolean }) {
  const kind = primary ? 'primary' : 'secondary';
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [buttonStyle(kind), { alignSelf: 'flex-start' }, pressed && { opacity: 0.85 }]}
    >
      <Text style={buttonTextStyle(kind)}>{label}</Text>
    </Pressable>
  );
}

function ResultLine({ testID, ok, text }: { testID: string; ok: boolean; text: string }) {
  return <Text testID={testID} accessibilityLiveRegion="polite" style={{ color: ok ? colors.running : colors.failed, fontSize: 12, lineHeight: 18 }}>{text}</Text>;
}

function SkillChip({ testID, label, onPress }: { testID: string; label: string; onPress: () => void }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [buttonStyle('secondary'), pressed && { opacity: 0.85 }]}
    >
      <Text style={buttonTextStyle('secondary')}>{label}</Text>
    </Pressable>
  );
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
  const inputStyle = pendingFieldStyle();
  return (
    <View testID="provider-config-demo" style={{ gap: spacing.md }}>
      <PendingDemoBanner t={t} />
      <Text style={{ color: colors.textMuted, fontSize: 12, lineHeight: 18 }}>{t('backendPending.realCreate')}</Text>
      <DemoButton
        testID="provider-demo-save"
        label={t('backendPending.save')}
        primary
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
      <PendingPanelCard testID="provider-config-probe-card">
        <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>{t('backendPending.section.probe')}</Text>
        <PendingFieldLabel>{t('backendPending.probeProvider')}</PendingFieldLabel>
        <TextInput
          testID="provider-demo-probe-provider"
          value={providerId}
          onChangeText={setProviderId}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={t('backendPending.probeProvider')}
          placeholderTextColor={colors.textMuted}
          accessibilityLabel={t('backendPending.probeProvider')}
          style={inputStyle}
        />
        <PendingFieldLabel>{t('backendPending.probeModel')}</PendingFieldLabel>
        <TextInput
          testID="provider-demo-probe-model"
          value={model}
          onChangeText={setModel}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={t('backendPending.probeModel')}
          placeholderTextColor={colors.textMuted}
          accessibilityLabel={t('backendPending.probeModel')}
          style={inputStyle}
        />
        <DemoButton
          testID="provider-demo-probe"
          label={t('backendPending.probe')}
          onPress={() => setProbed(simulateProviderProbe({ providerId, model }))}
        />
        {probeLine ? <ResultLine testID="provider-demo-probe-result" ok={probeLine.ok} text={probeLine.text} /> : null}
      </PendingPanelCard>
    </View>
  );
}

function usePendingProviderState() {
  const [rows, setRows] = useState<DemoProviderRow[]>(() => demoProviderSeed());
  const [id, setId] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [providerResult, setProviderResult] = useState<ProviderUpsertResult | null>(null);
  const [probeProvider, setProbeProvider] = useState('demo-deepseek');
  const [probeModel, setProbeModel] = useState('deepseek-chat');
  const [probed, setProbed] = useState<ProbeResult | null>(null);
  return {
    rows, setRows, id, setId, baseUrl, setBaseUrl, model, setModel, apiKey, setApiKey,
    providerResult, setProviderResult, probeProvider, setProbeProvider, probeModel, setProbeModel, probed, setProbed,
  };
}

function usePendingSkillsState() {
  const [skill, setSkill] = useState<SkillOpenResult | null>(null);
  return { skill, setSkill };
}

function usePendingTokensState() {
  const [secretName, setSecretName] = useState('');
  const [secretValue, setSecretValue] = useState('');
  const [secretResult, setSecretResult] = useState<SecretSaveResult | null>(null);
  const [envKey, setEnvKey] = useState('');
  const [envValue, setEnvValue] = useState('');
  const [envResult, setEnvResult] = useState<EnvSaveResult | null>(null);
  return {
    secretName, setSecretName, secretValue, setSecretValue, secretResult, setSecretResult,
    envKey, setEnvKey, envValue, setEnvValue, envResult, setEnvResult,
  };
}

function ProviderPendingPanel({ testIDPrefix, state }: { testIDPrefix: string; state: ReturnType<typeof usePendingProviderState> }) {
  const { t } = useTranslation();
  const inputStyle = pendingFieldStyle();
  const probeLine = state.probed ? probeText(state.probed, t) : null;
  const providerLine = (() => {
    if (!state.providerResult) return null;
    if (!state.providerResult.ok) {
      const text = state.providerResult.reason === 'secret' ? t('backendPending.secretHidden')
        : state.providerResult.reason === 'id' ? t('backendPending.providerNeedId')
        : state.providerResult.reason === 'model' ? t('backendPending.providerNeedModel')
        : t('provider.err.base_url_invalid');
      return { ok: false, text };
    }
    return { ok: true, text: t('backendPending.providerAdded', { id: state.providerResult.id }) };
  })();

  return (
    <View testID={`${testIDPrefix}-provider`} style={{ gap: spacing.md }}>
      <PendingPanelCard testID={`${testIDPrefix}-provider-catalog`}>
        <PendingCardTitle title={t('backendPending.section.providers')} subtitle={t('backendPending.providerCatalogHint')} />
        <View testID={`${testIDPrefix}-provider-list`} style={{ gap: spacing.xs }}>
          {state.rows.map(row => (
            <Text key={row.id} style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 20 }}>{`${row.id} · ${row.model}`}</Text>
          ))}
        </View>
        <PendingFieldLabel>{t('backendPending.providerId')}</PendingFieldLabel>
        <TextInput testID={`${testIDPrefix}-provider-id`} value={state.id} onChangeText={state.setId} autoCapitalize="none" autoCorrect={false} placeholder={t('backendPending.providerId')} placeholderTextColor={colors.textMuted} accessibilityLabel={t('backendPending.providerId')} style={inputStyle} />
        <PendingFieldLabel>{t('backendPending.providerBaseUrl')}</PendingFieldLabel>
        <TextInput testID={`${testIDPrefix}-provider-base`} value={state.baseUrl} onChangeText={state.setBaseUrl} autoCapitalize="none" autoCorrect={false} placeholder={t('backendPending.providerBaseUrl')} placeholderTextColor={colors.textMuted} accessibilityLabel={t('backendPending.providerBaseUrl')} style={inputStyle} />
        <PendingFieldLabel>{t('backendPending.providerModel')}</PendingFieldLabel>
        <TextInput testID={`${testIDPrefix}-provider-model`} value={state.model} onChangeText={state.setModel} autoCapitalize="none" autoCorrect={false} placeholder={t('backendPending.providerModel')} placeholderTextColor={colors.textMuted} accessibilityLabel={t('backendPending.providerModel')} style={inputStyle} />
        <PendingFieldLabel>{t('backendPending.providerKey')}</PendingFieldLabel>
        <TextInput testID={`${testIDPrefix}-provider-key`} value={state.apiKey} onChangeText={state.setApiKey} secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="password" placeholder={t('backendPending.providerKey')} placeholderTextColor={colors.textMuted} accessibilityLabel={t('backendPending.providerKeyA11y')} style={inputStyle} />
        <DemoButton
          testID={`${testIDPrefix}-provider-save`}
          label={t('backendPending.providerAdd')}
          primary
          onPress={() => {
            const result = simulateProviderUpsert(state.rows, { id: state.id, baseUrl: state.baseUrl, model: state.model, apiKey: state.apiKey });
            state.setProviderResult(result);
            if (result.ok) { state.setRows(result.rows); state.setApiKey(''); }
          }}
        />
        {providerLine ? <ResultLine testID={`${testIDPrefix}-provider-result`} ok={providerLine.ok} text={providerLine.text} /> : null}
      </PendingPanelCard>
      <PendingPanelCard testID={`${testIDPrefix}-probe`}>
        <PendingCardTitle title={t('backendPending.section.probe')} />
        <PendingFieldLabel>{t('backendPending.probeProvider')}</PendingFieldLabel>
        <TextInput testID={`${testIDPrefix}-probe-provider`} value={state.probeProvider} onChangeText={state.setProbeProvider} autoCapitalize="none" autoCorrect={false} placeholder={t('backendPending.probeProvider')} placeholderTextColor={colors.textMuted} accessibilityLabel={t('backendPending.probeProvider')} style={inputStyle} />
        <PendingFieldLabel>{t('backendPending.probeModel')}</PendingFieldLabel>
        <TextInput testID={`${testIDPrefix}-probe-model`} value={state.probeModel} onChangeText={state.setProbeModel} autoCapitalize="none" autoCorrect={false} placeholder={t('backendPending.probeModel')} placeholderTextColor={colors.textMuted} accessibilityLabel={t('backendPending.probeModel')} style={inputStyle} />
        <DemoButton testID={`${testIDPrefix}-probe-run`} label={t('backendPending.probe')} onPress={() => state.setProbed(simulateProviderProbe({ providerId: state.probeProvider, model: state.probeModel }))} />
        {probeLine ? <ResultLine testID={`${testIDPrefix}-probe-result`} ok={probeLine.ok} text={probeLine.text} /> : null}
      </PendingPanelCard>
    </View>
  );
}

function SkillsPendingPanel({ testIDPrefix, state }: { testIDPrefix: string; state: ReturnType<typeof usePendingSkillsState> }) {
  const { t } = useTranslation();
  const skillLine = (() => {
    if (!state.skill) return null;
    if (!state.skill.ok) return { ok: false, text: t('backendPending.skillMissing') };
    const title = state.skill.id === 'demo-summarize' ? t('backendPending.skill.summarize.title') : t('backendPending.skill.review.title');
    const body = state.skill.id === 'demo-summarize' ? t('backendPending.skill.summarize.body') : t('backendPending.skill.review.body');
    return { ok: true, text: `${title}: ${body}` };
  })();
  return (
    <PendingPanelCard testID={`${testIDPrefix}-skills`}>
      <PendingCardTitle title={t('backendPending.section.skills')} subtitle={t('backendPending.skillsHint')} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        <SkillChip testID={`${testIDPrefix}-skill-summarize`} label={t('backendPending.skill.summarize.title')} onPress={() => state.setSkill(simulateSkillOpen('demo-summarize'))} />
        <SkillChip testID={`${testIDPrefix}-skill-review`} label={t('backendPending.skill.review.title')} onPress={() => state.setSkill(simulateSkillOpen('demo-review'))} />
      </View>
      {skillLine ? <ResultLine testID={`${testIDPrefix}-skill-result`} ok={skillLine.ok} text={skillLine.text} /> : null}
    </PendingPanelCard>
  );
}

function TokensPendingPanel({ testIDPrefix, state }: { testIDPrefix: string; state: ReturnType<typeof usePendingTokensState> }) {
  const { t } = useTranslation();
  const inputStyle = pendingFieldStyle();
  const secretLine = (() => {
    if (!state.secretResult) return null;
    if (!state.secretResult.ok) {
      return { ok: false, text: state.secretResult.reason === 'name' ? t('backendPending.secretNeedName') : t('backendPending.secretNeedValue') };
    }
    return { ok: true, text: t('backendPending.secretSaved', { name: state.secretResult.name }) };
  })();
  const envLine = (() => {
    if (!state.envResult) return null;
    if (!state.envResult.ok) {
      return { ok: false, text: state.envResult.reason === 'key' ? t('backendPending.envNeedKey') : t('backendPending.envNeedValue') };
    }
    return { ok: true, text: t('backendPending.envSaved', { key: state.envResult.key }) };
  })();
  return (
    <View testID={`${testIDPrefix}-tokens`} style={{ gap: spacing.md }}>
      <PendingPanelCard testID={`${testIDPrefix}-secrets`}>
        <PendingCardTitle title={t('backendPending.section.secrets')} />
        <PendingFieldLabel>{t('backendPending.secretName')}</PendingFieldLabel>
        <TextInput testID={`${testIDPrefix}-secret-name`} value={state.secretName} onChangeText={state.setSecretName} autoCapitalize="none" autoCorrect={false} placeholder={t('backendPending.secretName')} placeholderTextColor={colors.textMuted} accessibilityLabel={t('backendPending.secretName')} style={inputStyle} />
        <PendingFieldLabel>{t('backendPending.secretValue')}</PendingFieldLabel>
        <TextInput testID={`${testIDPrefix}-secret-value`} value={state.secretValue} onChangeText={state.setSecretValue} secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="password" placeholder={t('backendPending.secretValue')} placeholderTextColor={colors.textMuted} accessibilityLabel={t('backendPending.secretValueA11y')} style={inputStyle} />
        <DemoButton
          testID={`${testIDPrefix}-secret-save`}
          label={t('backendPending.secretSave')}
          primary
          onPress={() => {
            const result = simulateSecretSave({ name: state.secretName, value: state.secretValue });
            state.setSecretResult(result);
            if (result.ok) state.setSecretValue('');
          }}
        />
        {secretLine ? <ResultLine testID={`${testIDPrefix}-secret-result`} ok={secretLine.ok} text={secretLine.text} /> : null}
      </PendingPanelCard>
      <PendingPanelCard testID={`${testIDPrefix}-env`}>
        <PendingCardTitle title={t('backendPending.section.env')} />
        <PendingFieldLabel>{t('backendPending.envKey')}</PendingFieldLabel>
        <TextInput testID={`${testIDPrefix}-env-key`} value={state.envKey} onChangeText={state.setEnvKey} autoCapitalize="characters" autoCorrect={false} placeholder={t('backendPending.envKey')} placeholderTextColor={colors.textMuted} accessibilityLabel={t('backendPending.envKey')} style={inputStyle} />
        <PendingFieldLabel>{t('backendPending.envValue')}</PendingFieldLabel>
        <TextInput testID={`${testIDPrefix}-env-value`} value={state.envValue} onChangeText={state.setEnvValue} autoCapitalize="none" autoCorrect={false} placeholder={t('backendPending.envValue')} placeholderTextColor={colors.textMuted} accessibilityLabel={t('backendPending.envValueA11y')} style={inputStyle} />
        <DemoButton
          testID={`${testIDPrefix}-env-save`}
          label={t('backendPending.envSave')}
          primary
          onPress={() => {
            const result = simulateEnvSave({ key: state.envKey, value: state.envValue });
            state.setEnvResult(result);
            if (result.ok) state.setEnvValue('');
          }}
        />
        {envLine ? <ResultLine testID={`${testIDPrefix}-env-result`} ok={envLine.ok} text={envLine.text} /> : null}
      </PendingPanelCard>
    </View>
  );
}

/** Tab body only — Hub 主栏 / 集成壳内层。 */
export function BackendPendingTabPanels({
  tab,
  testIDPrefix,
  showBanner = true,
  skillsSlot,
}: {
  tab: PendingTab;
  testIDPrefix: string;
  showBanner?: boolean;
  skillsSlot?: ReactNode;
}) {
  const { t } = useTranslation();
  const provider = usePendingProviderState();
  const skills = usePendingSkillsState();
  const tokens = usePendingTokensState();
  return (
    <View testID={`${testIDPrefix}-panels`} style={{ gap: spacing.md }}>
      {showBanner ? <PendingDemoBanner t={t} /> : null}
      {tab === 'provider' ? <ProviderPendingPanel testIDPrefix={testIDPrefix} state={provider} /> : null}
      {tab === 'skills' ? (skillsSlot ?? <SkillsPendingPanel testIDPrefix={testIDPrefix} state={skills} />) : null}
      {tab === 'tokens' ? <TokensPendingPanel testIDPrefix={testIDPrefix} state={tokens} /> : null}
    </View>
  );
}

export function BackendPendingIntegration({
  layer,
  tab,
  onTabChange,
  showTabs,
  testIDPrefix,
  skillsSlot,
}: {
  layer: PendingLayer;
  tab: PendingTab;
  onTabChange?: (tab: PendingTab) => void;
  showTabs: boolean;
  testIDPrefix: string;
  skillsSlot?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <PendingIntegrationFrame
      layer={layer}
      hint={t(LAYER_HINT[layer])}
      banner={<PendingDemoBanner t={t} />}
      tabs={showTabs && onTabChange ? <PendingSegmentedTabs value={tab} onChange={onTabChange} testID={`${testIDPrefix}-tabs`} t={t} /> : null}
      testID={`${testIDPrefix}-shell`}
      t={t}
    >
      <BackendPendingTabPanels tab={tab} testIDPrefix={testIDPrefix} showBanner={false} skillsSlot={skillsSlot} />
    </PendingIntegrationFrame>
  );
}

export function DaemonPendingDemos() {
  const [tab, setTab] = useState<PendingTab>('provider');
  return (
    <View testID="daemon-pending-demos" style={{ paddingTop: spacing.sm }}>
      <BackendPendingIntegration layer="daemon" tab={tab} onTabChange={setTab} showTabs testIDPrefix="daemon-pending" />
    </View>
  );
}
