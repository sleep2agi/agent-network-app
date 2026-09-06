// 桌面端(Tauri)附件落盘。Vincent 2026-09-07「点击了没反应」:
//   - 非图片附件在桌面端只画了「📎 名字」,没有点击动作;
//   - 图片的「下载原图」走 <a download>,WKWebView / WebView2 不会真的下载。
// 现在:前端带 Bearer 取字节 → base64 → Rust `save_download` 写进系统「下载」目录 → 返回路径,
// 再用 opener 在访达/资源管理器里定位。凭据只用于取字节,不进 DOM、不进下载管理器。
export type AuthedFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function downloadAuthedBytes(fetcher: AuthedFetch, url: string, token: string): Promise<Uint8Array> {
  const response = await fetcher(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length) throw new Error('空文件');
  return bytes;
}

export const isTauriDesktop = (): boolean => !!(globalThis as any).__TAURI_INTERNALS__;

/** 写进系统「下载」目录,返回落盘路径。只在 Tauri 桌面端可用。 */
export async function saveToDownloads(name: string, bytes: Uint8Array): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('save_download', { name, bytesBase64: bytesToBase64(bytes) });
}

export async function revealInFolder(path: string): Promise<void> {
  const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
  await revealItemInDir(path);
}

/** 从「下载」目录路径里取给人看的短名(~/Downloads/x.pdf)。 */
export function displayDownloadPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length >= 2 ? `…/${parts.slice(-2).join('/')}` : path;
}
