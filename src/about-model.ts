// 关于页(管理员 2026-11-14「感觉这个页面也很难看」重排)的纯逻辑。
// 平台名:桌面端是 Tauri 包着的 react-native-web,Platform.OS 恒为 'web' —— 以前 Mac 上关于页写「v0.2.533 · Web」,
// 截图报问题时看不出是哪个端。Tauri 下按 UA 认 macOS / Windows / Linux;真浏览器仍是 Web。
export function aboutPlatformLabel(os: string, tauri: boolean, userAgent = ''): string {
  if (os === 'ios') return 'iOS';
  if (os === 'android') return 'Android';
  if (os !== 'web') return os;
  if (/\bAndroid\b/i.test(userAgent)) return 'Android Web';
  if (!tauri) return 'Web';
  if (/Mac OS X|Macintosh/i.test(userAgent)) return 'macOS';
  if (/Windows/i.test(userAgent)) return 'Windows';
  if (/Linux|X11/i.test(userAgent)) return 'Linux';
  return 'Desktop';
}

/** 复制类行点了要有回执:哪一行刚复制过、多久后消失。 */
export const COPIED_FLASH_MS = 1600;
