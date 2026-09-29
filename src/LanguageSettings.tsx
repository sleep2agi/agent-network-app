import { useTranslation } from './i18n-react';
import './i18n-settings';
import { SettingsChoiceRow, SettingsGroup } from './settings-kit';

export default function LanguageSettings() {
  const { t, preference, setPreference } = useTranslation();
  return <SettingsGroup title={t('language.label')} testID="settings-language">
    {(['system', 'zh', 'en'] as const).map(value => <SettingsChoiceRow
      key={value}
      testID={`settings-language-${value}`}
      label={t(`settings.language.${value}`)}
      selected={preference === value}
      onPress={() => { if (preference !== value) setPreference(value); }}
    />)}
  </SettingsGroup>;
}
