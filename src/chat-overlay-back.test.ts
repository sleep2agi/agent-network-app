// ck-style (self-executing; run by scripts/run-tests.mjs). Android back / edge
// swipe must close whatever overlay is on top of the chat before it leaves the chat.
//
// 2026-09-26 owner report: 「打开一个图片之后，之前那个返回手势是没有」. The image
// preview was `<Modal visible={!!viewerUri} transparent animationType="fade">` with
// no onRequestClose. RN's Android Modal is a Dialog whose OnBackPressedCallback
// consumes back and only forwards it as onRequestClose — without that prop, back
// does nothing and a BackHandler subscription never sees it either. (Same prop is
// how react-native-web routes Esc, so the desktop Esc was dead too.)
//
// Two layers, checked separately (CLAUDE.md ⑤):
//   collect — every `<Modal` under src/, recursively, parsed as a JSX tag;
//   judge   — each has a non-empty onRequestClose, and the chat overlays' handlers
//             actually clear the state that shows them.
import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

let ck = 0;
const check = (cond: boolean, msg: string) => { assert.ok(cond, msg); ck++; };

/** Every `<Modal …>` opening tag, brace-aware (`=>` inside `{}` is not the end). */
export function modalTags(src: string): string[] {
  const out: string[] = [];
  const re = /<Modal\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let depth = 0;
    let i = m.index + 1;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    out.push(src.slice(m.index, i + 1));
  }
  return out;
}
const closeHandler = (tag: string): string | null => {
  const m = /onRequestClose=\{/.exec(tag);
  if (!m) return null;
  let depth = 1;
  let i = m.index + m[0].length;
  const start = i;
  for (; i < tag.length && depth > 0; i++) {
    if (tag[i] === '{') depth++;
    else if (tag[i] === '}') depth--;
  }
  return tag.slice(start, i - 1).trim();
};
const isNoop = (h: string) => /^\(\)\s*=>\s*(\{\s*\}|undefined|null)$/.test(h) || h === 'undefined';

// ── judge self-test: feed it known positives/negatives first ──────────────
{
  const bad = modalTags('<Modal visible={!!x} transparent animationType="fade">\n<View/></Modal>');
  check(bad.length === 1 && closeHandler(bad[0]) === null, 'self-test: the pre-fix image preview tag is flagged (no onRequestClose)');
  const arrow = modalTags('<Modal visible={a && b > 0} onRequestClose={() => { if (x > 1) close(); }}>');
  check(arrow.length === 1 && closeHandler(arrow[0]) === '() => { if (x > 1) close(); }', 'self-test: `>` inside braces does not end the tag');
  const noop = modalTags('<Modal visible onRequestClose={() => {}}>');
  check(isNoop(closeHandler(noop[0])!), 'self-test: an empty handler counts as missing');
  check(modalTags('<ModalHeader>').length === 0, 'self-test: <ModalHeader> is not a Modal');
}

// ── collect: all .tsx under src/, recursively ──────────────────────────────
const srcDir = fileURLToPath(new URL('.', import.meta.url));
const walk = (dir: string): string[] => readdirSync(dir).flatMap(e => {
  const p = join(dir, e);
  if (statSync(p).isDirectory()) return e === 'node_modules' ? [] : walk(p);
  return e.endsWith('.tsx') ? [p] : [];
});
const files = walk(srcDir);
const rel = (p: string) => p.slice(srcDir.length);
const tagsByFile = new Map<string, string[]>();
for (const f of files) {
  const tags = modalTags(readFileSync(f, 'utf8'));
  if (tags.length) tagsByFile.set(rel(f), tags);
}
const total = [...tagsByFile.values()].reduce((n, t) => n + t.length, 0);
check(total >= 15, `collect: found ${total} <Modal> tags (a scope regression would make this pass at 0)`);
for (const f of ['ChatScreen.tsx', 'ImageViewer.tsx', 'SelectTextSheet.tsx', 'SideThreadDrawer.tsx', 'NodeRulesSection.tsx']) {
  check(tagsByFile.has(f), `collect: chat overlay file ${f} is in the scanned set`);
}

// Desktop-only (Tauri) update prompt: not reachable on Android. Listed so the
// exemption is explicit; if it disappears the allowlist must shrink with it.
const ALLOW_NO_CLOSE = new Set(['DesktopUpdatePrompt.tsx']);
for (const f of ALLOW_NO_CLOSE) check(tagsByFile.has(f), `allowlist entry ${f} still has a Modal (stale allowlist otherwise)`);

// ── judge: every Modal answers back ────────────────────────────────────────
for (const [f, tags] of tagsByFile) {
  if (ALLOW_NO_CLOSE.has(f)) continue;
  tags.forEach((tag, i) => {
    const h = closeHandler(tag);
    check(!!h && !isNoop(h), `${f} Modal #${i + 1} has a real onRequestClose (Android back): ${tag.slice(0, 80).replace(/\s+/g, ' ')}`);
  });
}

// ── judge: chat overlays close the right thing ─────────────────────────────
const read = (f: string) => readFileSync(join(srcDir, f), 'utf8').replace(/\r\n?/g, '\n');
const chat = read('ChatScreen.tsx');
const chatTags = tagsByFile.get('ChatScreen.tsx')!;
const handlerFor = (visibleNeedle: string) => {
  const tag = chatTags.find(t => t.includes(visibleNeedle));
  assert.ok(tag, `ChatScreen Modal with ${visibleNeedle} exists`);
  return closeHandler(tag!) ?? '';
};
check(/setHeaderMoreOpen\(false\)/.test(handlerFor('headerMoreOpen')), 'header ··· sheet: back closes it');
check(/setMenuFor\(null\)/.test(handlerFor('!!menuFor')), 'long-press menu: back closes it');
check(/setExpandFor\(null\)/.test(handlerFor('!!expandFor')), '放大阅读: back closes it');
check(/setForwardFor\(null\)/.test(handlerFor('!!forwardFor')), '转发 picker: back closes it');
check(/setPlusMenuOpen\(false\)/.test(handlerFor('plusMenuOpen')), 'desktop + popover: back/Esc closes it');

// Image preview — the reported bug.
const viewer = read('ImageViewer.tsx');
const viewerTags = modalTags(viewer);
check(viewerTags.length === 1 && closeHandler(viewerTags[0]) === 'onClose', 'image preview Modal: onRequestClose={onClose}');
check(/<ImageViewer\b[^>]*onClose=\{\(\) => setViewer\(null\)\}/.test(chat), 'ChatScreen: preview onClose clears the viewer state');
check(!/<Modal visible=\{!!viewerUri\}/.test(chat), 'the old inline preview Modal is gone');
check(/visible=\{visible\}/.test(viewerTags[0]) && /const visible = !!state && count > 0/.test(viewer), 'preview visibility follows the state ChatScreen clears');

// 选择文本 sheet.
const selectTags = modalTags(read('SelectTextSheet.tsx'));
check(selectTags.length === 1 && closeHandler(selectTags[0]) === 'onClose', '选择文本 sheet: onRequestClose={onClose}');
check(/<SelectTextSheet[\s\S]*?onClose=\{\(\) => setSelectTextFor\(null\)\}/.test(chat), 'ChatScreen: 选择文本 onClose clears selectTextFor');

// Side drawer (BTW).
const drawer = read('SideThreadDrawer.tsx');
const drawerTags = modalTags(drawer);
check(drawerTags.length === 1 && closeHandler(drawerTags[0]) === 'closeDrawer', 'side drawer: onRequestClose={closeDrawer}');
check(/const closeDrawer = useCallback\(\(\) => \{\s*setVisible\(false\)/.test(drawer), 'closeDrawer hides the drawer');

// Fullscreen rules editor.
const rulesTags = modalTags(read('NodeRulesSection.tsx'));
check(rulesTags.length >= 1 && rulesTags.every(t => closeHandler(t) === 'onClose'), 'fullscreen rules: onRequestClose={onClose}');

// Inline (non-Modal) overlays: a BackHandler subscription while open that consumes back.
check(/if \(!plusMenuOpen \|\| desktop \|\| Platform\.OS !== 'android'\) return;\s*const sub = BackHandler\.addEventListener\('hardwareBackPress', \(\) => plusEvent\('back'\)\);\s*return \(\) => sub\.remove\(\);/.test(chat), '+ panel (inline): back closes it first, unsubscribes on close');
check(/if \(!searchOpen \|\| Platform\.OS !== 'android'\) return;\s*const sub = BackHandler\.addEventListener\('hardwareBackPress', \(\) => \{ closeSearch\(\); return true; \}\);\s*return \(\) => sub\.remove\(\);/.test(chat), 'search bar (inline): back closes it first, unsubscribes on close');

// Desktop keys on the preview: arrows via the model; Esc through onRequestClose (RNW).
check(/viewerKeyAction\(event\.key\)/.test(viewer) && /action === 'prev' \|\| action === 'next'/.test(viewer), 'preview: ←/→ handled via viewerKeyAction');

console.log(`chat overlay back: ${ck}/${ck} checks passed`);
