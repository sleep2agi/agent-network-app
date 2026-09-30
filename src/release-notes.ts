/**
 * 更新页的「更新内容」—— 把 release 正文解析成可以直接摆放的分组(纯函数,ck 测试直接跑)。
 *
 * owner 2026-09-30「更新的窗口太丑了,这是每次都要发社交媒体的」:旧弹窗把正文原样塞进灰框,
 * 用户看到的是英文的「What's new in 0.2.157:」和一排「- 」markdown 横杠,而且限高截断。
 *
 * 正文形状(release-desktop-auto-update.yml 生成,安卓镜像 latest.json 的 notes 同一份):
 *   Signed and notarized stable update for …        ← 前言,丢掉
 *   What's new in 0.2.157:                           ← 版本标题 → 一个分组
 *   - 用户管理:……                                   ← 条目
 *   - 修复:……                                       ← 「修复:」前缀 → 归到「修复」,前缀去掉
 *   What's new in 0.2.156: …                         ← 累积的旧版本
 *   Existing installations can update in place; …    ← 尾注,丢掉
 *
 * 只保留「比当前版本新」的那几段(新的在前);一段都不剩时保底留最新一段。正文为空 → 没有分组
 * (更新页那时给「查看更新说明」链接,见 update-prompt-model.ts 的 androidNotesView)。
 */
import { compareVersions } from './android-update-core';

export type NoteKind = 'new' | 'speed' | 'fix';
export type NoteItem = { kind: NoteKind; text: string };
export type NoteSection = { kind: NoteKind; title: string; items: NoteItem[] };
export type NoteGroup = {
  /** 纯版本号「0.2.157」;正文没有版本标题时为 undefined(整段当作目标版本的说明) */
  version?: string;
  /** 「v0.2.157 更新内容」 */
  title: string;
  sections: NoteSection[];
};

export const SECTION_TITLES: Record<NoteKind, string> = { new: '新功能', speed: '提速', fix: '修复' };
const SECTION_ORDER: NoteKind[] = ['new', 'speed', 'fix'];

const HEADING = /^What's new in\s+v?([0-9][^\s:]*)\s*:\s*$/i;
const FOOTER = /^Existing installations\b/i;
const BULLET = /^\s*(?:[-*•·]|\d+[.)、])\s+/;

// 前缀(去掉)+ 关键字(只归类、不改字)。
const PREFIX: Array<[RegExp, NoteKind]> = [
  [/^(?:修复|修正|Fix(?:ed|es)?|Bug\s*fix(?:es)?)\s*[:：]\s*/i, 'fix'],
  [/^(?:提速|加速|性能|优化|Perf(?:ormance)?|Faster)\s*[:：]\s*/i, 'speed'],
  [/^(?:新功能|新增|New|Feature)\s*[:：]\s*/i, 'new'],
];
const SPEED_WORDS = /提速|加速|更快|加快|秒开|更流畅|耗时|延迟降|faster|speed/i;

/** 一条说明 → 归类 + 去掉分类前缀 + 去掉行内 markdown(粗体 / 代码 / 链接)。 */
export function classifyNote(raw: string): NoteItem {
  let text = inlinePlain(raw.replace(BULLET, '').trim());
  for (const [re, kind] of PREFIX) {
    if (re.test(text)) return { kind, text: text.replace(re, '').trim() };
  }
  if (/^修复/.test(text)) return { kind: 'fix', text };
  return { kind: SPEED_WORDS.test(text) ? 'speed' : 'new', text };
}

const inlinePlain = (s: string) => s
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/\*\*([^*]+)\*\*/g, '$1')
  .replace(/__([^_]+)__/g, '$1')
  .replace(/`([^`]+)`/g, '$1')
  .replace(/\s+/g, ' ')
  .trim();

/** 一段(一个版本)的正文行 → 条目。缩进的续行并进上一条;空行分条。 */
function itemsOf(lines: string[]): NoteItem[] {
  const raw: string[] = [];
  let open = false;
  for (const line of lines) {
    if (!line.trim()) { open = false; continue; }
    if (FOOTER.test(line.trim())) continue;
    if (BULLET.test(line)) { raw.push(line); open = true; continue; }
    if (open && /^\s+\S/.test(line)) { raw[raw.length - 1] += ` ${line.trim()}`; continue; }
    // 不带横杠的一行字:自成一条(不和上一条粘在一起)。
    raw.push(line);
    open = true;
  }
  return raw.map(classifyNote).filter(i => i.text.length > 0);
}

function sectionsOf(items: NoteItem[]): NoteSection[] {
  return SECTION_ORDER
    .map(kind => ({ kind, title: SECTION_TITLES[kind], items: items.filter(i => i.kind === kind) }))
    .filter(s => s.items.length > 0);
}

/**
 * 正文 → 分组。
 * `currentVersion`:已装版本,只留比它新的段;`targetVersion`:这次要装的版本,比它还新的段不要(防御)。
 * 两个都认不出时不过滤。没有「What's new in」标题 → 整段当作一个分组(version = targetVersion)。
 */
export function parseReleaseNotes(body: string | null | undefined, opts: { currentVersion?: string; targetVersion?: string } = {}): NoteGroup[] {
  const text = String(body ?? '').replace(/\r\n?/g, '\n').trim();
  if (!text) return [];
  const lines = text.split('\n');
  const heads = lines.map((l, i) => ({ i, m: HEADING.exec(l.trim()) })).filter((h): h is { i: number; m: RegExpExecArray } => !!h.m);

  const targetRaw = opts.targetVersion ? plain(opts.targetVersion) : undefined;
  if (heads.length === 0) {
    const sections = sectionsOf(itemsOf(lines));
    return sections.length ? [{ version: targetRaw, title: targetRaw ? `v${targetRaw} 更新内容` : '更新内容', sections }] : [];
  }

  const all: NoteGroup[] = heads.map((h, k) => {
    const end = k + 1 < heads.length ? heads[k + 1].i : lines.length;
    const version = plain(h.m[1]);
    return { version, title: `v${version} 更新内容`, sections: sectionsOf(itemsOf(lines.slice(h.i + 1, end))) };
  }).filter(g => g.sections.length > 0);
  if (all.length === 0) return [];

  // 认不出的版本号(compareVersions 返回 null)不参与过滤 —— 不能因为「无法判断」就把说明全丢掉。
  const known = (v: string | undefined) => (v && compareVersions(v, v) === 0 ? v : undefined);
  const current = known(opts.currentVersion ? plain(opts.currentVersion) : undefined);
  const newest = [...all].sort((a, b) => (compareVersions(b.version!, a.version!) ?? 0));
  const target = known(targetRaw);
  const kept = newest.filter(g => {
    if (current && compareVersions(g.version!, current) !== 1) return false;
    if (target && compareVersions(g.version!, target) === 1) return false;
    return true;
  });
  return kept.length ? kept : newest.slice(0, 1);
}

const plain = (v: string) => v.trim().replace(/^(?:desktop-)?v/, '');

/**
 * 这份正文里有没有 `version` 这一版的说明(有「What's new in <version>:」段且段里有条目;
 * 或者整份没有版本标题、但有条目 —— 那就当作这一版的)。只有旧版本段的正文不算:那是别的版本的说明。
 */
export function notesCoverVersion(body: string | null | undefined, version: string): boolean {
  const v = plain(version);
  return parseReleaseNotes(body, { targetVersion: v }).some(g => g.version === v);
}
