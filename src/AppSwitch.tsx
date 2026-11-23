import { Platform, Switch, type SwitchProps } from 'react-native';
import { colors } from './theme';

export function AppSwitch(props: SwitchProps) {
  return <Switch {...props} trackColor={{ true: colors.accent, false: colors.textMuted }}
    ios_backgroundColor={colors.textMuted} thumbColor="#ffffff"
    {...(Platform.OS === 'web' ? { activeThumbColor: '#ffffff' } : {})} />;
}
