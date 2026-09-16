// 2026-09-16(Vincent:「上面多余的那一行是不是可以删了」—— macOS 原生标题栏那条灰带):
// 主窗和分离窗都改成 titleBarStyle=Overlay + hiddenTitle,原生标题栏不再画;红黄绿灯还在左上角,
// 所以顶部留一条 28px 的空带给它们,并标成 data-tauri-drag-region 让窗口仍能拖动。
// 只在 Tauri 桌面壳 + macOS 生效;Windows 保留原生标题栏,网页/移动端不渲染。
import { Platform, View } from 'react-native';
import { colors } from './theme';
import { MAC_TITLE_STRIP_HEIGHT, isMacTauriShell } from './mac-shell';

export { MAC_TITLE_STRIP_HEIGHT, isMacTauriShell } from './mac-shell';

export default function MacTitleStrip() {
  if (!isMacTauriShell(Platform.OS)) return null;
  return (
    <View
      accessibilityLabel="窗口拖动区"
      {...({ dataSet: { tauriDragRegion: '' } } as any)}
      style={{ height: MAC_TITLE_STRIP_HEIGHT, backgroundColor: colors.bg }}
    />
  );
}
