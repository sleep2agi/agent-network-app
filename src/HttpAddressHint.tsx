import { Text } from 'react-native';
import { colors } from './theme';
import { useTranslation } from './i18n-react';
import './i18n-accounts';

export function HttpAddressHint({ address }: { address: string }) {
  const { t } = useTranslation();
  if (!/^http:\/\//i.test(address.trimStart())) return null;
  return <Text style={{ color: colors.textMuted, fontSize: 12, lineHeight: 18 }}>{t('accounts.httpAddressHint')}</Text>;
}
