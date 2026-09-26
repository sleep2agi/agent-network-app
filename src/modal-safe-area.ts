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

//
// ═══ THE SAFE-AREA RULE (app-wide, 2026-09-26 sweep) ═══════════════════════════════════════════
// Every inset is applied exactly ONCE, by whoever owns the window edge:
//
//  1. Main window — the App.tsx root applies the top inset (mainWindowPadding below; iOS: the
//     root SafeAreaView). Left/right: the Android rail takes the left, navContent the right (and
//     both sides on the phone stack). Bottom: the tab bar / rail / chat composer when present,
//     otherwise the pane or navContent container. Screens and panes rendered inside it must NOT
//     add any of these again — no insets.top, no StatusBar.currentHeight, no reuse of a root style
//     that pads (0.2.118 节点信息 double inset: NodeDetailScreen / LogsScreen reused app-styles'
//     `root`, which carried the status-bar padding, so the right pane got it twice).
//  2. Modals — a Modal is a separate native window drawn edge-to-edge on Android, so the root's
//     padding is not in it: every <Modal> subtree applies useModalSafePadding(kind)
//     (safe-area-runtime.ts → modalSafePadding here) once — on its root view, or, for sheets /
//     drawers whose backdrop should dim the whole window, on the panel.
//  3. Web / Tauri desktop: all insets are 0; MacTitleStrip / WinTitleBar own the top.
//
// Guarded by src/safe-area-rule.test.ts (static) and tests/test-layout-sweep/run.mjs (measured).

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

/**
 * Main-window root top padding (rule 1). Android: the status bar (safe-area top, with
 * StatusBar.currentHeight as the fallback when the context reads 0). iOS: 0 — the root
 * SafeAreaView already pads it. Web / desktop: 0.
 */
export function mainWindowTopPadding(os: string, insets: Partial<EdgeInsets> | null | undefined, statusBarHeight?: number | null): number {
  return os === 'android' ? rulesFullscreenPadding(os, insets, statusBarHeight).paddingTop : 0;
}

/**
 * Inset + the view's own spacing, per edge. For a centred dialog's backdrop that already has
 * `padding: N`: spreading the inset over it would REPLACE N (and with a 0 inset, drop the margin).
 */
export function withBasePadding(p: FullscreenPadding, base: number): FullscreenPadding {
  return { paddingTop: p.paddingTop + base, paddingRight: p.paddingRight + base, paddingBottom: p.paddingBottom + base, paddingLeft: p.paddingLeft + base };
}
