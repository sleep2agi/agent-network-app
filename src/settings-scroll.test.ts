import fs from 'node:fs';
import path from 'node:path';

// Windows checkouts convert line endings, so the assertions below read a
// normalised copy rather than whatever the clone produced.
const source = fs
  .readFileSync(path.join(process.cwd(), 'src/SettingsScreen.tsx'), 'utf8')
  .replace(/\r\n?/g, '\n');

const check = (name: string, ok: boolean) => {
  if (!ok) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
};

// 0.2.79 and earlier returned `<View style={styles.root}>` and never imported
// ScrollView, so every row below the window fold was unreachable — Vincent hit
// it on the 通知 section (2026-09-19). The screen has no fixed-height child of
// its own, so the whole body scrolls.
check(
  'SettingsScreen imports ScrollView from react-native',
  /import \{[^}]*\bScrollView\b[^}]*\} from 'react-native'/.test(source),
);
check(
  'settings body is wrapped in a ScrollView with a content container',
  /<ScrollView[\s\S]{0,200}contentContainerStyle=\{styles\.content\}/.test(source),
);

// Padding has to sit on the content container, not the scroll root: on a scroll
// root the bottom padding is outside the scrollable area, which is exactly how a
// last row keeps hiding under the window edge even after a ScrollView is added.
check(
  'scroll root carries no padding',
  /root:\s*\{[^}]*\}/.test(source) && !/root:\s*\{[^}]*padding[^}]*\}/.test(source),
);
check(
  'content container carries the padding, with extra room at the bottom',
  /content:\s*\{[^}]*padding:\s*spacing\.lg[^}]*paddingBottom:\s*spacing\.xl\s*\*\s*2[^}]*\}/.test(source),
);

// Both confirm dialogs are siblings of the scroll view, not children of it: a
// Modal nested inside a ScrollView inherits the scroll container's touch
// handling, and its backdrop stops filling the window.
const scrollClose = source.lastIndexOf('</ScrollView>');
check(
  'confirm modals stay outside the ScrollView',
  scrollClose > 0 &&
    source.indexOf('<Modal visible={!!removeTarget}') > scrollClose &&
    source.indexOf('<Modal visible={localDeleteVisible}') > scrollClose,
);

console.log('settings-scroll contract ok');
