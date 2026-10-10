import { View } from 'react-native';
import { Text } from './ui-text';
import { useTranslation } from './i18n-react';
import './i18n-provider';
import { colors, spacing } from './theme';

/** OpenCode V2 keeps OpenCode's own provider/model. No parallel preset list and no key field. */
export default function OpenCodeProviderNote() {
  const { t } = useTranslation();
  return (
    <View testID="opencode-provider-note" style={{ gap: spacing.xs }}>
      <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>{t('provider.opencodeTitle')}</Text>
      <Text style={{ color: colors.textMuted, fontSize: 12, lineHeight: 18 }}>{t('provider.opencodeBody')}</Text>
    </View>
  );
}
