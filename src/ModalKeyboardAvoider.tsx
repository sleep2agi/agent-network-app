// 弹窗里的键盘避让 —— 全 app 的弹窗 / 底部 sheet 只用这一个(2026-09-30 「新建用户的确认键呢」按类修)。
//
// Modal 是单独的原生窗口:根窗口的 adjustResize / KeyboardAvoidingView 管不到它。iOS 用 padding;
// Android 用 height,且只在真看到 keyboardDidShow 时启用 —— RN 的 KAV 在 Android 上收起键盘后不复位,
// 会留一截键盘高的空白(keyboard-visibility.ts 的来龙去脉)。Web / 桌面没有软键盘,等于一个 flex:1 的 View。
import type { ReactNode } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, type StyleProp, type ViewStyle } from 'react-native';
import { keyboardAvoidEnabled, useKeyboardVisible } from './keyboard-visibility';

export default function ModalKeyboardAvoider({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const visible = useKeyboardVisible(Keyboard, Platform.OS);
  return (
    <KeyboardAvoidingView
      style={[{ flex: 1 }, style]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      enabled={keyboardAvoidEnabled(Platform.OS, visible)}
    >
      {children}
    </KeyboardAvoidingView>
  );
}
