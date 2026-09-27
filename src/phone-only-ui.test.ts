// 手机专属交互不许漏进桌面(Owner 2026-09-27:「Windows / Mac 跟安卓版肯定是不一样的」)。
// 名单在 phone-only-registry.ts;这里按名单扫 src/**(.ts/.tsx,不含测试)+ App.tsx。
//
// 两层分开自检(CLAUDE.md ⑤):
//   判据 —— 给它一段带 / 不带判定的源码,它报不报;再把真实文件里一处有判定的地方去掉判定(见证),必须红。
//   取集 —— 造一棵目录树(子目录、CRLF、Windows 分隔符),该收的收进来没有;每个名单条目至少命中 minSites 处。
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COPY_EXCEPTIONS,
  GESTURE_WORDS,
  PHONE_ONLY_SITES,
  REFRESH_ALTERNATIVE,
  SWIPE_FILES,
  type CopyException,
  type PhoneOnlySite,
} from './phone-only-registry';
import { pointerUi } from './pointer-ui';

let p = 0, t = 0;
const ck = (name: string, ok: boolean, extra = '') => {
  t++; if (ok) p++;
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? ` (${extra})` : ''}`);
};

// ── 取集 ──────────────────────────────────────────────────────────────────────────────────────
const posix = (s: string) => s.split(sep).join('/').replace(/\\/g, '/');
const lf = (s: string) => s.replace(/\r\n?/g, '\n');
const SELF = new Set(['src/phone-only-registry.ts', 'src/phone-only-ui.test.ts']);

/** 仓根下要扫的源文件:App.tsx + src/ 递归的 .ts/.tsx,去掉测试和本门自己。键是 POSIX 相对路径,值已转 LF。 */
export function collect(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const full = join(dir, e);
      if (statSync(full).isDirectory()) { if (e !== 'node_modules') walk(full); continue; }
      if (!/\.tsx?$/.test(e) || /\.test\.tsx?$/.test(e)) continue;
      const rel = posix(relative(root, full));
      if (!SELF.has(rel)) out.set(rel, lf(readFileSync(full, 'utf8')));
    }
  };
  walk(join(root, 'src'));
  try { out.set('App.tsx', lf(readFileSync(join(root, 'App.tsx'), 'utf8'))); } catch { /* 夹具树可以没有 */ }
  return out;
}

/** 去注释、保行号:块注释(含 JSX 的 {/* *\/})换成空白;行注释只认前面是空白的 `//`(不碰 'https://')。 */
export const stripComments = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  .replace(/(^|\s)\/\/[^\n]*/g, (_m, lead) => lead);

// ── 判据 ──────────────────────────────────────────────────────────────────────────────────────
export interface Finding { kind: 'site' | 'copy' | 'refresh' | 'swipe' | 'stale' | 'collect'; file: string; line: number; detail: string; debt?: string }

/** 从第 i 行到这个 JSX 开标签结束(`/>` 或行尾的 `>`),最多 20 行。 */
function tagWindow(lines: string[], i: number): string {
  const out: string[] = [];
  for (let j = i; j < Math.min(lines.length, i + 20); j++) {
    out.push(lines[j]);
    if (/\/>|>\s*$/.test(lines[j].replace(/=>/g, ''))) break;
  }
  return out.join('\n');
}

export function judgeSites(files: Map<string, string>, sites: readonly PhoneOnlySite[] = PHONE_ONLY_SITES): { findings: Finding[]; counts: Map<string, number> } {
  const findings: Finding[] = [];
  const counts = new Map<string, number>();
  for (const s of sites) {
    let n = 0;
    const debtHits = new Set<string>();
    for (const [file, raw] of files) {
      if (file === s.definedIn) continue;
      const lines = stripComments(raw).split('\n');
      lines.forEach((line, i) => {
        if (!s.site.test(line)) return;
        n++;
        const win = s.window === 'tag' ? tagWindow(lines, i) : lines.slice(Math.max(0, i - s.window), i + 1).join('\n');
        if (s.gate.test(win)) return;
        const debt = s.debt?.files.includes(file) ? `${s.debt.owner}: ${s.debt.reason}` : undefined;
        if (debt) debtHits.add(file);
        findings.push({ kind: 'site', file, line: i + 1, detail: `${s.name} rendered / bound without a platform predicate — ${s.why}`, debt });
      });
    }
    counts.set(s.name, n);
    if (n < s.minSites) findings.push({ kind: 'collect', file: '-', line: 0, detail: `${s.name}: found ${n} site(s), registry expects ≥ ${s.minSites} (renamed or moved? update phone-only-registry.ts)` });
    for (const f of s.debt?.files ?? []) {
      // 欠账已还(那里带上了判定):打印提醒删条目,不判红 —— 修欠账的 PR 不该因为先合而被本门卡住。
      if (!debtHits.has(f)) findings.push({ kind: 'stale', file: f, line: 0, detail: `${s.name}: debt entry for ${f} no longer matches an ungated site — delete it from phone-only-registry.ts`, debt: 'RESOLVED' });
    }
  }
  return { findings, counts };
}

