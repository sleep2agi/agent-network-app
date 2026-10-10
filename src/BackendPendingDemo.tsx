// 未接通入口的可点击演示。只调用 backend-pending-demo.ts，不读 Hub / Daemon，不写配置。
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';
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
import { colors, onThemeChange, radius, spacing, type, weight } from './theme';

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

function DemoField({ label, children, compact }: { label: string; children: ReactNode; compact?: boolean }) {
  return (
    <View style={[demoStyles.field, compact && demoStyles.fieldCompact]}>
      <PendingFieldLabel>{label}</PendingFieldLabel>
      {children}
    </View>
  );
}

function SkillRow({
  testID,
  title,
  description,
  selected,
  onPress,
}: {
  testID: string;
  title: string;
  description: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${description}`}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [demoStyles.skillRow, selected && demoStyles.skillRowSelected, pressed && { backgroundColor: colors.rowHover }]}
    >
      <View style={demoStyles.skillIcon}>
        <Ionicons name="sparkles-outline" size={17} color={colors.accent} />
      </View>
      <View style={demoStyles.rowCopy}>
        <Text style={demoStyles.rowTitle}>{title}</Text>
        <Text style={demoStyles.rowDescription}>{description}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </Pressable>
  );
}

function ProviderCatalogRow({ row, last }: { row: DemoProviderRow; last: boolean }) {
  return (
    <View style={[demoStyles.catalogRow, !last && demoStyles.catalogRowDivider]}>
      <View style={demoStyles.providerMark}>
        <Ionicons name="cube-outline" size={16} color={colors.accent} />
      </View>
      <View style={demoStyles.rowCopy}>
        <Text style={demoStyles.rowTitle}>{row.id}</Text>
        <Text style={demoStyles.rowDescription} numberOfLines={1}>{row.baseUrl}</Text>
      </View>
      <View style={demoStyles.modelPill}>
        <Text style={demoStyles.modelPillText} numberOfLines={1}>{row.model}</Text>
      </View>
    </View>
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
      <View style={demoStyles.actionRow}>
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
      </View>
      <PendingPanelCard testID="provider-config-probe-card">
        <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>{t('backendPending.section.probe')}</Text>
        <View style={demoStyles.fieldGrid}>
          <DemoField label={t('backendPending.probeProvider')} compact>
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
          </DemoField>
          <DemoField label={t('backendPending.probeModel')} compact>
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
          </DemoField>
        </View>
        <View style={demoStyles.actionRow}>
          <DemoButton
            testID="provider-demo-probe"
            label={t('backendPending.probe')}
            onPress={() => setProbed(simulateProviderProbe({ providerId, model }))}
          />
          {probeLine ? <ResultLine testID="provider-demo-probe-result" ok={probeLine.ok} text={probeLine.text} /> : null}
        </View>
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
    <View testID={`${testIDPrefix}-provider`} style={demoStyles.panelGrid}>
      <PendingPanelCard testID={`${testIDPrefix}-provider-catalog`} style={[demoStyles.panelPrimary, demoStyles.providerCard]}>
        <PendingCardTitle title={t('backendPending.section.providers')} subtitle={t('backendPending.providerCatalogHint')} />
        <View testID={`${testIDPrefix}-provider-list`} style={demoStyles.catalog}>
          {state.rows.map((row, index) => (
            <ProviderCatalogRow key={row.id} row={row} last={index === state.rows.length - 1} />
          ))}
        </View>
        <View style={demoStyles.sectionDivider} />
        <View style={[demoStyles.fieldGrid, demoStyles.providerFieldGrid]}>
          <DemoField label={t('backendPending.providerId')} compact>
            <TextInput testID={`${testIDPrefix}-provider-id`} value={state.id} onChangeText={state.setId} autoCapitalize="none" autoCorrect={false} placeholder={t('backendPending.providerId')} placeholderTextColor={colors.textMuted} accessibilityLabel={t('backendPending.providerId')} style={inputStyle} />
          </DemoField>
          <DemoField label={t('backendPending.providerBaseUrl')} compact>
            <TextInput testID={`${testIDPrefix}-provider-base`} value={state.baseUrl} onChangeText={state.setBaseUrl} autoCapitalize="none" autoCorrect={false} placeholder={t('backendPending.providerBaseUrl')} placeholderTextColor={colors.textMuted} accessibilityLabel={t('backendPending.providerBaseUrl')} style={inputStyle} />
          </DemoField>
          <DemoField label={t('backendPending.providerModel')} compact>
            <TextInput testID={`${testIDPrefix}-provider-model`} value={state.model} onChangeText={state.setModel} autoCapitalize="none" autoCorrect={false} placeholder={t('backendPending.providerModel')} placeholderTextColor={colors.textMuted} accessibilityLabel={t('backendPending.providerModel')} style={inputStyle} />
          </DemoField>
          <DemoField label={t('backendPending.providerKey')} compact>
            <TextInput testID={`${testIDPrefix}-provider-key`} value={state.apiKey} onChangeText={state.setApiKey} secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="password" placeholder={t('backendPending.providerKey')} placeholderTextColor={colors.textMuted} accessibilityLabel={t('backendPending.providerKeyA11y')} style={inputStyle} />
          </DemoField>
        </View>
        <View style={demoStyles.actionRow}>
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
        </View>
      </PendingPanelCard>
      <PendingPanelCard testID={`${testIDPrefix}-probe`} style={[demoStyles.panelSecondary, demoStyles.providerCard]}>
        <PendingCardTitle title={t('backendPending.section.probe')} />
        <View style={demoStyles.fieldGrid}>
          <DemoField label={t('backendPending.probeProvider')} compact>
            <TextInput testID={`${testIDPrefix}-probe-provider`} value={state.probeProvider} onChangeText={state.setProbeProvider} autoCapitalize="none" autoCorrect={false} placeholder={t('backendPending.probeProvider')} placeholderTextColor={colors.textMuted} accessibilityLabel={t('backendPending.probeProvider')} style={inputStyle} />
          </DemoField>
          <DemoField label={t('backendPending.probeModel')} compact>
            <TextInput testID={`${testIDPrefix}-probe-model`} value={state.probeModel} onChangeText={state.setProbeModel} autoCapitalize="none" autoCorrect={false} placeholder={t('backendPending.probeModel')} placeholderTextColor={colors.textMuted} accessibilityLabel={t('backendPending.probeModel')} style={inputStyle} />
          </DemoField>
        </View>
        <View style={demoStyles.actionRow}>
          <DemoButton testID={`${testIDPrefix}-probe-run`} label={t('backendPending.probe')} onPress={() => state.setProbed(simulateProviderProbe({ providerId: state.probeProvider, model: state.probeModel }))} />
          {probeLine ? <ResultLine testID={`${testIDPrefix}-probe-result`} ok={probeLine.ok} text={probeLine.text} /> : null}
        </View>
      </PendingPanelCard>
    </View>
  );
}

function SkillsPendingPanel({ testIDPrefix, state }: { testIDPrefix: string; state: ReturnType<typeof usePendingSkillsState> }) {
  const { t } = useTranslation();
  const selectedId = state.skill?.ok ? state.skill.id : null;
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
      <View style={demoStyles.skillList}>
        <SkillRow
          testID={`${testIDPrefix}-skill-summarize`}
          title={t('backendPending.skill.summarize.title')}
          description={t('backendPending.skill.summarize.body')}
          selected={selectedId === 'demo-summarize'}
          onPress={() => state.setSkill(simulateSkillOpen('demo-summarize'))}
        />
        <SkillRow
          testID={`${testIDPrefix}-skill-review`}
          title={t('backendPending.skill.review.title')}
          description={t('backendPending.skill.review.body')}
          selected={selectedId === 'demo-review'}
          onPress={() => state.setSkill(simulateSkillOpen('demo-review'))}
        />
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
    <View testID={`${testIDPrefix}-tokens`} style={demoStyles.panelGrid}>
      <PendingPanelCard testID={`${testIDPrefix}-secrets`} style={demoStyles.equalPanel}>
        <PendingCardTitle title={t('backendPending.section.secrets')} />
        <View style={demoStyles.fieldGrid}>
          <DemoField label={t('backendPending.secretName')} compact>
            <TextInput testID={`${testIDPrefix}-secret-name`} value={state.secretName} onChangeText={state.setSecretName} autoCapitalize="none" autoCorrect={false} placeholder={t('backendPending.secretName')} placeholderTextColor={colors.textMuted} accessibilityLabel={t('backendPending.secretName')} style={inputStyle} />
          </DemoField>
          <DemoField label={t('backendPending.secretValue')} compact>
            <TextInput testID={`${testIDPrefix}-secret-value`} value={state.secretValue} onChangeText={state.setSecretValue} secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="password" placeholder={t('backendPending.secretValue')} placeholderTextColor={colors.textMuted} accessibilityLabel={t('backendPending.secretValueA11y')} style={inputStyle} />
          </DemoField>
        </View>
        <View style={demoStyles.actionRow}>
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
        </View>
      </PendingPanelCard>
      <PendingPanelCard testID={`${testIDPrefix}-env`} style={demoStyles.equalPanel}>
        <PendingCardTitle title={t('backendPending.section.env')} />
        <View style={demoStyles.fieldGrid}>
          <DemoField label={t('backendPending.envKey')} compact>
            <TextInput testID={`${testIDPrefix}-env-key`} value={state.envKey} onChangeText={state.setEnvKey} autoCapitalize="characters" autoCorrect={false} placeholder={t('backendPending.envKey')} placeholderTextColor={colors.textMuted} accessibilityLabel={t('backendPending.envKey')} style={inputStyle} />
          </DemoField>
          <DemoField label={t('backendPending.envValue')} compact>
            <TextInput testID={`${testIDPrefix}-env-value`} value={state.envValue} onChangeText={state.setEnvValue} autoCapitalize="none" autoCorrect={false} placeholder={t('backendPending.envValue')} placeholderTextColor={colors.textMuted} accessibilityLabel={t('backendPending.envValueA11y')} style={inputStyle} />
          </DemoField>
        </View>
        <View style={demoStyles.actionRow}>
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
        </View>
      </PendingPanelCard>
    </View>
  );
}

/** Node detail keeps its previous section IA and adds one simple key-only entry. */
export function NodeSecretPendingSection() {
  const { t } = useTranslation();
  const state = usePendingTokensState();
  const inputStyle = pendingFieldStyle();
  const secretLine = (() => {
    if (!state.secretResult) return null;
    if (!state.secretResult.ok) {
      return { ok: false, text: state.secretResult.reason === 'name' ? t('backendPending.secretNeedName') : t('backendPending.secretNeedValue') };
    }
    return { ok: true, text: t('backendPending.secretSaved', { name: state.secretResult.name }) };
  })();
  return (
    <View testID="node-secret-demo" style={{ gap: spacing.md }}>
      <PendingDemoBanner t={t} />
      <PendingPanelCard testID="node-secret-card">
        <PendingCardTitle title={t('backendPending.section.secrets')} />
        <Text style={demoStyles.sectionHint}>{t('backendPending.nodeSecretHint')}</Text>
        <View style={demoStyles.fieldGrid}>
          <DemoField label={t('backendPending.secretName')} compact>
            <TextInput testID="node-secret-name" value={state.secretName} onChangeText={state.setSecretName} autoCapitalize="none" autoCorrect={false} placeholder={t('backendPending.secretName')} placeholderTextColor={colors.textMuted} accessibilityLabel={t('backendPending.secretName')} style={inputStyle} />
          </DemoField>
          <DemoField label={t('backendPending.secretValue')} compact>
            <TextInput testID="node-secret-value" value={state.secretValue} onChangeText={state.setSecretValue} secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="password" placeholder={t('backendPending.secretValue')} placeholderTextColor={colors.textMuted} accessibilityLabel={t('backendPending.secretValueA11y')} style={inputStyle} />
          </DemoField>
        </View>
        <View style={demoStyles.actionRow}>
          <DemoButton
            testID="node-secret-save"
            label={t('backendPending.secretSave')}
            primary
            onPress={() => {
              const result = simulateSecretSave({ name: state.secretName, value: state.secretValue });
              state.setSecretResult(result);
              if (result.ok) state.setSecretValue('');
            }}
          />
          {secretLine ? <ResultLine testID="node-secret-result" ok={secretLine.ok} text={secretLine.text} /> : null}
        </View>
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

const makeDemoStyles = () =>
  StyleSheet.create({
    panelGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'flex-start',
      gap: spacing.md,
    },
    panelPrimary: { flexGrow: 2, flexShrink: 1, flexBasis: 380, minWidth: 0 },
    panelSecondary: { flexGrow: 1, flexShrink: 1, flexBasis: 240, minWidth: 0, alignSelf: 'flex-start' },
    providerCard: { paddingVertical: spacing.sm + 2, gap: spacing.sm },
    providerFieldGrid: { gap: spacing.sm },
    equalPanel: { flexGrow: 1, flexShrink: 1, flexBasis: 300, minWidth: 0 },
    fieldGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'flex-start',
      gap: spacing.md,
    },
    field: { flexGrow: 1, flexShrink: 1, flexBasis: 220, minWidth: 0, gap: spacing.xs + 2 },
    fieldCompact: { flexBasis: 160 },
    sectionHint: { color: colors.textMuted, fontSize: type.small, lineHeight: 18 },
    actionRow: {
      minHeight: 36,
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: spacing.md,
    },
    sectionDivider: { height: 1, backgroundColor: colors.border },
    catalog: {
      borderRadius: radius.control,
      backgroundColor: colors.inputBg,
      overflow: 'hidden',
    },
    catalogRow: {
      minHeight: 50,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
    },
    catalogRowDivider: { borderBottomWidth: 1, borderBottomColor: colors.border },
    providerMark: {
      width: 28,
      height: 28,
      borderRadius: radius.item,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.tonalBg,
    },
    rowCopy: { flex: 1, minWidth: 0, gap: 2 },
    rowTitle: { color: colors.text, fontSize: type.body, fontWeight: weight.strong },
    rowDescription: { color: colors.textMuted, fontSize: type.small, lineHeight: 17 },
    modelPill: {
      maxWidth: '42%',
      borderRadius: radius.pill,
      backgroundColor: colors.subtleFill,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
    },
    modelPillText: { color: colors.textSecondary, fontSize: type.small },
    skillList: { gap: spacing.xs },
    skillRow: {
      minHeight: 64,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.control,
    },
    skillRowSelected: { backgroundColor: colors.rowActive },
    skillIcon: {
      width: 34,
      height: 34,
      borderRadius: radius.item,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.tonalBg,
    },
  });

let demoStyles = makeDemoStyles();
onThemeChange(() => {
  demoStyles = makeDemoStyles();
});
