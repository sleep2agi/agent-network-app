/**
 * 安卓更新的下载来源(内部概念,不对用户展示 —— Vincent 2026-09-26「客户端里面标那么多线路一线路二干嘛」)。
 *
 *   mirror = 国内 ModelScope 镜像(默认)   desktop/<ver>/Agent.Network_<ver>_android-universal.apk
 *   github = GitHub Releases 直链           releases/download/desktop-v<ver>/Agent.Network_<ver>_android-universal.apk
 *
 * 两边的安装包逐字节相同(modelscope-mirror 按 GitHub 资产的 sha256 同步),同一个期望 sha256 两边都能校验。
 *
 * 规则(全自动,用户没有可选项):
 *   - 先走「本机上次下载成功的来源」;没有记录时,检查阶段是 GitHub 回答的(镜像不通)就先走 GitHub,否则先走镜像;
 *     另一个来源自动兜底。
 *   - 下载成功才记「上次成功来源」。
 *   - 0.2.121 曾有「下载线路」偏好(自动/线路一/线路二):已存的值一律忽略,并在读取时静默删掉。
 */
import { apkCacheFileName, githubApkUrl, mirrorApkUrl } from './android-update-core';

export type UpdateRoute = 'mirror' | 'github';

export const UPDATE_ROUTES: readonly UpdateRoute[] = ['mirror', 'github'];

export function parseRoute(raw: unknown): UpdateRoute | null {
  return raw === 'mirror' || raw === 'github' ? raw : null;
}
export const otherRoute = (r: UpdateRoute): UpdateRoute => (r === 'mirror' ? 'github' : 'mirror');

/**
 * 本次下载依次尝试的来源(总是两个,首选在前):
 *   1. `lastGood`   本机上次下载成功的来源;
 *   2. `checkRoute` 没有记录时:回答这次检查的那个(镜像检查失败、GitHub 回答的 → 先走 GitHub,
 *      不先去撞一个刚刚就没连上的镜像);
 *   3. 镜像。
 */
export function routeOrder(lastGood: UpdateRoute | null, checkRoute?: UpdateRoute | null): [UpdateRoute, UpdateRoute] {
  const first: UpdateRoute = lastGood ?? checkRoute ?? 'mirror';
  return [first, otherRoute(first)];
}

/** 带版本号的安装包直链(不用 desktop/latest/ 下那份会被替换的副本)。0.2.100+ 三位 patch 原样拼。 */
export function apkUrlFor(route: UpdateRoute, version: string): string {
  return route === 'mirror' ? mirrorApkUrl(version) : githubApkUrl(version);
}

/**
 * 某个来源上这一版的下载地址。
 * GitHub 那条若 release 里挂的是别的 APK 名(没有 universal、退回同版本任意 .apk),就用 release 给的原地址;
 * 镜像只同步 universal 包,那时镜像没有这个文件 → null(跳过,不去 404)。
 */
export function apkUrlForAsset(route: UpdateRoute, version: string, apk: { name: string; url: string; source?: UpdateRoute }): string | null {
  const universal = apk.name === apkCacheFileName(version);
  if (route === 'github') return universal ? githubApkUrl(version) : apk.source === 'github' ? apk.url : null;
  return universal ? mirrorApkUrl(version) : null;
}

/** `12.3 / 77.0 MB`;不知道总大小时只写已下载。 */
export function formatProgressBytes(written: number | undefined, total: number | undefined): string | undefined {
  const mb = (n: number) => (n / 1024 / 1024).toFixed(1);
  if (total && total > 0) return `${mb(Math.min(written ?? 0, total))} / ${mb(total)} MB`;
  if (written && written > 0) return `${mb(written)} MB`;
  return undefined;
}

export const formatSize = (bytes: number | undefined): string | undefined =>
  bytes && bytes > 0 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : undefined;

// ── 偏好 store(按设备,不按 hub 账号)──────────────────────────────────────────

/** 0.2.121 的「下载线路」偏好。已废弃:读到就删,从不使用。 */
export const LEGACY_ROUTE_PREF_KEY = 'update_route_pref_v1';
export const ROUTE_LAST_OK_KEY = 'update_route_last_ok_v1';

export type RouteStorage = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove?(key: string): Promise<void>;
};
export type RoutePrefsSnapshot = { lastGood: UpdateRoute | null };

/** 内存后端(测试、以及存不下时的兜底)。 */
export function memoryRouteStorage(initial: Record<string, string> = {}): RouteStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, get: async k => data[k] ?? null, set: async (k, v) => { data[k] = v; }, remove: async k => { delete data[k]; } };
}

export function createRoutePrefsStore(storage: RouteStorage) {
  let snap: RoutePrefsSnapshot = { lastGood: null };
  let hydrated: Promise<void> | undefined;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach(l => l());
  const set = (next: Partial<RoutePrefsSnapshot>) => { snap = { ...snap, ...next }; emit(); };
  return {
    snapshot: () => snap,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    /** 读一次存储;失败就保持默认(无记录)。旧的「下载线路」偏好静默删掉。多次调用共用同一次读取。 */
    hydrate(): Promise<void> {
      hydrated ??= (async () => {
        const [legacy, last] = await Promise.all([
          storage.get(LEGACY_ROUTE_PREF_KEY).catch(() => null),
          storage.get(ROUTE_LAST_OK_KEY).catch(() => null),
        ]);
        if (legacy != null) await storage.remove?.(LEGACY_ROUTE_PREF_KEY).catch(() => undefined);
        set({ lastGood: parseRoute(last) });
      })();
      return hydrated;
    },
    async recordSuccess(route: UpdateRoute) {
      if (snap.lastGood === route) return;
      set({ lastGood: route });
      await storage.set(ROUTE_LAST_OK_KEY, route).catch(() => undefined);
    },
  };
}
export type RoutePrefsStore = ReturnType<typeof createRoutePrefsStore>;
