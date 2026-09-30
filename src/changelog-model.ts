/**
 * 设置 → 关于 → 更新日志(owner 2026-09-30「关于里面，我们是不是可以看看我之前的更新日志啊？那更新日志可以复制，
 * 方便我复制去发那个小红书啊，或者发那个公众号推文」)。纯函数,ck 测试直接跑。
 *
 * 数据:release 正文是**累积**的(release-desktop-auto-update.yml 的 releaseBody,每次发版在顶上加一段
 * 「What's new in X:」,旧段落全留着)。所以不按版本去拉 N 个文件:拿到任意一份正文就有全部历史,
 * parseReleaseNotes 拆成段、按版本去重。多份正文(内置 / 缓存 / 镜像 / GitHub)合并时,排在前面的来源赢
 * —— 调用方把最新的正文放最前(发版后改过措辞的旧段落以新正文为准)。
 *
 * 三种复制格式:小红书(emoji + 短行 + 话题)、公众号(标题 + 段落 + 编号列表)、纯文本。
 */
import { compareVersions } from './android-update-core';
import { parseReleaseNotes, type NoteKind, type NoteSection } from './release-notes';

export type ChangelogEntry = {
  /** 纯版本号「0.2.165」 */
  version: string;
  /** 发布时间(ISO);不知道就没有 */
  date?: string;
  sections: NoteSection[];
};

export type ChangelogFormat = 'xhs' | 'wechat' | 'plain';
export const CHANGELOG_FORMATS: readonly ChangelogFormat[] = ['xhs', 'wechat', 'plain'];
export const isChangelogFormat = (v: unknown): v is ChangelogFormat => typeof v === 'string' && (CHANGELOG_FORMATS as readonly string[]).includes(v);

const byNewest = (a: ChangelogEntry, b: ChangelogEntry) => compareVersions(b.version, a.version) ?? 0;

/** 一份 release 正文 → 各版本条目(新的在前)。没有「What's new in」标题的正文认不出版本 → 空。 */
export function entriesFromBody(body: string | null | undefined, dates: Record<string, string> = {}): ChangelogEntry[] {
  return parseReleaseNotes(body)
    .filter(g => !!g.version && compareVersions(g.version, g.version) === 0)
    .map(g => ({ version: g.version!, date: dates[g.version!], sections: g.sections }));
}

/**
 * 多个来源合并、按版本去重:同一版本取**第一个**来源里的内容;日期取第一个有日期的。结果新的在前。
 * `dates` 是额外的日期表(GitHub release 列表 / 镜像 pub_date),条目本身没带日期时补上。
 */
export function mergeChangelog(lists: ReadonlyArray<ReadonlyArray<ChangelogEntry>>, dates: Record<string, string> = {}): ChangelogEntry[] {
  const out = new Map<string, ChangelogEntry>();
  for (const list of lists) {
    for (const e of list) {
      const have = out.get(e.version);
      if (!have) out.set(e.version, { ...e });
      else if (!have.date && e.date) have.date = e.date;
    }
  }
  for (const e of out.values()) if (!e.date && dates[e.version]) e.date = dates[e.version];
  return [...out.values()].sort(byNewest);
}

/** GitHub release 列表 → { 版本: published_at }(草稿、预发布、非桌面 tag 不算)。 */
export function datesFromGithubReleases(list: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!Array.isArray(list)) return out;
  for (const r of list) {
    if (!r || typeof r !== 'object' || r.draft || r.prerelease) continue;
    const m = /^desktop-v(\d+\.\d+\.\d+)$/.exec(String(r.tag_name ?? ''));
    if (m && typeof r.published_at === 'string' && !Number.isNaN(Date.parse(r.published_at))) out[m[1]] = r.published_at;
  }
  return out;
}

/** 列表里最新那条 GitHub release 的正文(累积的,带全部历史)。 */
export function newestGithubBody(list: unknown): { version: string; body: string } | null {
  if (!Array.isArray(list)) return null;
  let best: { version: string; body: string } | null = null;
  for (const r of list) {
    if (!r || typeof r !== 'object' || r.draft || r.prerelease || typeof r.body !== 'string') continue;
    const m = /^desktop-v(\d+\.\d+\.\d+)$/.exec(String(r.tag_name ?? ''));
    if (m && (!best || compareVersions(m[1], best.version) === 1)) best = { version: m[1], body: r.body };
  }
  return best;
}

/**
 * ISO 时间 → 「2026-09-30」。按本机时区(`offsetMinutes` 同 Date#getTimezoneOffset 的符号:东八区 = -480),
 * 测试里显式传,CI 在 UTC 也算得一样。认不出 → ''。
 */
