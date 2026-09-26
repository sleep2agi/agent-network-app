/**
 * 安卓更新的「下载线路」(Vincent 2026-09-26「在检查更新处也要更新一下…版本号…线路一、线路二」)。
 *
 *   线路一 = 国内 ModelScope 镜像(默认、推荐)   desktop/<ver>/Agent.Network_<ver>_android-universal.apk
 *   线路二 = GitHub Releases 直链                 releases/download/desktop-v<ver>/Agent.Network_<ver>_android-universal.apk
 *
 * 两条线路上的安装包逐字节相同(modelscope-mirror 按 GitHub 资产的 sha256 同步),所以同一个期望 sha256
 * 两边都能校验。这里只有纯逻辑 + 一个可注入存储后端的小 store;原生读写在 update-route-prefs.ts。
 *
 * 规则:
 *   - 偏好 `auto`(默认):先走「本机上次成功的线路」,没有记录就先走线路一;另一条自动兜底。
 *   - 偏好 `mirror` / `github`:先走指定线路,另一条仍然自动兜底(失败时弹窗里写明「已切换到线路二」)。
 *     指定线路 ≠ 只许走这一条:下载失败时让用户手动再选一次,比直接换条路更慢、也更让人困惑。
 *   - 下载成功才记「上次成功线路」;检查阶段用了哪条只用来在设置页显示。
 */
import { ROUTE_SHORT_NAME, apkCacheFileName, githubApkUrl, mirrorApkUrl } from './android-update-core';

export type UpdateRoute = 'mirror' | 'github';
export type RoutePreference = 'auto' | UpdateRoute;

export const UPDATE_ROUTES: readonly UpdateRoute[] = ['mirror', 'github'];
export const ROUTE_PREFERENCES: readonly RoutePreference[] = ['auto', 'mirror', 'github'];

/** 弹窗/设置里完整的线路名。 */
export const ROUTE_LABEL: Record<UpdateRoute, string> = {
  mirror: '线路一（国内 · ModelScope）',
  github: '线路二（GitHub）',
};
/** 一行放不下时的短名。 */
export const ROUTE_SHORT: Record<UpdateRoute, string> = ROUTE_SHORT_NAME;
export const ROUTE_PREFERENCE_LABEL: Record<RoutePreference, string> = { auto: '自动', mirror: '线路一', github: '线路二' };

export function parseRoute(raw: unknown): UpdateRoute | null {
  return raw === 'mirror' || raw === 'github' ? raw : null;
}
/** 认不出的值(旧版本、手改、损坏)一律当 auto —— 偏好坏了不能让更新失败。 */
export function parseRoutePreference(raw: unknown): RoutePreference {
  return raw === 'mirror' || raw === 'github' ? raw : 'auto';
}

export const otherRoute = (r: UpdateRoute): UpdateRoute => (r === 'mirror' ? 'github' : 'mirror');

/**
 * 本次下载依次尝试的线路(总是两条,首选在前)。优先级:
 *   1. `chosen`   用户在弹窗里点选的线路(只对这一次更新有效);
 *   2. `pref`     设置 → 关于 → 下载线路(非 auto 时);
 *   3. `lastGood` auto:本机上次下载成功的线路;
 *   4. `checkRoute` auto 且没有记录:回答这次检查的那条(镜像检查失败、GitHub 回答的 → 先走 GitHub,
 *      不先去撞一个刚刚就没连上的镜像);
 *   5. 线路一。
 */
export function routeOrder(
  pref: RoutePreference,
  lastGood: UpdateRoute | null,
  chosen?: UpdateRoute | null,
  checkRoute?: UpdateRoute | null,
): [UpdateRoute, UpdateRoute] {
  const first: UpdateRoute = chosen ?? (pref !== 'auto' ? pref : lastGood ?? checkRoute ?? 'mirror');
  return [first, otherRoute(first)];
}

/** 检查更新时先问哪条。只有明确选了线路二才先打 GitHub REST(未登录每 IP 每小时 60 次,见 android-updater.ts)。 */
export const checkOrder = (pref: RoutePreference): [UpdateRoute, UpdateRoute] => (pref === 'github' ? ['github', 'mirror'] : ['mirror', 'github']);

/** 设置 → 关于 → 下载线路 下面那行说明。 */
export function routePreferenceSummary(pref: RoutePreference, lastGood: UpdateRoute | null): string {
  if (pref === 'mirror') return `先走${ROUTE_LABEL.mirror},失败自动改用线路二`;
  if (pref === 'github') return `先走${ROUTE_LABEL.github},失败自动改用线路一`;
  return lastGood
    ? `自动:先走上次成功的${ROUTE_SHORT[lastGood]},失败自动换另一条`
    : '自动:默认先走线路一（国内 · ModelScope）,失败自动改用线路二（GitHub）';
}

/** 带版本号的安装包直链(不用 desktop/latest/ 下那份会被替换的副本)。0.2.100+ 三位 patch 原样拼。 */
export function apkUrlFor(route: UpdateRoute, version: string): string {
  return route === 'mirror' ? mirrorApkUrl(version) : githubApkUrl(version);
}

/**
 * 某条线路上这一版的下载地址。
 * GitHub 那条若 release 里挂的是别的 APK 名(没有 universal、退回同版本任意 .apk),就用 release 给的原地址;
 * 镜像只同步 universal 包,那时线路一没有这个文件 → null(跳过,不去 404)。
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

export const ROUTE_PREF_KEY = 'update_route_pref_v1';
export const ROUTE_LAST_OK_KEY = 'update_route_last_ok_v1';

export type RouteStorage = { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void> };
export type RoutePrefsSnapshot = { pref: RoutePreference; lastGood: UpdateRoute | null };

/** 内存后端(测试、以及存不下时的兜底)。 */
export function memoryRouteStorage(initial: Record<string, string> = {}): RouteStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, get: async k => data[k] ?? null, set: async (k, v) => { data[k] = v; } };
}

export function createRoutePrefsStore(storage: RouteStorage) {
  let snap: RoutePrefsSnapshot = { pref: 'auto', lastGood: null };
  let hydrated: Promise<void> | undefined;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach(l => l());
  const set = (next: Partial<RoutePrefsSnapshot>) => { snap = { ...snap, ...next }; emit(); };
  return {
    snapshot: () => snap,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    /** 读一次存储;失败就保持默认(auto / 无记录)。多次调用共用同一次读取。 */
    hydrate(): Promise<void> {
      hydrated ??= (async () => {
        const [pref, last] = await Promise.all([
          storage.get(ROUTE_PREF_KEY).catch(() => null),
          storage.get(ROUTE_LAST_OK_KEY).catch(() => null),
        ]);
        set({ pref: parseRoutePreference(pref), lastGood: parseRoute(last) });
      })();
      return hydrated;
    },
    async setPreference(pref: RoutePreference) {
      set({ pref: parseRoutePreference(pref) });
      await storage.set(ROUTE_PREF_KEY, snap.pref).catch(() => undefined);
    },
    async recordSuccess(route: UpdateRoute) {
      if (snap.lastGood === route) return;
      set({ lastGood: route });
      await storage.set(ROUTE_LAST_OK_KEY, route).catch(() => undefined);
    },
  };
}
export type RoutePrefsStore = ReturnType<typeof createRoutePrefsStore>;
