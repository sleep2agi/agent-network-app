import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { useTranslation } from './i18n-react';
import './i18n-provider';
import {
  EMPTY_PROVIDER_FORM,
  formAfterChoice,
  hubTransportAllowsSecrets,
  presetsFor,
  providerIssueI18nKey,
  providerLocalIssues,
  suggestedProviderModels,
  type ProviderChoice,
  type ProviderFormValue,
  type ProviderIssue,
} from './provider-create-options';
import { colors, radius, spacing } from './theme';
import { ProviderConfigDemo } from './BackendPendingDemo';

function IssueLine({ issue }: { issue: ProviderIssue }) {
  const { t } = useTranslation();
  return <Text style={{ color: colors.failed, fontSize: 12, lineHeight: 18 }}>{t(providerIssueI18nKey(issue))}</Text>;
}

export default function CodexProviderFields({
  runtimeId,
  value,
  issues,
  transportOk,
  hubBlocked,
  onChange,
}: {
  runtimeId: string;
  value: ProviderFormValue;
  issues: readonly ProviderIssue[];
  transportOk: boolean;
  hubBlocked: boolean;
  onChange: (next: ProviderFormValue) => void;
}) {
  const { t } = useTranslation();
  const labelFor = (choice: ProviderChoice) => t(choice === 'custom-openai-compat' ? 'provider.preset.custom' : choice === 'none' ? 'provider.preset.none' : choice === 'deepseek' ? 'provider.preset.deepseek' : 'provider.preset.minimax');
  const choices: ProviderChoice[] = ['none', ...presetsFor(runtimeId)];
  const suggestions = value.choice === 'none' ? [] : suggestedProviderModels(runtimeId, value.choice);
  const field = {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.inputBg,
    borderRadius: radius.control,
    paddingHorizontal: spacing.md,
    minHeight: 36,
    color: colors.text,
    fontSize: 14,
  };
  return (
    <View testID="codex-provider-fields" style={{ gap: spacing.sm, marginTop: spacing.md }}>
      <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>{t('provider.codexTitle')}</Text>
      <Text style={{ color: colors.textMuted, fontSize: 12, lineHeight: 18 }}>{t('provider.codexHint')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {choices.map(choice => {
          const selected = value.choice === choice;
          return (
            <Pressable
              key={choice}
              testID={`codex-provider-choice-${choice}`}
              accessibilityRole="radio"
              accessibilityLabel={t('provider.presetA11y', { name: labelFor(choice) })}
              accessibilityState={{ checked: selected }}
              onPress={() => onChange(formAfterChoice(value, choice, runtimeId))}
              style={{
                borderWidth: 1,
                borderColor: selected ? colors.accent : colors.border,
                backgroundColor: selected ? colors.tonalBg : colors.card,
                borderRadius: radius.control,
                paddingHorizontal: spacing.md,
                minHeight: 34,
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: selected ? colors.accent : colors.text, fontSize: 13 }}>{labelFor(choice)}</Text>
            </Pressable>
          );
        })}
      </View>
      {value.choice !== 'none' ? (
        <>
          <Text style={{ color: colors.textMuted, fontSize: 12 }}>{t('provider.baseUrl')}</Text>
          <TextInput
            testID="codex-provider-base-url"
            value={value.baseUrl}
            onChangeText={baseUrl => onChange({ ...value, baseUrl })}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={t('provider.baseUrlPlaceholder')}
            placeholderTextColor={colors.textMuted}
            accessibilityLabel={t('provider.baseUrl')}
            style={field}
          />
          <Text style={{ color: colors.textMuted, fontSize: 12 }}>{t('provider.model')}</Text>
          {suggestions.length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {suggestions.map(model => {
                const selected = value.model === model;
                return (
                  <Pressable
                    key={model}
                    accessibilityRole="radio"
                    accessibilityLabel={model}
                    accessibilityState={{ checked: selected }}
                    onPress={() => onChange({ ...value, model })}
                    style={{
                      borderWidth: 1,
                      borderColor: selected ? colors.accent : colors.border,
                      borderRadius: radius.control,
                      paddingHorizontal: spacing.md,
                      minHeight: 34,
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{ color: selected ? colors.accent : colors.text, fontSize: 13 }}>{model}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          <TextInput
            testID="codex-provider-model"
            value={value.model}
            onChangeText={model => onChange({ ...value, model })}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={t('provider.modelPlaceholder')}
            placeholderTextColor={colors.textMuted}
            accessibilityLabel={t('provider.model')}
            style={field}
          />
          <Text style={{ color: colors.textMuted, fontSize: 12 }}>{t('provider.apiKey')}</Text>
          <TextInput
            testID="codex-provider-api-key"
            value={transportOk ? value.apiKey : ''}
            onChangeText={apiKey => onChange({ ...value, apiKey })}
            editable={transportOk}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="password"
            placeholder={t('provider.apiKeyPlaceholder')}
            placeholderTextColor={colors.textMuted}
            accessibilityLabel={t('provider.apiKeyA11y')}
            style={field}
          />
          {issues.map(issue => <IssueLine key={issue} issue={issue} />)}
          {hubBlocked ? (
            <Text testID="codex-provider-hub-banner" style={{ color: colors.textMuted, fontSize: 12, lineHeight: 18 }}>
              {t('provider.err.hub_not_ready')}
            </Text>
          ) : null}
          <ProviderConfigDemo
            key={value.choice}
            runtimeId={runtimeId}
            value={value}
            transportOk={transportOk}
            onClearKey={() => onChange({ ...value, apiKey: '' })}
          />
        </>
      ) : null}
    </View>
  );
}

export function NodeCodexProviderSection({ runtimeId, serverUrl }: { runtimeId: string; serverUrl: string }) {
  const [value, setValue] = useState<ProviderFormValue>(EMPTY_PROVIDER_FORM);
  const transportOk = hubTransportAllowsSecrets(serverUrl);
  const issues = providerLocalIssues({ runtimeId, ...value }, transportOk);
  return (
    <CodexProviderFields
      runtimeId={runtimeId}
      value={value}
      issues={issues}
      transportOk={transportOk}
      hubBlocked={value.choice !== 'none' && issues.length === 0}
      onChange={setValue}
    />
  );
}
