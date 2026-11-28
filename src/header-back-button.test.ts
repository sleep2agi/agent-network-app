// Guard: screen headers use the vector Ionicons `chevron-back` inside a centered
// rounded icon button (neutral `colors.text`, subtle hover/pressed fill) rather
// than a bare blue Unicode `‹` text glyph with off-center font baseline.
// ck-style self-executing test. run: bun src/header-back-button.test.ts
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let p = 0, t = 0;
const ck = (name: string, cond: boolean, extra = '') => {
  t++;
  if (cond) { p++; console.log(`PASS: ${name}`); }
  else console.log(`FAIL: ${name}${extra ? ` (${extra})` : ''}`);
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(root, ...rel.split('/')), 'utf8').replace(/\r\n?/g, '\n');

const SCREENS = [
  'src/NodeDetailScreen.tsx',
  'src/DaemonManagementScreen.tsx',
  'src/ChatScreen.tsx',
  'src/DmChatScreen.tsx',
] as const;

for (const file of SCREENS) {
  const src = read(file);
  ck(`${file}: no bare Unicode <Text>‹</Text> back glyph`, !/>‹<\/Text>/.test(src));
  ck(`${file}: uses vector Ionicons chevron-back in neutral colors.text`,
    /<Ionicons name="chevron-back" size=\{20\} color=\{colors\.text\} \/>/.test(src));
  ck(`${file}: back button has subtle hover/pressed feedback`,
    src.includes('colors.rowActive') && src.includes('colors.rowHover'));
}

const nodeDetail = read('src/NodeDetailScreen.tsx');
const headerStart = nodeDetail.indexOf('const headerChrome = popoutHeaderChrome');
const headerEnd = nodeDetail.indexOf("if (state.kind === 'loading')", headerStart);
const nodeHeader = nodeDetail.slice(headerStart, headerEnd);
ck('NodeDetailScreen: header vertically centers 32x32 back button on minHeight 54',
  nodeHeader.includes('minHeight: 54') && nodeHeader.includes('width: 32') && nodeHeader.includes('height: 32') && nodeHeader.includes('borderRadius: radius.item'));
ck('NodeDetailScreen: macOS popout back button adds breathing room after traffic lights without disturbing non-mac inset',
  nodeHeader.includes("marginLeft: windowChrome === 'mac' ? 4 : 0"));

console.log(`\nheader-back-button: ${p}/${t} passed`);
if (p !== t) process.exit(1);
