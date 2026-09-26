// 定时任务里各个 Modal 的安全区垫子(2026-09-26 owner 展开的折叠屏截图:新建定时任务的
// 「取消 / 新建定时任务 / 保存」那一行画在 Android 状态栏底下,「取消」压着时钟)。
//
// 根因与 #387(规则文件全屏)同一个:Expo 56 / RN 0.85 在 Android 上默认 edge-to-edge,Modal 是另一个
// 窗口,恒画到状态栏 / 挖孔底下;App 根 View 的那层垫子不在 Modal 里。`presentationStyle="pageSheet"`
// 在 Android 上被忽略 ⇒ 就是一个全屏窗口。所以这里**直接复用** rulesFullscreenPadding(同一张判定表、
// 同一个 StatusBar.currentHeight 兜底),只多回答一个它不需要回答的问题:
//
//   iOS pageSheet —— 系统把 sheet 画在状态栏下面、顶上还留一截,sheet 内容的顶边本来就是安全的;
//   而 useSafeAreaInsets() 读到的是根窗口的安全区(刘海 47),照抄会在 sheet 顶上再空出一大截。
//   ⇒ iOS pageSheet 顶边 0,其余三边照旧(sheet 贴到屏幕底,Home 指示条仍要让)。
//
//   overlay(透明底部 sheet / 居中对话框)—— 内容不会顶到屏幕顶端,顶边 0;底边 / 左右照旧。

import { rulesFullscreenPadding, type EdgeInsets, type FullscreenPadding } from './rules-fullscreen-layout';

export type ModalKind = 'fullScreen' | 'pageSheet' | 'overlay';

export function modalSafePadding(
  os: string,
  kind: ModalKind,
  insets: Partial<EdgeInsets> | null | undefined,
  statusBarHeight?: number | null,
): FullscreenPadding {
  const p = rulesFullscreenPadding(os, insets, statusBarHeight);
  if (kind === 'overlay' || (kind === 'pageSheet' && os === 'ios')) return { ...p, paddingTop: 0 };
  return p;
}
