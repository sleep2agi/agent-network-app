/**
 * 更新弹窗(安卓 / 桌面)要显示的文字 —— 纯函数,ck 测试直接跑;组件只负责摆放。
 * 「当前版本 vX → 新版本 vY」、大小、进度、失败提示都从这里出。下载来源是内部细节,这里一个字都不写。
 */
import type { AndroidUpdateState } from './android-update-core';
import type { DesktopUpdateState } from './update-check-state';
import { formatProgressBytes, formatSize } from './update-route';

const plain = (v: string | undefined) => String(v ?? '').replace(/^(?:desktop-)?v/, '');

export type VersionLine = { current?: string; next: string };
export const versionLine = (current: string | undefined, next: string): VersionLine =>
  ({ current: current ? `v${plain(current)}` : undefined, next: `v${plain(next)}` });

export type AndroidPromptView = {
  title: string;
  versions: VersionLine;
  /** 「77.0 MB」;大小未知就空 */
  meta: string;
  /** 下载中那一行:「正在下载 · 12.3 / 77.0 MB · 16%」 */
  progressLine?: string;
  /** 同一份进度拆开给进度条用:百分比(未知 = 不确定进度)、「12.3 / 77.0 MB」、是否在校验 */
  progress?: DownloadProgressView;
  /** 下载失败:一句话 +(只在不是网络问题时)一句原因 */
  errorTitle?: string;
  errorDetail?: string;
  primary?: { label: string; action: 'download' | 'retry' | 'install' };
  showOpenSettings: boolean;
  showLater: boolean;
};

export type DownloadProgressView = { percent?: number; bytes?: string; verifying: boolean };
const clampPercent = (p: number | undefined) => (p == null || !Number.isFinite(p) ? undefined : Math.max(0, Math.min(100, Math.round(p))));

/** 下载失败的统一说法。下载来源/切换/每个来源的原因都是内部细节,不展示(Vincent 2026-09-26)。 */
export const DOWNLOAD_FAILED_TITLE = '下载失败，请检查网络后重试';
/** 换网络也没用、用户需要知道的本机原因(存储满、校验不过)才多写一句。 */
const LOCAL_REASON = /存储空间|sha256/;

export function androidPromptView(state: AndroidUpdateState, opts: { currentVersion: string }): AndroidPromptView | null {
  if (!('apk' in state)) return null;
  const view: AndroidPromptView = {
    title: state.kind === 'ready' ? '安装新版本' : '发现新版本',
    versions: versionLine(opts.currentVersion, state.version),
    meta: formatSize(state.apk.size) ?? '',
    showOpenSettings: state.kind === 'ready' && state.installAttempted,
    showLater: state.kind !== 'downloading',
  };
  switch (state.kind) {
    case 'available':
      view.primary = { label: '立即更新', action: 'download' };
      break;
    case 'downloading': {
      if (state.verifying) {
        view.progressLine = '正在校验安装包（sha256）…';
        view.progress = { verifying: true };
      } else {
        const bytes = formatProgressBytes(state.written, state.total ?? state.apk.size);
        const pct = state.percent == null ? undefined : `${state.percent}%`;
        view.progressLine = ['正在下载', bytes, pct].filter(Boolean).join(' · ');
        view.progress = { percent: clampPercent(state.percent), bytes, verifying: false };
      }
      break;
    }
    case 'download-error':
      view.errorTitle = DOWNLOAD_FAILED_TITLE;
      if (LOCAL_REASON.test(state.message)) view.errorDetail = state.message;
      view.primary = { label: '重试', action: 'retry' };
      break;
    case 'ready':
      view.primary = { label: state.installAttempted ? '重新安装' : '安装', action: 'install' };
      break;
  }
  return view;
}

export type DesktopPromptView = {
  versions: VersionLine;
  progressLine?: string;
  progress?: DownloadProgressView;
};

export function desktopPromptView(state: DesktopUpdateState, fallbackCurrent: string): DesktopPromptView | null {
  if (state.kind !== 'available' && state.kind !== 'downloading') return null;
  const view: DesktopPromptView = {
    versions: versionLine(state.currentVersion ?? fallbackCurrent, state.version),
  };
  if (state.kind === 'downloading') {
    const bytes = formatProgressBytes(state.downloaded, state.total);
    const pct = state.percent == null ? undefined : `${state.percent}%`;
    view.progressLine = ['正在下载安装…', bytes, pct].filter(Boolean).join(' · ');
    view.progress = { percent: clampPercent(state.percent), bytes, verifying: false };
  }
  return view;
}

/**
 * 哪个窗口挂桌面更新弹窗、挂成什么样(owner 0.2.145:设置独立成窗 #483 后,「关于 → 软件更新」
 * 显示「发现新版本 · 点击查看并安装」,点了没有任何反应 —— 设置窗不挂弹窗,而检查结果只存在于
 * 设置窗自己的 JS 上下文里,主窗口看不见)。
 *   'auto'   主窗口(及没有桌面壳的 web):启动 2.5s 后自动检查,有新版本就弹。
 *   'manual' 设置窗:不自动检查;只在**本窗口里手动点**检查、查到新版本时弹(安装也在这里完成)。
 *   null     分离聊天窗 / 多开工作区窗:不挂 —— 否则每个窗各弹一次(2026-09-06 截图)。
 */
export type DesktopPromptMode = 'auto' | 'manual' | null;
export function desktopPromptMode(win: { tauri: boolean; chat: boolean; workspace: boolean; settings: boolean }): DesktopPromptMode {
  if (!win.tauri) return 'auto';
  if (win.chat || win.workspace) return null;
  if (win.settings) return 'manual';
  return 'auto';
}

/** 弹窗开不开:有新版本/下载中才开;manual 模式另要求这次结果来自用户手动点的检查。 */
export function desktopPromptVisible(state: DesktopUpdateState, opts: { mode: Exclude<DesktopPromptMode, null>; fromManualCheck: boolean }): boolean {
  if (state.kind !== 'available' && state.kind !== 'downloading') return false;
  return opts.mode === 'auto' || opts.fromManualCheck;
}
