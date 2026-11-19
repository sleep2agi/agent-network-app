import { Platform, type ViewStyle } from 'react-native';
import type { ThemeMode } from './theme';
import { chatCornerGlowGradient } from './chat-glow-gradient';

// 写法与 update-screen-parts 的 heroBackground 一样：web 认 backgroundImage，
// 原生（新架构）认 experimental_backgroundImage；都不认时退回纯底色。
export function chatCornerGlow(ground: string, mode: ThemeMode): ViewStyle {
  const gradient = chatCornerGlowGradient(mode);
  const base: ViewStyle = { backgroundColor: ground };
  return Platform.OS === 'web'
    ? ({ ...base, backgroundImage: gradient } as ViewStyle)
    : ({ ...base, experimental_backgroundImage: gradient } as ViewStyle);
}
