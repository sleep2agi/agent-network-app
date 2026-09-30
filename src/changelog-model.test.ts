// 设置 → 关于 → 更新日志:解析、按版本去重合并、三种复制格式、缓存、数据来源(changelog-model.ts / changelog-source.ts)。
// ck 风格:自执行,失败退出码非 0(scripts/run-tests.mjs 汇总)。
import {
  datesFromGithubReleases, entriesFromBody, entrySummary, formatChangelog, mergeChangelog, newestGithubBody,
  parseChangelogCache, releaseDateLabel, serializeChangelogCache, XHS_TAGS, type ChangelogEntry,
} from './changelog-model';
import { CHANGELOG_CACHE_KEY, loadCachedChangelog, refreshChangelog, type ChangelogStorage } from './changelog-source';
import { BUNDLED_RELEASE_BODY } from './changelog-bundled';
import { APP_VERSION } from './version';

let p = 0, t = 0;
const ck = (name: string, ok: boolean, extra = '') => { t++; if (ok) { p++; console.log(`PASS: ${name}`); } else console.log(`FAIL: ${name}${extra ? ` — ${extra}` : ''}`); };
const CST = -480; // 东八区的 getTimezoneOffset

// 真实形状(累积正文,新的在前),节选。
const BODY_165 = `Signed and notarized stable update for macOS (Apple Silicon) and Windows (x64).

What's new in 0.2.165:
- 任务仪表盘：任务页新增「仪表盘」；「最近完成」时间线列出刚完成的任务。
- 修复：在设置窗口里改了快捷键或发送键，主窗口马上生效，不用重启。

What's new in 0.2.164:
- 私信能正常发图片和文件了。

What's new in 0.2.162:
- 提速：电脑端复用网络连接，每个请求约快 0.5 秒。
- 会话列表里的「人员」挪到最上面。

Existing installations can update in place; new installs use the installers below.`;

// 旧一点的正文(0.2.164 那次发的):0.2.164 措辞不同、0.2.163 在新正文里不存在(被删的段落也要保住)。
const BODY_164 = `What's new in 0.2.164:
- 私信发图（旧措辞）。

What's new in 0.2.163:
- 修复：任务列表标题一列是空的。`;

// ── 解析 ────────────────────────────────────────────────────────────────────
{
  const e = entriesFromBody(BODY_165);
  ck('parse: one entry per 「What\'s new」 block, newest first', e.map(x => x.version).join(',') === '0.2.165,0.2.164,0.2.162', e.map(x => x.version).join(','));
  ck('parse: grouped like parseReleaseNotes (新功能 / 修复)', e[0].sections.map(s => s.title).join('/') === '新功能/修复');
  ck('parse: 「修复：」 prefix stripped', e[0].sections[1].items[0].text.startsWith('在设置窗口里'));
  ck('parse: 提速 group', e[2].sections.map(s => s.title).join('/') === '新功能/提速');
  ck('parse: preamble + footer dropped', !JSON.stringify(e).includes('Signed and notarized') && !JSON.stringify(e).includes('Existing installations'));
  ck('parse: dates attached from the map', entriesFromBody(BODY_165, { '0.2.164': '2026-09-30T09:38:44Z' })[1].date === '2026-09-30T09:38:44Z');
  ck('parse: a body without version headings has no versions → []', entriesFromBody('- 修复了一些问题').length === 0);
  ck('parse: empty / null → []', entriesFromBody('').length === 0 && entriesFromBody(null).length === 0);
  ck('summary line', entrySummary(e[0]) === '新功能 1 · 修复 1', entrySummary(e[0]));
}

