// 更新日志的数据来源(见 changelog-model.ts 文件头):内置正文(随包,离线也有本版)+ 本机缓存 + 网上最新正文。
//
// 网上只拉两份累积正文,不按版本拉 N 个文件:
//   镜像  desktop/latest/VERSION → desktop/<ver>/latest.json(notes + pub_date)  —— 国内快,和检查更新同一处
//   GitHub  releases?per_page=100  —— 最新一条的正文 + 每一版的发布时间(列表一次拿全);国内可能慢/被限流,只当补充
// 两个并行、各自超时,谁失败都不挡页面:合并「网上 → 缓存 → 内置」(前面的赢),成功拿到任何一份就写回缓存。
//
// 存储同 update-route-prefs.ts:web / Tauri 桌面壳 → localStorage;原生 → documentDirectory 下一个 JSON 文件
// (expo-file-system 惰性 import,ck 测试里加载得了这个文件)。
import { appFetch } from './app-fetch';
import { MIRROR_VERSION_URL, compareVersions, mirrorManifestUrl, parseMirrorVersion } from './android-update-core';
import { BUNDLED_RELEASE_BODY, BUNDLED_RELEASE_DATES } from './changelog-bundled';
import {
  datesFromGithubReleases, entriesFromBody, mergeChangelog, newestGithubBody, parseChangelogCache, serializeChangelogCache,
  type ChangelogEntry,
} from './changelog-model';

export const CHANGELOG_CACHE_KEY = 'anet.changelog.v1';
const FILE_NAME = 'changelog_cache_v1.json';
export const GITHUB_RELEASES_LIST_API = 'https://api.github.com/repos/sleep2agi/agent-network-app/releases?per_page=100';
const TIMEOUT_MS = 10_000;

export type ChangelogStorage = { get(): Promise<string | null>; set(value: string): Promise<void> };

const webStorage = (): Storage | null => {
  try {
    const ls = (globalThis as any).localStorage as Storage | undefined;
    return ls && typeof ls.getItem === 'function' ? ls : null;
  } catch { return null; }
};

async function nativeFs(): Promise<any | null> {
  try {
    const FileSystem = await import('expo-file-system/legacy');
    return FileSystem.documentDirectory ? FileSystem : null;
  } catch { return null; }
}

export const deviceChangelogStorage: ChangelogStorage = {
  async get() {
    const ls = webStorage();
    if (ls) { try { return ls.getItem(CHANGELOG_CACHE_KEY); } catch { return null; } }
    const FileSystem = await nativeFs();
    if (!FileSystem) return null;
    try {
      const path = `${FileSystem.documentDirectory}${FILE_NAME}`;
      return (await FileSystem.getInfoAsync(path)).exists ? await FileSystem.readAsStringAsync(path) : null;
    } catch { return null; }
  },
  async set(value) {
    const ls = webStorage();
    if (ls) { try { ls.setItem(CHANGELOG_CACHE_KEY, value); } catch { /* 本次有效 */ } return; }
    const FileSystem = await nativeFs();
    if (!FileSystem) return;
    try { await FileSystem.writeAsStringAsync(`${FileSystem.documentDirectory}${FILE_NAME}`, value); } catch { /* 本次有效 */ }
  },
};

async function text(fetchImpl: typeof fetch, url: string, init: RequestInit = {}): Promise<string> {
  const controller = typeof AbortController === 'function' ? new AbortController() : undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const res = await fetchImpl(url, { ...init, signal: controller?.signal });
        if (!res.ok) throw new Error(`${res.status}`);
        return await res.text();
      })(),
      new Promise<string>((_, reject) => { timer = setTimeout(() => { controller?.abort(); reject(new Error('timeout')); }, TIMEOUT_MS); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

type Remote = { body: string; version: string; dates: Record<string, string> };

async function fromMirror(fetchImpl: typeof fetch): Promise<Remote | null> {
  const version = parseMirrorVersion(await text(fetchImpl, MIRROR_VERSION_URL, { headers: { 'Cache-Control': 'no-cache' } }));
  if (!version) return null;
  const m = JSON.parse(await text(fetchImpl, mirrorManifestUrl(version)));
  if (!m || typeof m.notes !== 'string') return null;
  const dates: Record<string, string> = {};
  if (typeof m.pub_date === 'string' && !Number.isNaN(Date.parse(m.pub_date))) dates[version] = m.pub_date;
  return { body: m.notes, version, dates };
}

async function fromGithub(fetchImpl: typeof fetch): Promise<Remote | null> {
  const list = JSON.parse(await text(fetchImpl, GITHUB_RELEASES_LIST_API, { headers: { Accept: 'application/vnd.github+json' } }));
  const newest = newestGithubBody(list);
  const dates = datesFromGithubReleases(list);
  return newest ? { ...newest, dates } : Object.keys(dates).length ? { body: '', version: '0.0.0', dates } : null;
}

export type ChangelogLoad = {
  entries: ChangelogEntry[];
  /** 这次有没有从网上拿到任何一份(false = 只有缓存 + 内置,页面显示「离线」小字) */
  online: boolean;
};

/** 不联网:缓存 + 内置。页面先用它立刻画出来。 */
export async function loadCachedChangelog(storage: ChangelogStorage = deviceChangelogStorage): Promise<ChangelogEntry[]> {
  const cached = parseChangelogCache(await storage.get().catch(() => null));
  return mergeChangelog([cached, entriesFromBody(BUNDLED_RELEASE_BODY)], BUNDLED_RELEASE_DATES);
}

/** 联网刷新(失败的来源静默跳过),合并后写回缓存。 */
export async function refreshChangelog(opts: { fetchImpl?: typeof fetch; storage?: ChangelogStorage } = {}): Promise<ChangelogLoad> {
  const fetchImpl = opts.fetchImpl ?? appFetch;
  const storage = opts.storage ?? deviceChangelogStorage;
  const [mirror, github, cached] = await Promise.all([
    fromMirror(fetchImpl).catch(() => null),
    fromGithub(fetchImpl).catch(() => null),
    storage.get().catch(() => null).then(parseChangelogCache),
  ]);
  const remotes = [mirror, github].filter((r): r is Remote => !!r)
    .sort((a, b) => compareVersions(b.version, a.version) ?? 0);
  const dates = { ...BUNDLED_RELEASE_DATES, ...github?.dates, ...mirror?.dates };
  const entries = mergeChangelog([
    ...remotes.map(r => entriesFromBody(r.body)),
    cached,
    entriesFromBody(BUNDLED_RELEASE_BODY),
  ], dates);
  const online = remotes.length > 0;
  if (online && entries.length) await storage.set(serializeChangelogCache(entries)).catch(() => undefined);
  return { entries, online };
}
