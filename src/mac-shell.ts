// 纯逻辑,不 import react-native:判断「Tauri 桌面壳 + macOS」,给标题栏空带用(测试直接引这里)。
//
// 0.2.81:判定本体搬去 window-shell.ts(Windows 也要同一个问题的答案),这里保留原导出转发,
// 免得既有 import 和契约测试跟着改;两份实现不并存。
export { MAC_TITLE_STRIP_HEIGHT, isMacTauriShell } from './window-shell';