// ── 去重合并 ────────────────────────────────────────────────────────────────
{
  const merged = mergeChangelog([entriesFromBody(BODY_165), entriesFromBody(BODY_164)], { '0.2.163': '2026-09-30T08:41:23Z', '0.2.165': '2026-09-30T10:38:51Z' });
  ck('dedupe: each version once', merged.map(x => x.version).join(',') === '0.2.165,0.2.164,0.2.163,0.2.162', merged.map(x => x.version).join(','));
  ck('dedupe: the first (newest) source wins the text', merged[1].sections[0].items[0].text === '私信能正常发图片和文件了。');
  ck('dedupe: a version only an older body has is kept', merged[2].version === '0.2.163' && merged[2].sections[0].title === '修复');
  ck('dedupe: dates filled from the table', merged[0].date === '2026-09-30T10:38:51Z' && merged[2].date === '2026-09-30T08:41:23Z');
  const withDate = mergeChangelog([entriesFromBody(BODY_165), [{ ...entriesFromBody(BODY_165)[1], date: '2026-09-30T09:38:44Z' }]]);
  ck('dedupe: a later source can still supply a missing date', withDate[1].date === '2026-09-30T09:38:44Z');
  const shuffled = mergeChangelog([[entriesFromBody(BODY_165)[2]], [entriesFromBody(BODY_165)[0]], [{ version: '0.2.99', sections: entriesFromBody(BODY_165)[1].sections }]]);
  ck('dedupe: sorted by version, not by string / source order (0.2.165 > 0.2.99)', shuffled.map(x => x.version).join(',') === '0.2.165,0.2.162,0.2.99', shuffled.map(x => x.version).join(','));
}

// ── GitHub 列表 ─────────────────────────────────────────────────────────────
{
  const list = [
    { tag_name: 'desktop-v0.2.45', draft: true, published_at: null, body: 'x' },
    { tag_name: 'desktop-v0.2.165', draft: false, prerelease: false, published_at: '2026-09-30T10:38:51Z', body: BODY_165 },
    { tag_name: 'desktop-v0.2.164', draft: false, prerelease: false, published_at: '2026-09-30T09:38:44Z', body: BODY_164 },
    { tag_name: 'v9.9.9', draft: false, published_at: '2026-01-01T00:00:00Z', body: 'not desktop' },
    { tag_name: 'desktop-v0.2.166-beta.1', prerelease: true, published_at: '2026-10-01T00:00:00Z', body: 'beta' },
  ];
  const d = datesFromGithubReleases(list);
  ck('github: dates for published desktop releases only', Object.keys(d).sort().join(',') === '0.2.164,0.2.165', Object.keys(d).join(','));
  ck('github: newest body = highest desktop version', newestGithubBody(list)?.version === '0.2.165');
  ck('github: garbage → empty', Object.keys(datesFromGithubReleases({ message: 'API rate limit exceeded' })).length === 0 && newestGithubBody(null) === null);
}

// ── 日期 ────────────────────────────────────────────────────────────────────
{
  ck('date: 东八区 crosses midnight', releaseDateLabel('2026-09-29T17:04:56Z', CST) === '2026-09-30', releaseDateLabel('2026-09-29T17:04:56Z', CST));
  ck('date: UTC stays', releaseDateLabel('2026-09-29T17:04:56Z', 0) === '2026-09-29');
  ck('date: missing / junk → empty', releaseDateLabel(undefined, CST) === '' && releaseDateLabel('soon', CST) === '');
}

