// 在系统浏览器里打开一个外部链接 —— 全 app 唯一的出口(src/open-external.test.ts 静态守着:
// 别处不许直接 Linking.openURL / window.open / plugin-opener 的 openUrl)。
//
// 0.2.123 桌面端(Vincent 截图:设置 → 语音输入 的「火山引擎控制台」点了没反应):那里直接调了
// Linking.openURL。RN-web 的 Linking.openURL 就是 window.open(url, '_blank'),而 Tauri 的
// WKWebView / WebView2 不开新窗口 —— 静默什么都不发生。聊天里的 Markdown 链接早就走 Tauri opener,
// 所以只有「另写了一处」的那个坏了。按类修:一个 helper,三条路:
//
//   desktop(Tauri 壳)→ @tauri-apps/plugin-opener 的 openUrl(capabilities 里 opener:allow-open-url
//                        已放行 http(s)://**)
//   web(浏览器)       → window.open(url, '_blank', 'noopener')
//   native(iOS/安卓)  → Linking.openURL
//
// 纯逻辑可单测:依赖全部懒加载,测试注入替身。只放行 http(s),别的 scheme 一律不开。

export type ExternalRoute = 'tauri' | 'window' | 'linking';

export type OpenExternalDeps = {
  tauri: boolean;
  os: string;
  tauriOpen: (url: string) => Promise<unknown>;
  windowOpen: ((url: string, target: string, features: string) => unknown) | null;
  linkingOpen: (url: string) => Promise<unknown>;
};

export const isExternalHttpUrl = (url: string): boolean => /^https?:\/\/[^\s]+$/i.test(url.trim());

export function externalRoute(os: string, tauri: boolean): ExternalRoute {
  if (tauri) return 'tauri';
  if (os === 'web') return 'window';
  return 'linking';
}

let testDeps: OpenExternalDeps | undefined;
/** 测试用:注入平台与三条路的替身;传 undefined 还原。 */
export function __setOpenExternalDeps(next: OpenExternalDeps | undefined): void { testDeps = next; }

// 同步组装:网页那条路必须在点击的同一个调用栈里 window.open(Safari 对「用户手势」卡得严,
// 先 await 一个 import 再开窗会被当成弹窗拦掉)。所以平台判定不经 react-native 的 Platform
// (那要 await import),而是看有没有 document —— RN 原生没有 document,RN-web / Tauri 有。
function realDeps(): OpenExternalDeps {
  const g = globalThis as { __TAURI_INTERNALS__?: unknown; document?: unknown; open?: (url: string, target: string, features: string) => unknown };
  return {
    tauri: !!g.__TAURI_INTERNALS__,
    os: typeof g.document !== 'undefined' ? 'web' : 'native',
    tauriOpen: async url => { const { openUrl } = await import('@tauri-apps/plugin-opener'); return openUrl(url); },
    windowOpen: typeof g.open === 'function' ? (url, target, features) => g.open!(url, target, features) : null,
    linkingOpen: async url => { const { Linking } = await import('react-native'); return Linking.openURL(url); },
  };
}

/** 打开成功(已交给系统)返回 true;不是 http(s) 或无路可走返回 false。失败照常抛给调用方。 */
export async function openExternal(url: string): Promise<boolean> {
  const target = url.trim();
  if (!isExternalHttpUrl(target)) return false;
  const d = testDeps ?? realDeps();
  const route = externalRoute(d.os, d.tauri);
  if (route === 'tauri') { await d.tauriOpen(target); return true; }
  if (route === 'window') {
    if (!d.windowOpen) return false;
    d.windowOpen(target, '_blank', 'noopener');
    return true;
  }
  await d.linkingOpen(target);
  return true;
}
