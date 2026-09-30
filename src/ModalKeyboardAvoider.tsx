// 弹窗里的键盘避让 —— 全 app 的弹窗 / 底部 sheet 只用这一个(2026-09-30 「新建用户的确认键呢」按类修)。
//
// Modal 是单独的原生窗口:根窗口的 adjustResize / KeyboardAvoidingView 管不到它。iOS 用 padding;
// Android 用 height,且只在真看到 keyboardDidShow 时启用 —— RN 的 KAV 在 Android 上收起键盘后不复位,
// 会留一截键盘高的空白(keyboard-visibility.ts 的来龙去脉)。Web / 桌面没有软键盘,等于一个 flex:1 的 View。
//
// 🔴 遮罩(scrim)由这里画,画在避让层**外面**、铺满整个 Modal 窗口。避让层在 Android 上是改自己的 height:
// 遮罩要是画在它里面的 backdrop 上,键盘一弹(或可见状态没复位)遮罩就跟着变短,底下一截页面不变暗
// (0.2.161 平板成员弹窗,「新建分组」从遮罩下面露出来)。所以弹窗里的 backdrop 只管布局、不带底色,
// 底色写在 scrim 上(modal-scrim-rule.test.ts 守着)。
import type { ReactNode } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, View, type StyleProp, type ViewStyle } from 'react-native';
import { keyboardAvoidEnabled, useKeyboardVisible } from './keyboard-visibility';

export default function ModalKeyboardAvoider({ children, style, scrim }: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** 遮罩颜色,铺满整个 Modal 窗口,不随避让层收缩。 */
  scrim: string;
}) {
  const visible = useKeyboardVisible(Keyboard, Platform.OS);
  return (
    <View style={{ flex: 1, backgroundColor: scrim }}>
      <KeyboardAvoidingView
        style={[{ flex: 1 }, style]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        enabled={keyboardAvoidEnabled(Platform.OS, visible)}
      >
        {children}
      </KeyboardAvoidingView>
    </View>
  );
}
