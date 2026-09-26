import fs from 'node:fs';
import path from 'node:path';
import { chooseHeaderLayout, NAME_MIN_WIDTH, type HeaderActionKey } from './chat-header-layout';

// ck-style: self-executing, exits non-zero on the first failure.
let passed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) throw new Error(`FAIL: ${name}${detail ? ` — ${detail}` : ''}`);
  passed++;
  console.log(`PASS: ${name}`);
};

// The 0.2.107 phone header: back, search, bell (#396), pin, settings.
const PHONE_ACTIONS: HeaderActionKey[] = ['search', 'mute', 'pin', 'settings'];
const phone = (width: number) => chooseHeaderLayout({ width, hasBack: true, desktop: false, actions: PHONE_ACTIONS });
const fmt = (l: ReturnType<typeof phone>) => `mode=${l.mode} labels=${l.labels} inline=${l.inline.join(',')} overflow=${l.overflow.join(',')} name=${l.nameWidth}`;

check('NAME_MIN_WIDTH keeps at least 6 CJK glyphs at the 16 px title size', NAME_MIN_WIDTH >= 6 * 16, `${NAME_MIN_WIDTH}`);

// ── 320 / 360: pin + bell go behind ⋯; search + settings stay as icons ──
for (const w of [320, 360]) {
  const l = phone(w);
  check(`${w}dp: overflow mode, no text labels`, l.mode === 'overflow' && !l.labels, fmt(l));
  check(`${w}dp: search and settings stay visible`, l.inline.includes('search') && l.inline.includes('settings'), fmt(l));
  check(`${w}dp: pin and bell move to ⋯ (bell kept, not dropped)`, l.overflow.includes('pin') && l.overflow.includes('mute') && !l.inline.includes('pin') && !l.inline.includes('mute'), fmt(l));
}
check('360dp: name keeps ≥ 6 CJK glyphs', phone(360).nameWidth >= NAME_MIN_WIDTH, fmt(phone(360)));
check('320dp: name still gets ≥ 5 CJK glyphs (best effort floor)', phone(320).nameWidth >= 5 * 16, fmt(phone(320)));

// ── 390 (the owner's folded Xiaomi): everything inline but icon-only ──
{
  const l = phone(390);
  check('390dp: icons mode — no 「已置顶」/「设置」 labels', l.mode === 'icons' && !l.labels, fmt(l));
  check('390dp: all four actions inline, nothing in ⋯', l.inline.join(',') === PHONE_ACTIONS.join(',') && l.overflow.length === 0, fmt(l));
  check('390dp: name keeps ≥ 6 CJK glyphs', l.nameWidth >= NAME_MIN_WIDTH, fmt(l));
  // The regression itself: the old fixed layout (full pills + labels) at 390.
  const old = chooseHeaderLayout({ width: 390, hasBack: true, desktop: false, actions: PHONE_ACTIONS });
  check('390dp: the pre-fix full layout would not have fit', old.mode !== 'full', fmt(old));
}

// ── 600 phone-stack (7" tablet portrait) and wide panes: unchanged look ──
for (const w of [600, 1200]) {
  const l = phone(w);
  check(`${w}dp: full mode with labels, nothing in ⋯`, l.mode === 'full' && l.labels && l.overflow.length === 0, fmt(l));
}
// Desktop 1200×850 two-pane: chat pane ≈ 1200 − sidebar. Even a 700 dp pane keeps the full look.
{
  const l = chooseHeaderLayout({ width: 700, hasBack: false, desktop: true, actions: PHONE_ACTIONS });
  check('desktop 700dp chat pane: full mode (current look kept)', l.mode === 'full' && l.labels, fmt(l));
}
// Android two-pane at the 700 split: detail pane is 380 wide, no back glyph.
{
  const l = chooseHeaderLayout({ width: 380, hasBack: false, desktop: false, actions: PHONE_ACTIONS });
  check('two-pane 380dp detail: not full; name keeps ≥ 6 glyphs', l.mode !== 'full' && l.nameWidth >= NAME_MIN_WIDTH, fmt(l));
}

