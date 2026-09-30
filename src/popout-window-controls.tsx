// 分离聊天窗的 – □ ×(Vincent 2026-09-30「上面那个还是挺多余的」,照微信独立聊天窗)。
//
// Windows 上分离聊天窗 decorations=false(desktop-chat-menu.ts openChatWindow),原生标题栏没了,
// 页头那一行兼当标题栏(拖动 / 双击最大化,见 window-shell.ts「分离聊天窗」)。三颗按钮浮在窗口
// 右上角、贴顶,和页头同一行;页头右侧按 popoutHeaderInsets 让出 138px,⋯ 不会被压住。
//
// 🔴 挂在 App 根上,不挂在 ChatScreen 里:分离窗也会显示「节点信息」页、启动转圈、登录页 ——
//    那些页没有聊天页头,要是按钮跟着页头走,这些页就没有关闭入口(原生标题栏已经关了)。
// 🔴 只在 Tauri 桌面壳 + Windows + label 为 chat-* 时渲染;手机 / 网页 / macOS / 其他窗口一律 null
//    (popoutChatChrome 对 Platform.OS !== 'web' 直接给 null)。
import { useSyncExternalStore } from 'react';
import { Platform, View } from 'react-native';
import { colors, onThemeChange, themeMode } from './theme';
import { WindowControls } from './win-title-bar';
import { POPOUT_WINDOW_CONTROLS_WIDTH, WINDOWS_TITLE_BAR_HEIGHT, popoutChatChrome } from './window-shell';

export default function PopoutWindowControls() {
  // 同 WinTitleBar:挂在 AppRoot 外面,主题翻了要自己重画。
  useSyncExternalStore(onThemeChange, themeMode, themeMode);
  if (popoutChatChrome(Platform.OS) !== 'windows') return null;
  return (
    <View
      testID="popout-window-controls"
      accessibilityLabel="窗口控件"
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        width: POPOUT_WINDOW_CONTROLS_WIDTH,
        height: WINDOWS_TITLE_BAR_HEIGHT,
        flexDirection: 'row',
        zIndex: 2000,
      }}
    >
      <WindowControls restoreBg={colors.card} />
    </View>
  );
}
