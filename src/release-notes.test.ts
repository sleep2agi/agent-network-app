// 更新页「更新内容」解析(release-notes.ts)。ck 风格:自执行,失败退出码非 0(scripts/run-tests.mjs 汇总)。
import { classifyNote, notesCoverVersion, parseReleaseNotes, type NoteGroup } from './release-notes';
const PLAIN_NOTE = '此版本包含功能改进和问题修复。';

let p = 0, t = 0;
const ck = (name: string, ok: boolean, extra = '') => { t++; if (ok) { p++; console.log(`PASS: ${name}`); } else console.log(`FAIL: ${name}${extra ? ` — ${extra}` : ''}`); };
const versions = (g: NoteGroup[]) => g.map(x => x.version).join(',');
const texts = (g: NoteGroup[]) => g.flatMap(x => x.sections.flatMap(s => s.items.map(i => i.text)));

// 真实形状:desktop-v0.2.157 的 release 正文(节选前三段 + 尾注),累积了旧版本。
const BODY = `Signed and notarized stable update for macOS (Apple Silicon) and Windows (x64).

What's new in 0.2.157:
- 用户管理：成员的「可访问范围」可在「全部 Agent / 仅指定 Agent」之间切换。
- 修复：给升级前就加入的成员分配 Agent 并保存后，对方仍能看到并联系全部 Agent。
- 任务页新增「甘特图」视图（只读）。

What's new in 0.2.156:
- 设置 → 账号里新增「登录设备」。
- 登录过期时会提示「登录已过期，请重新登录」。

What's new in 0.2.155:
- 优先级显示为 P0 / P1 / P2 / P3（紧凑徽标）。

Existing installations can update in place; new installations can use the assets below.`;

// ── 多版本:只留比当前新的,新的在前 ──
{
  const g = parseReleaseNotes(BODY, { currentVersion: '0.2.156', targetVersion: '0.2.157' });
  ck('one version behind → only that version', versions(g) === '0.2.157', versions(g));
  const g2 = parseReleaseNotes(BODY, { currentVersion: '0.2.154', targetVersion: '0.2.157' });
  ck('three versions behind → three groups, newest first', versions(g2) === '0.2.157,0.2.156,0.2.155', versions(g2));
  const g3 = parseReleaseNotes(BODY, { currentVersion: 'v0.2.155', targetVersion: 'desktop-v0.2.157' });
  ck('v / desktop- prefixes normalised', versions(g3) === '0.2.157,0.2.156', versions(g3));
  const shuffled = BODY.replace("What's new in 0.2.157", "What's new in 0.2.1XX").replace("What's new in 0.2.155", "What's new in 0.2.157").replace("What's new in 0.2.1XX", "What's new in 0.2.155");
  const g4 = parseReleaseNotes(shuffled, { currentVersion: '0.2.150', targetVersion: '0.2.157' });
  ck('out-of-order sections are sorted newest first', versions(g4) === '0.2.157,0.2.156,0.2.155', versions(g4));
  const g5 = parseReleaseNotes(BODY, { currentVersion: '0.2.150', targetVersion: '0.2.156' });
  ck('a section newer than the target is not shown', versions(g5) === '0.2.156,0.2.155', versions(g5));
  const g6 = parseReleaseNotes(BODY, { currentVersion: '0.2.157', targetVersion: '0.2.157' });
  ck('nothing newer than current → still show the newest section (never empty)', versions(g6) === '0.2.157', versions(g6));
  const g7 = parseReleaseNotes(BODY, { currentVersion: 'dev-build', targetVersion: '0.2.157' });
  ck('unreadable current version → no filtering (all sections)', versions(g7) === '0.2.157,0.2.156,0.2.155', versions(g7));
  const g8 = parseReleaseNotes(BODY, {});
  ck('no versions given → all sections', g8.length === 3);
}

// ── 去掉英文标题 / 前言 / 尾注,标题翻成中文 ──
{
  const g = parseReleaseNotes(BODY, { currentVersion: '0.2.154', targetVersion: '0.2.157' });
  const all = texts(g).join('\n');
  ck("no raw \"What's new in\" line survives", !/What's new/i.test(all) && g.every(x => !/What's new/i.test(x.title)));
  ck('group title is Chinese: v0.2.157 更新内容', g[0].title === 'v0.2.157 更新内容', g[0].title);
  ck('preamble dropped', !all.includes('Signed and notarized'));
  ck('trailing footer dropped', !all.includes('Existing installations'));
  ck('no markdown dash left at the start of any item', texts(g).every(x => !/^\s*[-*•]\s/.test(x)));
}

