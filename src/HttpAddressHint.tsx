import { Text } from 'react-native';
import { colors } from './theme';

export function HttpAddressHint({ address }: { address: string }) {
  if (!/^http:\/\//i.test(address.trimStart())) return null;
  return <Text style={{ color: colors.textMuted, fontSize: 12, lineHeight: 18 }}>这个地址没有加密，建议只在公司内网或可信网络使用</Text>;
}