export function judgeCopy(files: Map<string, string>, exceptions: readonly CopyException[] = COPY_EXCEPTIONS): Finding[] {
  const findings: Finding[] = [];
  const used = new Set<CopyException>();
  const gate = /\b(?:pointer|touch|desktop)\b|pointerUi\(|Platform\.OS\s*[!=]==/;
  for (const [file, raw] of files) {
    stripComments(raw).split('\n').forEach((line, i) => {
      if (!GESTURE_WORDS.test(line) || gate.test(line)) return;
      const ex = exceptions.find(e => e.file === file && line.includes(e.text));
      if (ex) { used.add(ex); if (!ex.debt) return; }
      findings.push({ kind: 'copy', file, line: i + 1, detail: `gesture word 「${line.match(GESTURE_WORDS)![0]}」 in copy with no platform predicate on the line: ${line.trim().slice(0, 90)}`, debt: ex?.debt ? `${ex.debt.owner}: ${ex.debt.reason}` : undefined });
    });
  }
  for (const ex of exceptions) if (!used.has(ex)) findings.push({ kind: 'stale', file: ex.file, line: 0, detail: `copy exception 「${ex.text}」 no longer found — delete or update it in phone-only-registry.ts` });
  return findings;
}

export function judgeRefreshAndSwipe(files: Map<string, string>): Finding[] {
  const findings: Finding[] = [];
  for (const [file, raw] of files) {
    const src = stripComments(raw);
    if (/<RefreshControl\b/.test(src) && !REFRESH_ALTERNATIVE.test(src)) {
      findings.push({ kind: 'refresh', file, line: src.split('\n').findIndex(l => /<RefreshControl\b/.test(l)) + 1, detail: 'pull-to-refresh is the only refresh (RN-web draws nothing for it): add a poll or a refresh button' });
    }
    if (/PanResponder\.create\(/.test(src)) {
      const entry = SWIPE_FILES[file];
      if (!entry) findings.push({ kind: 'swipe', file, line: src.split('\n').findIndex(l => /PanResponder\.create\(/.test(l)) + 1, detail: 'new swipe / drag handler: register its mouse / keyboard alternative in SWIPE_FILES' });
      else if (entry.alternative && !entry.alternative.test(src)) findings.push({ kind: 'swipe', file, line: 0, detail: `swipe handler lost its desktop alternative (${entry.why})` });
    }
  }
  for (const f of Object.keys(SWIPE_FILES)) if (!files.has(f) || !/PanResponder\.create\(/.test(stripComments(files.get(f)!))) {
    findings.push({ kind: 'stale', file: f, line: 0, detail: 'SWIPE_FILES entry has no PanResponder.create any more — delete it' });
  }
  return findings;
}

export const judgeAll = (files: Map<string, string>) => [...judgeSites(files).findings, ...judgeCopy(files), ...judgeRefreshAndSwipe(files)];

// ── 1. 判据自检(已知阳性 / 阴性) ─────────────────────────────────────────────────────────────
const one = (file: string, src: string) => new Map([[file, src]]);
const LP = PHONE_ONLY_SITES.find(s => s.name.startsWith('onLongPress'))!;
const SEL = PHONE_ONLY_SITES.find(s => s.name.startsWith('SelectTextSheet'))!;
const lp = (src: string) => judgeSites(one('src/X.tsx', src), [{ ...LP, minSites: 0 }]).findings.filter(f => f.kind === 'site').length;
ck('judge: ungated onLongPress is flagged', lp(`<Pressable onLongPress={() => open()} />`) === 1);
ck('judge: onLongPress={pointer ? undefined : …} passes', lp(`<Pressable onLongPress={pointer ? undefined : () => open()} />`) === 0);
ck('judge: onLongPress={touch ? … : undefined} passes', lp(`<Pressable onLongPress={touch ? () => open() : undefined} />`) === 0);
ck('judge: a predicate elsewhere on the line does not gate it', lp(`<Pressable onLongPress={() => open(desktop)} />`) === 1);
const sel = (src: string) => judgeSites(one('src/X.tsx', src), [{ ...SEL, minSites: 0 }]).findings.filter(f => f.kind === 'site').length;
ck('judge: <SelectTextSheet …/> with no gate is flagged', sel(`<SelectTextSheet\n  text={t}\n/>`) === 1);
ck('judge: {pointer ? null : <SelectTextSheet passes', sel(`{pointer ? null : <SelectTextSheet\n  text={t}\n/>}`) === 0);
ck('judge: a prop that merely mentions desktop is not a gate', sel(`<SelectTextSheet\n  bottom={desktop ? 1 : 2}\n/>`) === 1);
ck('judge: visible={!desktop && open} gates it', sel(`<SelectTextSheet\n  visible={!desktop && open}\n/>`) === 0);
ck('judge: comments are ignored', sel(`// <SelectTextSheet text={t} />\n{/* <SelectTextSheet /> */}`) === 0);
const copy = (src: string, ex: CopyException[] = []) => judgeCopy(one('src/X.tsx', src), ex).filter(f => f.kind === 'copy').length;
ck('judge copy: 「下拉刷新」 with no predicate is flagged', copy(`<Text>修好再试，或下拉刷新。</Text>`) === 1);
ck('judge copy: gated on the same line passes', copy("<Text>{`或${pointer ? '点「刷新」' : '下拉刷新'}`}</Text>") === 0);
ck('judge copy: 「点按钮」 is not a gesture word', copy(`<Text>每一步都由你点按钮触发</Text>`) === 0);
ck('judge copy: a comment with 长按 is ignored', copy(`// 长按打开菜单\nconst a = 1;`) === 0);
ck('judge copy: a listed exception passes, a debt exception is still reported', copy(`x = '长按卡片'`, [{ file: 'src/X.tsx', text: '长按卡片', why: 'phone' }]) === 0 && copy(`x = '长按卡片'`, [{ file: 'src/X.tsx', text: '长按卡片', why: 'phone', debt: { owner: 'o', reason: 'r' } }]) === 1);
ck('judge copy: an exception whose text is gone is stale', judgeCopy(one('src/X.tsx', `x = 1`), [{ file: 'src/X.tsx', text: '长按卡片', why: 'phone' }]).some(f => f.kind === 'stale'));
ck('judge refresh: RefreshControl with no poll / button is flagged', judgeRefreshAndSwipe(one('src/Y.tsx', `<RefreshControl onRefresh={x} />`)).some(f => f.kind === 'refresh'));
ck('judge refresh: a poll next to it passes', !judgeRefreshAndSwipe(one('src/Y.tsx', `usePoll(load, 1000);\n<RefreshControl onRefresh={x} />`)).some(f => f.kind === 'refresh'));
ck('judge swipe: an unregistered PanResponder file is flagged', judgeRefreshAndSwipe(one('src/NewSwipe.tsx', `PanResponder.create({})`)).some(f => f.kind === 'swipe' && f.file === 'src/NewSwipe.tsx'));
ck('judge debt: a debt entry whose site got gated is reported RESOLVED (printed, not red)', judgeSites(one('src/ChatScreen.tsx', `{pointer ? null : <VoiceRecordingOverlay voice={v} />}`), PHONE_ONLY_SITES.filter(s => s.name.startsWith('VoiceRecordingOverlay'))).findings.every(f => f.kind === 'stale' && f.debt === 'RESOLVED'));
// #463 的门:{voiceSurface(desktop) === 'phoneOverlay' ? <VoiceRecordingOverlay … /> : null}
ck('judge: #463\'s voiceSurface(desktop) === \'phoneOverlay\' gate is recognised', sel(`{voiceSurface(desktop) === 'phoneOverlay' ? <SelectTextSheet text={t} /> : null}`) === 0 && judgeSites(one('src/ChatScreen.tsx', `{voiceSurface(desktop) === 'phoneOverlay' ? <VoiceRecordingOverlay voice={voice} bottom={88 + composerInset} /> : null}`), PHONE_ONLY_SITES.filter(s => s.name.startsWith('VoiceRecordingOverlay'))).findings.every(f => f.debt === 'RESOLVED'));

// ── 2. 取集自检(子目录、CRLF、分隔符) ──────────────────────────────────────────────────────────
const tmp = mkdtempSync(join(tmpdir(), 'phone-only-'));
try {
  mkdirSync(join(tmp, 'src', 'deep', 'er'), { recursive: true });
  writeFileSync(join(tmp, 'App.tsx'), 'export default 1;\r\n');
  writeFileSync(join(tmp, 'src', 'deep', 'er', 'Nested.tsx'), "<Pressable\r\n  onLongPress={() => x()}\r\n/>\r\n");
  writeFileSync(join(tmp, 'src', 'Skip.test.ts'), "onLongPress={() => x()}\n");
  writeFileSync(join(tmp, 'src', 'phone-only-registry.ts'), "'长按'\n");
  const got = collect(tmp);
  ck('collect: a file two directories down is scanned, key is POSIX', got.has('src/deep/er/Nested.tsx'));
  ck('collect: App.tsx at the root is scanned', got.has('App.tsx'));
  ck('collect: tests and the registry itself are not', !got.has('src/Skip.test.ts') && !got.has('src/phone-only-registry.ts'));
  ck('collect: CRLF is normalised (the finding lands on line 2)', !got.get('src/deep/er/Nested.tsx')!.includes('\r') && lp(got.get('src/deep/er/Nested.tsx')!) === 1 && judgeSites(got, [{ ...LP, minSites: 0 }]).findings[0]?.line === 2);
  ck('collect: a Windows path separator is normalised', posix('src\\deep\\X.tsx') === 'src/deep/X.tsx');
} finally { rmSync(tmp, { recursive: true, force: true }); }

// ── 3. 真仓 ──────────────────────────────────────────────────────────────────────────────────
const root = fileURLToPath(new URL('..', import.meta.url));
const files = collect(root);
ck(`collect: real tree has App.tsx + ≥ 200 source files (${files.size})`, files.has('App.tsx') && files.size >= 200);
const { findings: siteFindings, counts } = judgeSites(files);
for (const s of PHONE_ONLY_SITES) ck(`collect: ${s.name} — ${counts.get(s.name)} site(s) ≥ ${s.minSites}`, (counts.get(s.name) ?? 0) >= s.minSites);
const all = [...siteFindings, ...judgeCopy(files), ...judgeRefreshAndSwipe(files)];
const debts = all.filter(f => f.debt);
const real = all.filter(f => !f.debt);
for (const f of debts) console.log(`DEBT: ${f.file}:${f.line} ${f.detail} [${f.debt}]`);
for (const f of real) console.log(`  ✗ ${f.kind} ${f.file}:${f.line} ${f.detail}`);
ck(`real tree: 0 phone-only leaks outside the named debt (${real.length} found, ${debts.length} debt)`, real.length === 0);

// ── 4. 见证:把真实文件里一处带判定的长按去掉判定,门必须红 ────────────────────────────────────
const chat = files.get('src/ChatScreen.tsx') ?? '';
const gated = 'onLongPress={pointer ? undefined : () => setMenuFor(';
ck('witness: ChatScreen carries the gated long-press the witness mutates', chat.includes(gated));
const mutated = new Map(files); mutated.set('src/ChatScreen.tsx', chat.replace(gated, 'onLongPress={() => setMenuFor('));
const w = judgeAll(mutated).filter(f => !f.debt && f.kind === 'site' && f.file === 'src/ChatScreen.tsx');
ck(`witness: dropping that gate turns the real tree red (${w.length} finding at ChatScreen.tsx:${w[0]?.line})`, w.length === 1);
const picker = files.get('src/HostSupervisorPickerScreen.tsx') ?? '';
const mutatedCopy = new Map(files); mutatedCopy.set('src/HostSupervisorPickerScreen.tsx', picker.replace("${pointer ? '点右上角「刷新」' : '下拉刷新'}", '下拉刷新'));
ck('witness: un-gating the picker copy turns it red', judgeAll(mutatedCopy).some(f => f.kind === 'copy' && f.file === 'src/HostSupervisorPickerScreen.tsx' && !f.debt));

// ── 5. pointerUi ──────────────────────────────────────────────────────────────────────
const g = globalThis as any;
const saved = { tauri: g.__TAURI_INTERNALS__, nav: Object.getOwnPropertyDescriptor(globalThis, 'navigator') };
const setUa = (ua: string) => Object.defineProperty(globalThis, 'navigator', { value: { userAgent: ua }, configurable: true, writable: true });
try {
  delete g.__TAURI_INTERNALS__; setUa('Mozilla/5.0 (Windows NT 10.0) AppleWebKit Chrome');
  ck('pointerUi: plain web / native → false', pointerUi() === false);
  ck('pointerUi: desktop layout → true', pointerUi(true) === true);
  g.__TAURI_INTERNALS__ = {};
  ck('pointerUi: Tauri shell at any width → true', pointerUi() === true && pointerUi(false) === true);
  setUa('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit Chrome Mobile');
  ck('pointerUi: Android UA (web-export phone fixture) → false even with the Tauri stub', pointerUi() === false);
} finally {
  if (saved.tauri === undefined) delete g.__TAURI_INTERNALS__; else g.__TAURI_INTERNALS__ = saved.tauri;
  if (saved.nav) Object.defineProperty(globalThis, 'navigator', saved.nav); else delete g.navigator;
}

console.log(`\n${p}/${t} passed`);
if (p !== t) (globalThis as any).process.exit(1);
