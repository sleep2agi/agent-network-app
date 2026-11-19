import { useSyncExternalStore, type ReactNode } from 'react';
import { Platform, View } from 'react-native';
import { colors, onThemeChange, themeMode } from './theme';
import { chatCornerGlow } from './chat-glow';

// admin 2026-11-19「上面的白色很难看」：macOS 红黄绿灯那条 28px 拖动带（MacTitleStrip）是实底，
// 整窗渐变只从它下面开始，顶上留一条白。渐变挪到最外层（拖动带、Windows 标题栏、App 内容的共同父元素），
// 拖动带透明，光从窗口最顶上开始。只在桌面 / 网页（Platform.OS === 'web'）；手机不变。
// 自己订阅主题：这一层在 AppRoot（key={theme} 重挂的树）外面，主题一翻不会跟着重画。
export default function WindowGlowRoot({ children }: { children: ReactNode }) {
  const mode = useSyncExternalStore(onThemeChange, themeMode, themeMode);
  const glow = Platform.OS === 'web' ? chatCornerGlow(colors.bg, mode) : null;
  return <View style={[{ flex: 1 }, glow]} testID="window-glow-root">{children}</View>;
}
