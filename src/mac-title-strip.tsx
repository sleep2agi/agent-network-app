// 2026-09-16(Vincent:「上面多余的那一行是不是可以删了」—— macOS 原生标题栏那条灰带):
// 主窗和分离窗都改成 titleBarStyle=Overlay + hiddenTitle,原生标题栏不再画;红黄绿灯还在左上角,
// 所以顶部留一条 28px 的空带给它们,并标成 data-tauri-drag-region 让窗口仍能拖动。
// 只在 Tauri 桌面壳 + macOS 生效;Windows 保留原生标题栏,网页/移动端不渲染。
import { useSyncExternalStore } from 'react';
import { Platform, View } from 'react-native';
import { colors, onThemeChange, themeMode } from './theme';
import { MAC_TITLE_STRIP_HEIGHT, isMacTauriShell } from './mac-shell';
import { popoutChatChrome } from './window-shell';

export { MAC_TITLE_STRIP_HEIGHT, isMacTauriShell } from './mac-shell';

export default function MacTitleStrip() {
  // 0.2.83:这条挂在 AppRoot 外面,不在 key={theme} 重挂的树里——主题一翻它不会重画,深色主题下
  // 就留着首次渲染时的浅色底(Vincent 2026-09-22 截图:顶部红黄绿灯那条是白的)。自己订阅。
  useSyncExternalStore(onThemeChange, themeMode, themeMode);
  if (!isMacTauriShell(Platform.OS)) return null;
  // 2026-09-30:分离聊天窗不要这条空带 —— 红黄绿灯挪进了页头那一行(页头兼当标题栏,
  // 见 window-shell.ts「分离聊天窗」)。主窗 / 设置窗 / 工作区窗照旧。
  if (popoutChatChrome(Platform.OS) === 'mac') return null;
  return (
    <View
      accessibilityLabel="窗口拖动区"
      {...({ dataSet: { tauriDragRegion: '' } } as any)}
      style={{ height: MAC_TITLE_STRIP_HEIGHT, backgroundColor: colors.bg }}
    />
  );
}
