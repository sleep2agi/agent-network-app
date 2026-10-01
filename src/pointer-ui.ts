// 「这台设备用鼠标和键盘,还是用手指?」—— 交互方式的判定,一处说了算。
//
// Owner 2026-09-27:「Windows / Mac 跟安卓版肯定是不一样的，你为什么要弄成一样的？」
// 布局(wide-layout.ts chooseAppLayout)回答的是「画成几栏」:Tauri 窗口窄于 860 时它给 'phone',
// 于是桌面窗口一拉窄,长按菜单、底部 action sheet、「上滑」文案全跟着回来了 —— 手还是鼠标,没变。
// 所以交互(长按 vs 右键 / 悬停按钮、底部 sheet vs 锚定菜单、整屏 sheet vs 居中对话框、手势文案)按这里判,
// 不按布局判。布局照旧按宽度走。
//
// 纯逻辑、不 import react-native:测试可以直接引。

import { isTauriShell } from './window-shell';
import { isAndroidLike, isIPadLike } from './wide-layout';

/**
 * 鼠标 + 键盘的界面:Tauri 桌面壳(任何窗口宽度),或调用方已经知道自己在桌面工作区里(`desktop` 属性)。
 * 手机、安卓双栏、手机浏览器里的 web 导出都是 false。
 *
 * 安卓 UA 先判(与 chooseAppLayout 同一顺序):Tauri 桌面 webview 从不带安卓 UA,而 web 导出的测量夹具
 * 用 Tauri 桥桩 + 安卓 UA 模拟手机 —— 那是手指,不是鼠标。iPad UA 同理(iPad 横屏双栏的夹具)。
 */
export const pointerUi = (desktopLayout?: boolean): boolean => {
  if (desktopLayout) return true;
  if (!isTauriShell()) return false;
  const ua = String((globalThis as { navigator?: { userAgent?: string } }).navigator?.userAgent ?? '');
  return !isAndroidLike('web', ua) && !isIPadLike('web', false, ua);
};
