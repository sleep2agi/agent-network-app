// 群头像:圆形底 + 「多人」图标(群没有插画池,不能借用 AliasAvatar 的按名字取图 —— 那会让群和某个人撞头像)。
import { View } from 'react-native';
import { Ionicons } from './icons';
import { avatarRadius, colors } from './theme';
import { ds } from './ui-scale';

export default function GroupAvatar({ size = 34, fixedSize = false, testID }: { size?: number; fixedSize?: boolean; testID?: string }) {
  const s = fixedSize ? size : ds(size);
  return (
    <View testID={testID} style={{ width: s, height: s, borderRadius: avatarRadius(s), backgroundColor: colors.accent + '22', alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name="people" size={Math.round(s * 0.55)} color={colors.accent} />
    </View>
  );
}