// ── 条目:分类、前缀去掉、分节顺序 ──
{
  const g = parseReleaseNotes(BODY, { currentVersion: '0.2.156', targetVersion: '0.2.157' })[0];
  ck('sections in order 新功能 → 修复', g.sections.map(s => s.title).join('/') === '新功能/修复', g.sections.map(s => s.title).join('/'));
  const fix = g.sections.find(s => s.kind === 'fix')!;
  ck('「修复：」prefix → 修复 section, prefix stripped', fix.items.length === 1 && fix.items[0].text.startsWith('给升级前就加入的成员'), fix.items[0]?.text);
  ck('non-prefixed bullets keep their text verbatim', g.sections[0].items[0].text === '用户管理：成员的「可访问范围」可在「全部 Agent / 仅指定 Agent」之间切换。');
  ck('3 bullets → 3 items total', g.sections.reduce((n, s) => n + s.items.length, 0) === 3);
  ck('classify: 提速 prefix', (() => { const c = classifyNote('- 提速：冷启动快了一倍'); return c.kind === 'speed' && c.text === '冷启动快了一倍'; })());
  ck('classify: speed keyword without prefix keeps text', (() => { const c = classifyNote('- 聊天列表滚动更流畅'); return c.kind === 'speed' && c.text === '聊天列表滚动更流畅'; })());
  ck('classify: English Fix: prefix', (() => { const c = classifyNote('* Fix: crash on start'); return c.kind === 'fix' && c.text === 'crash on start'; })());
  ck('classify: 修复 without colon still a fix', classifyNote('- 修复桌面端双标题栏').kind === 'fix');
  ck('classify: inline markdown stripped', classifyNote('- **加粗** `code` [链接](https://x.invalid)').text === '加粗 code 链接');
  ck('classify: numbered list marker stripped', classifyNote('2. 第二条').text === '第二条');
  const three = parseReleaseNotes("What's new in 1.0.0:\n- 修复：甲\n- 提速：乙\n- 丙", { currentVersion: '0.9.0' })[0];
  ck('mixed kinds → 新功能 / 提速 / 修复 in that order', three.sections.map(s => s.title).join('/') === '新功能/提速/修复');
}

// ── 续行、CRLF、无标题、空值 ──
{
  const wrapped = parseReleaseNotes("What's new in 0.2.48:\n- Local Hub takeover: if an older bundled Hub is still running\n  on the local port, the app now takes over automatically.\n- Second.", { currentVersion: '0.2.47' });
  const items = texts(wrapped);
  ck('indented continuation joins the previous bullet', items.length === 2 && items[0].endsWith('the app now takes over automatically.'), JSON.stringify(items));
  const crlf = parseReleaseNotes("a\r\n\r\nWhat's new in 1.0.0:\r\n- x\r\n\r\nWhat's new in 0.9.0:\r\n- y", { currentVersion: '0.9.0' });
  ck('CRLF input handled', versions(crlf) === '1.0.0' && texts(crlf).join() === 'x');
  const plain = parseReleaseNotes(PLAIN_NOTE, { currentVersion: '0.2.1', targetVersion: '0.2.2' });
  ck('no heading → one group for the target version', plain.length === 1 && plain[0].version === '0.2.2' && plain[0].title === 'v0.2.2 更新内容' && texts(plain).join() === PLAIN_NOTE);
  const para = parseReleaseNotes("What's new in 1.0.0:\n第一句。\n- 第二条", { currentVersion: '0.1.0' });
  ck('a plain line inside a section is its own item', texts(para).join('|') === '第一句。|第二条', texts(para).join('|'));
  ck('empty inputs → no groups', parseReleaseNotes(null).length === 0 && parseReleaseNotes(undefined).length === 0 && parseReleaseNotes('   ').length === 0);
  ck('heading with no bullets is dropped', versions(parseReleaseNotes("What's new in 1.0.1:\n\nWhat's new in 1.0.0:\n- x", { currentVersion: '0.1.0' })) === '1.0.0');
}

// ── 这份正文是不是这一版的说明(安卓更新说明来源挑选用)──
{
  const body = "Signed.\n\nWhat's new in 0.2.160:\n- 日历拖动\n\nWhat's new in 0.2.159:\n- 搜索\n";
  ck('covers: has this version\'s section', notesCoverVersion(body, '0.2.160') && notesCoverVersion(body, 'v0.2.159'));
  ck('covers: only older sections → no', !notesCoverVersion("What's new in 0.2.159:\n- 搜索\n", '0.2.160'));
  ck('covers: heading with no items → no', !notesCoverVersion("What's new in 0.2.160:\n\nWhat's new in 0.2.159:\n- 搜索\n", '0.2.160'));
  ck('covers: plain bullet text without headings → yes (taken as this version)', notesCoverVersion('- 修复:某问题', '0.2.160'));
  ck('covers: empty / null → no', !notesCoverVersion('', '0.2.160') && !notesCoverVersion(null, '0.2.160'));
}

console.log(`\n${p}/${t} passed`);
if (p !== t) process.exit(1);