// ── 三种格式 ────────────────────────────────────────────────────────────────
const entries = mergeChangelog([entriesFromBody(BODY_165)], { '0.2.165': '2026-09-30T10:38:51Z', '0.2.164': '2026-09-30T09:38:44Z', '0.2.162': '2026-09-30T07:05:01Z' });
const one = [entries[0]];
{
  const x = formatChangelog(one, 'xhs', CST);
  const lines = x.split('\n');
  ck('xhs: title line', lines[0] === 'Agent Network 0.2.165 更新了什么', lines[0]);
  ck('xhs: emoji bullets', lines.includes('✨ 任务仪表盘：任务页新增「仪表盘」') && lines.includes('🔧 在设置窗口里改了快捷键或发送键，主窗口马上生效，不用重启。'), x);
  ck('xhs: 「；」 split into short lines', lines.includes('· 「最近完成」时间线列出刚完成的任务。'));
  ck('xhs: mid-item 「。」 splits too', formatChangelog([{ version: '0.2.1', sections: [{ kind: 'new', title: '新功能', items: [{ kind: 'new', text: '甲。乙（丙）。' }] }] }], 'xhs').includes('✨ 甲。\n· 乙（丙）。'));
  ck('xhs: section headings with emoji', lines.includes('🆕 新功能') && lines.includes('🛠 修复'));
  const tags = lines[lines.length - 1].split(' ');
  ck('xhs: 3–5 hashtags on the last line', tags.length >= 3 && tags.length <= 5 && tags.every(s => s.startsWith('#')) && tags.includes('#AI工具') && tags.includes('#效率'), lines[lines.length - 1]);
  ck('xhs: no markdown dashes', !/^- /m.test(x));
  const multi = formatChangelog([entries[2], entries[0]], 'xhs', CST);
  ck('xhs multi: range title, newest first regardless of pick order', multi.startsWith('Agent Network 0.2.162–0.2.165 更新了什么'));
  ck('xhs multi: per-version header with date', multi.indexOf('📦 v0.2.165（2026-09-30）') > 0 && multi.indexOf('📦 v0.2.165') < multi.indexOf('📦 v0.2.162'));
  ck('xhs: tags constant is 3–5', XHS_TAGS.length >= 3 && XHS_TAGS.length <= 5);
}
{
  const w = formatChangelog(one, 'wechat', CST);
  const lines = w.split('\n');
  ck('wechat: title', lines[0] === 'Agent Network 0.2.165 更新说明', lines[0]);
  ck('wechat: intro paragraph with counts + date', lines[2] === 'Agent Network v0.2.165（2026-09-30 发布）共带来 2 项更新：新功能 1 项、修复 1 项。', lines[2]);
  ck('wechat: numbered list per section', lines.includes('新功能') && lines.includes('1. 任务仪表盘：任务页新增「仪表盘」；「最近完成」时间线列出刚完成的任务。') && lines.includes('修复'));
  ck('wechat: closing paragraph', lines[lines.length - 1].startsWith('欢迎升级'));
  const m = formatChangelog(entries, 'wechat', CST).split('\n');
  ck('wechat multi: 一、二、三 per version', m.includes('一、v0.2.165（2026-09-30）') && m.includes('二、v0.2.164（2026-09-30）') && m.includes('三、v0.2.162（2026-09-30）'));
  ck('wechat multi: numbering restarts per section', m.filter(l => l.startsWith('1. ')).length === 5, String(m.filter(l => l.startsWith('1. ')).length));
  ck('wechat multi: intro says 3 versions', m[2].startsWith('Agent Network 最近 3 个版本共带来 5 项更新'), m[2]);
}
{
  const s = formatChangelog(one, 'plain', CST);
  ck('plain: exact text', s === 'Agent Network v0.2.165（2026-09-30）\n新功能：\n- 任务仪表盘：任务页新增「仪表盘」；「最近完成」时间线列出刚完成的任务。\n修复：\n- 在设置窗口里改了快捷键或发送键，主窗口马上生效，不用重启。', JSON.stringify(s));
  ck('plain: no emoji, no hashtags', !/[✨🔧🆕#]/u.test(formatChangelog(entries, 'plain', CST)));
  const noDate = formatChangelog([{ ...entries[0], date: undefined }], 'plain', CST);
  ck('plain: no date → no empty brackets', noDate.startsWith('Agent Network v0.2.165\n'), noDate.split('\n')[0]);
}
ck('format: nothing selected → empty', formatChangelog([], 'xhs') === '' && formatChangelog([{ version: '0.2.1', sections: [] }], 'plain') === '');

// ── 缓存 ────────────────────────────────────────────────────────────────────
{
  const raw = serializeChangelogCache(entries, new Date('2026-09-30T12:00:00Z'));
  ck('cache: round trip', JSON.stringify(parseChangelogCache(raw)) === JSON.stringify(entries));
  ck('cache: corrupt → []', parseChangelogCache('{nope').length === 0 && parseChangelogCache(null).length === 0 && parseChangelogCache('{"v":2,"entries":[]}').length === 0);
  const bad = JSON.stringify({ v: 1, entries: [entries[0], { version: 'x', sections: [] }, { version: '0.2.1', sections: [{ title: 1 }] }] });
  ck('cache: malformed rows dropped, good ones kept', parseChangelogCache(bad).map(e => e.version).join(',') === '0.2.165');
}

// ── 内置正文:离线也有本版 ─────────────────────────────────────────────────
{
  const bundled = entriesFromBody(BUNDLED_RELEASE_BODY);
  ck(`bundled: has the running version ${APP_VERSION}`, bundled.some(e => e.version === APP_VERSION));
  ck('bundled: long history, newest first', bundled.length > 50 && bundled[0].version === APP_VERSION, `${bundled.length} / ${bundled[0]?.version}`);
}

// ── 来源:离线 / 在线 / 缓存 ────────────────────────────────────────────────
const memStorage = (initial: string | null = null) => {
  let v = initial; const writes: string[] = [];
  const s: ChangelogStorage & { writes: string[]; value: () => string | null } = { get: async () => v, set: async x => { v = x; writes.push(x); }, writes, value: () => v };
  return s;
};
const res = (status: number, body: string) => ({ ok: status >= 200 && status < 300, status, text: async () => body }) as unknown as Response;
const NEXT = `What's new in 9.9.9:\n- 未来的新功能。\n\n${BODY_165}`;
const online = (calls: string[]): typeof fetch => (async (url: any) => {
  const u = String(url); calls.push(u);
  if (u.endsWith('/desktop/latest/VERSION')) return res(200, '9.9.9\n');
  if (u.endsWith('/desktop/9.9.9/latest.json')) return res(200, JSON.stringify({ version: '9.9.9', notes: NEXT, pub_date: '2027-01-01T00:00:00.000Z' }));
  if (u.startsWith('https://api.github.com/')) return res(403, '{"message":"API rate limit exceeded"}');
  return res(404, '');
}) as typeof fetch;
{
  const calls: string[] = [];
  const store = memStorage();
  const r = await refreshChangelog({ fetchImpl: online(calls), storage: store });
  ck('source: mirror newer than the bundle → its version on top', r.online && r.entries[0].version === '9.9.9' && r.entries[0].date === '2027-01-01T00:00:00.000Z', r.entries[0]?.version);
  ck('source: bundled history still merged in (dedupe)', r.entries.filter(e => e.version === '0.2.165').length === 1 && r.entries.some(e => e.version === '0.2.100'));
  ck('source: one manifest, not one fetch per version', calls.length === 3, calls.join(' '));
  ck(`source: writes the cache (${CHANGELOG_CACHE_KEY})`, store.writes.length === 1 && parseChangelogCache(store.value())[0].version === '9.9.9');
  const cachedOnly = await loadCachedChangelog(store);
  ck('source: cached entries come back offline', cachedOnly[0].version === '9.9.9');
  const off = await refreshChangelog({ fetchImpl: (async () => { throw new Error('offline'); }) as unknown as typeof fetch, storage: store });
  ck('source: offline → cache + bundle, online=false, cache untouched', !off.online && off.entries[0].version === '9.9.9' && store.writes.length === 1);
  const fresh = await refreshChangelog({ fetchImpl: (async () => { throw new Error('offline'); }) as unknown as typeof fetch, storage: memStorage() });
  ck('source: offline + no cache → bundled, running version present', !fresh.online && fresh.entries.some(e => e.version === APP_VERSION));
  const broken = await loadCachedChangelog({ get: async () => { throw new Error('io'); }, set: async () => {} });
  ck('source: unreadable storage → bundle only', broken.some(e => e.version === APP_VERSION));
}

console.log(`\n${p}/${t} passed`);
if (p !== t) process.exit(1);