// ── monotonic: narrowing never adds labels or pulls things out of ⋯ ──
{
  const rank = { full: 0, icons: 1, overflow: 2 } as const;
  let prev = -1;
  for (let w = 1400; w >= 280; w -= 5) {
    const r = rank[phone(w).mode];
    if (r < prev) throw new Error(`FAIL: mode got roomier while narrowing at ${w}dp`);
    prev = r;
  }
  check('mode only gets more compact as width shrinks (1400→280)', true);
}
// With no secondary actions there is nothing to overflow: stay icon-only, no ⋯.
{
  // 260 dp: icon-only already leaves the name short, so this is the case where
  // an unguarded layout would switch to 'overflow' with nothing to put in it.
  const l = chooseHeaderLayout({ width: 260, hasBack: true, desktop: false, actions: ['search', 'settings'] });
  check('no pin/bell: never renders an empty ⋯ (even when the name is short)', l.nameWidth < NAME_MIN_WIDTH && l.mode === 'icons' && l.overflow.length === 0, fmt(l));
}

// ── wiring: ChatScreen renders what the layout says ──
const src = fs.readFileSync(path.join(process.cwd(), 'src/ChatScreen.tsx'), 'utf8').replace(/\r\n?/g, '\n');
const headerStart = src.indexOf('testID="chat-header"');
const headerEnd = src.indexOf('{searchOpen ? (', headerStart);
const header = headerStart > 0 && headerEnd > headerStart ? src.slice(headerStart, headerEnd) : '';
check('wiring: header block found', header.length > 0);
check('wiring: layout fed by the header\'s measured width (window width only as fallback)',
  /chooseHeaderLayout\(\{\s*width:\s*headerWidth\s*\|\|\s*headerWindowWidth/.test(src) && /onLayout=\{\(event\) => \{[\s\S]{0,120}setHeaderWidth/.test(src));
check('wiring: name column reserves NAME_MIN_WIDTH (not minWidth: 0)',
  /style=\{\[styles\.headerTitleCol,\s*\{\s*minWidth:\s*Math\.min\(NAME_MIN_WIDTH,\s*headerLayout\.nameWidth\)/.test(header) &&
  !/flex:\s*1,\s*minWidth:\s*0/.test(header));
check('wiring: 「已置顶」 label gated on headerLayout.labels',
  /headerLayout\.labels \? \(\s*<Text[^>]*>\{pinned \? '已置顶' : '置顶'\}/.test(header));
check('wiring: 「设置」 label gated on headerLayout.labels',
  /headerLayout\.labels \? <Text style=\{styles\.headerActionText\}>设置<\/Text>/.test(header));
check('wiring: no ungated label text left in the header',
  (header.match(/>\{pinned \? '已置顶' : '置顶'\}</g) ?? []).length === 1 && (header.match(/>设置</g) ?? []).length === 1);
check('wiring: pin and bell rendered inline only when the layout keeps them inline',
  /onTogglePin && headerShows\('pin'\)/.test(header) && /onToggleMute && headerShows\('mute'\)/.test(header));
check('wiring: bell keeps its testID and a11y labels',
  /testID="chat-mute-toggle"/.test(header) && /muted \? '取消消息免打扰' : '消息免打扰'/.test(header));
check('wiring: ⋯ button renders when overflow is non-empty, with an accessibilityLabel',
  /headerLayout\.overflow\.length > 0 \? \(\s*<Pressable[\s\S]{0,80}accessibilityLabel="更多操作"/.test(header));
check('wiring: settings is not gated by the layout (always visible when available)',
  /\{onOpenNodeSettings \? \(/.test(header) && !/headerShows\('settings'\)/.test(header));
check('wiring: compact mode swaps to the icon-only style',
  /headerLayout\.mode === 'full' \? styles\.headerAction : styles\.headerActionCompact/.test(src) &&
  (header.match(/headerActionStyle/g) ?? []).length >= 5);
check('wiring: ⋯ menu offers the overflowed actions and runs them',
  /headerLayout\.overflow\.map\(/.test(src) && /key === 'pin' \? onTogglePin : onToggleMute;/.test(src));

console.log(`chat-header-layout: ${passed} checks passed`);