export function releaseDateLabel(iso: string | undefined, offsetMinutes: number = new Date().getTimezoneOffset()): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return '';
  const d = new Date(t - offsetMinutes * 60_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/** 列表行的一句摘要:「新功能 2 · 修复 2」。 */
export function entrySummary(e: ChangelogEntry): string {
  return e.sections.map(s => `${s.title} ${s.items.length}`).join(' · ');
}

// ── 复制格式 ────────────────────────────────────────────────────────────────────────────────

const APP_NAME = 'Agent Network';
const XHS_EMOJI: Record<NoteKind, string> = { new: '✨', speed: '⚡️', fix: '🔧' };
const XHS_SECTION_EMOJI: Record<NoteKind, string> = { new: '🆕', speed: '🚀', fix: '🛠' };
export const XHS_TAGS = ['#AgentNetwork', '#AI工具', '#效率', '#AIAgent', '#更新日志'];
const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

/** 选中的条目按新→旧排好;标题里的版本范围「0.2.163–0.2.165」。 */
function versionRange(entries: ChangelogEntry[]): string {
  if (entries.length === 1) return entries[0].version;
  return `${entries[entries.length - 1].version}–${entries[0].version}`;
}

/** 小红书:一句一行,不要长段 —— 句中的「；」「。」断开(句末的「。」留着),括号里的补充说明保留。 */
function shortLines(text: string): string[] {
  return text.split(/[；;]\s*|(?<=。)(?=\S)/).map(s => s.trim()).filter(Boolean);
}

function formatXhs(entries: ChangelogEntry[], dateOf: (e: ChangelogEntry) => string): string {
  const out: string[] = [`${APP_NAME} ${versionRange(entries)} 更新了什么`, ''];
  const multi = entries.length > 1;
  for (const e of entries) {
    if (multi) out.push(`📦 v${e.version}${dateOf(e) ? `（${dateOf(e)}）` : ''}`);
    for (const s of e.sections) {
      out.push(`${XHS_SECTION_EMOJI[s.kind]} ${s.title}`);
      for (const item of s.items) {
        const [first, ...rest] = shortLines(item.text);
        out.push(`${XHS_EMOJI[s.kind]} ${first}`);
        for (const r of rest) out.push(`· ${r}`);
      }
      out.push('');
    }
  }
  out.push(XHS_TAGS.join(' '));
  return out.join('\n');
}

function formatWechat(entries: ChangelogEntry[], dateOf: (e: ChangelogEntry) => string): string {
  const total = entries.reduce((n, e) => n + e.sections.reduce((m, s) => m + s.items.length, 0), 0);
  const counts = new Map<string, number>();
  for (const e of entries) for (const s of e.sections) counts.set(s.title, (counts.get(s.title) ?? 0) + s.items.length);
  const out: string[] = [`${APP_NAME} ${versionRange(entries)} 更新说明`, ''];
  const when = entries.length === 1 && dateOf(entries[0]) ? `（${dateOf(entries[0])} 发布）` : '';
  out.push(`${APP_NAME} ${entries.length > 1 ? `最近 ${entries.length} 个版本` : `v${entries[0].version}`}${when}共带来 ${total} 项更新：${[...counts].map(([t, n]) => `${t} ${n} 项`).join('、')}。`, '');
  entries.forEach((e, i) => {
    if (entries.length > 1) out.push(`${CN_NUM[i] ?? String(i + 1)}、v${e.version}${dateOf(e) ? `（${dateOf(e)}）` : ''}`, '');
    for (const s of e.sections) {
      out.push(entries.length > 1 ? `【${s.title}】` : `${s.title}`);
      s.items.forEach((item, k) => out.push(`${k + 1}. ${item.text}`));
      out.push('');
    }
  });
  out.push(`欢迎升级到最新版体验，有问题或建议随时留言。`);
  return out.join('\n');
}

function formatPlain(entries: ChangelogEntry[], dateOf: (e: ChangelogEntry) => string): string {
  const out: string[] = [];
  entries.forEach((e, i) => {
    if (i) out.push('');
    out.push(`${APP_NAME} v${e.version}${dateOf(e) ? `（${dateOf(e)}）` : ''}`);
    for (const s of e.sections) {
      out.push(`${s.title}：`);
      for (const item of s.items) out.push(`- ${item.text}`);
    }
  });
  return out.join('\n');
}

/**
 * 选中的版本 → 要复制的文字。顺序一律新→旧(不管勾选顺序)。空选择 → ''。
 * `offsetMinutes` 只影响日期(见 releaseDateLabel)。
 */
export function formatChangelog(selected: ReadonlyArray<ChangelogEntry>, format: ChangelogFormat, offsetMinutes?: number): string {
  const entries = [...selected].filter(e => e.sections.length).sort(byNewest);
  if (!entries.length) return '';
  const dateOf = (e: ChangelogEntry) => releaseDateLabel(e.date, offsetMinutes);
  if (format === 'xhs') return formatXhs(entries, dateOf);
  if (format === 'wechat') return formatWechat(entries, dateOf);
  return formatPlain(entries, dateOf);
}

// ── 缓存 ────────────────────────────────────────────────────────────────────────────────────

export type ChangelogCache = { v: 1; savedAt: string; entries: ChangelogEntry[] };

/** 缓存 JSON → 条目;形状不对的整条丢掉(坏缓存只等于没缓存)。 */
export function parseChangelogCache(raw: string | null | undefined): ChangelogEntry[] {
  try {
    const v = JSON.parse(String(raw ?? ''));
    if (!v || v.v !== 1 || !Array.isArray(v.entries)) return [];
    return v.entries.filter((e: any) =>
      e && typeof e.version === 'string' && compareVersions(e.version, e.version) === 0 && Array.isArray(e.sections)
      && e.sections.every((s: any) => s && typeof s.title === 'string' && Array.isArray(s.items) && s.items.every((i: any) => i && typeof i.text === 'string'))
      && (e.date === undefined || typeof e.date === 'string'),
    );
  } catch {
    return [];
  }
}

export function serializeChangelogCache(entries: ChangelogEntry[], now: Date = new Date()): string {
  const cache: ChangelogCache = { v: 1, savedAt: now.toISOString(), entries };
  return JSON.stringify(cache);
}
