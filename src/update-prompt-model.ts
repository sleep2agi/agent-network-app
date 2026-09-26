/**
 * 更新弹窗(安卓 / 桌面)要显示的文字 —— 纯函数,ck 测试直接跑;组件只负责摆放。
 * 「当前版本 vX → 新版本 vY」、线路、大小、进度、自动切换线路的说明、每条线路失败的原因都从这里出。
 */
import type { AndroidUpdateState, RouteAttempt } from './android-update-core';
import type { DesktopUpdateState } from './update-check-state';
import { ROUTE_LABEL, ROUTE_SHORT, formatProgressBytes, formatSize, type UpdateRoute } from './update-route';

const plain = (v: string | undefined) => String(v ?? '').replace(/^(?:desktop-)?v/, '');

export type VersionLine = { current?: string; next: string };
export const versionLine = (current: string | undefined, next: string): VersionLine =>
  ({ current: current ? `v${plain(current)}` : undefined, next: `v${plain(next)}` });

export type AndroidPromptView = {
  title: string;
  versions: VersionLine;
  /** 「77.0 MB · 线路一（国内 · ModelScope）」 */
  meta: string;
  /** 线路选择能不能点(下载中/校验中不能换) */
  routePickerEnabled: boolean;
  /** 首选失败、已自动切到另一条:一句说明 */
  fallbackNotice?: string;
  /** 下载中那一行:「线路一 · 12.3 / 77.0 MB · 16%」 */
  progressLine?: string;
  /** 下载失败:标题一句 + 每条线路一行原因 */
  errorTitle?: string;
  attemptLines: string[];
  primary?: { label: string; action: 'download' | 'retry' | 'install' };
  showOpenSettings: boolean;
  showLater: boolean;
};

export const attemptLine = (a: RouteAttempt) => `${ROUTE_SHORT[a.route]}：${a.reason}`;

export function androidPromptView(state: AndroidUpdateState, opts: { currentVersion: string; route: UpdateRoute }): AndroidPromptView | null {
  if (!('apk' in state)) return null;
  const size = formatSize(state.apk.size);
  const activeRoute = state.kind === 'downloading' && state.route ? state.route : state.kind === 'ready' && state.route ? state.route : opts.route;
  const meta = [size, ROUTE_LABEL[activeRoute]].filter(Boolean).join(' · ');
  const view: AndroidPromptView = {
    title: state.kind === 'ready' ? '安装新版本' : '发现新版本',
    versions: versionLine(opts.currentVersion, state.version),
    meta,
    routePickerEnabled: state.kind === 'available' || state.kind === 'download-error',
    attemptLines: [],
    showOpenSettings: state.kind === 'ready' && state.installAttempted,
    showLater: state.kind !== 'downloading',
  };
  switch (state.kind) {
    case 'available':
      view.primary = { label: '下载并安装', action: 'download' };
      break;
    case 'downloading': {
      if (state.fallbackFrom && state.route) {
        view.fallbackNotice = `${ROUTE_SHORT[state.fallbackFrom.route]}下载失败：${state.fallbackFrom.reason}。已自动切换到${ROUTE_SHORT[state.route]}`;
      }
      const route = state.route ? ROUTE_SHORT[state.route] : undefined;
      if (state.verifying) {
        view.progressLine = [route, '正在校验安装包（sha256）…'].filter(Boolean).join(' · ');
      } else {
        const bytes = formatProgressBytes(state.written, state.total ?? state.apk.size);
        const pct = state.percent == null ? undefined : `${state.percent}%`;
        view.progressLine = [route ? `正在通过${route}下载` : '正在下载', bytes, pct].filter(Boolean).join(' · ');
      }
      break;
    }
    case 'download-error':
      view.attemptLines = (state.attempts ?? []).map(attemptLine);
      // 两条都试过 → 「两条线路都下载失败」+ 各自原因;只试了一条(停滞等) → 直接写原因,不重复。
      view.errorTitle = view.attemptLines.length > 1 ? '两条线路都下载失败' : `下载失败：${state.message}`;
      if (view.attemptLines.length === 1) view.attemptLines = [];
      view.primary = { label: '重试下载', action: 'retry' };
      break;
    case 'ready':
      view.primary = { label: state.installAttempted ? '重新安装' : '安装', action: 'install' };
      break;
  }
  return view;
}

export type DesktopPromptView = {
  versions: VersionLine;
  /** 「更新来源：线路一（国内 · ModelScope）」;来源认不出就不写 */
  sourceLine?: string;
  progressLine?: string;
};

export function desktopPromptView(state: DesktopUpdateState, fallbackCurrent: string): DesktopPromptView | null {
  if (state.kind !== 'available' && state.kind !== 'downloading') return null;
  const view: DesktopPromptView = {
    versions: versionLine(state.currentVersion ?? fallbackCurrent, state.version),
    sourceLine: state.source ? `更新来源：${ROUTE_LABEL[state.source]}` : undefined,
  };
  if (state.kind === 'downloading') {
    const bytes = formatProgressBytes(state.downloaded, state.total);
    const pct = state.percent == null ? undefined : `${state.percent}%`;
    view.progressLine = ['正在下载安装…', bytes, pct].filter(Boolean).join(' · ');
  }
  return view;
}
