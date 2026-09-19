import fs from 'node:fs';
import path from 'node:path';

// Windows checkouts convert line endings, so the assertions below read a
// normalised copy rather than whatever the clone produced.
const source = fs
  .readFileSync(path.join(process.cwd(), 'src/TasksScreen.tsx'), 'utf8')
  .replace(/\r\n?/g, '\n');

const check = (name: string, ok: boolean) => {
  if (!ok) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
};

// 0.2.79 and earlier rendered the four filter chips as full-height vertical
// pills on the desktop shell (Vincent, 2026-09-19). The row is a horizontal
// ScrollView inside `root: { flex: 1 }`; on react-native-web that element keeps
// the default flex-grow: 1, so it takes the pane's whole remaining height, and
// the content row's default align-items: stretch then stretches every chip to
// match. Measured in the harness: chip 361px tall, scroll container 385px.
//
// `flexGrow: 0` is the load-bearing half and it has to sit on the ScrollView's
// `style`, not its `contentContainerStyle` — those are two different elements.
// Measured, one property at a time, on the same running build:
//   baseline                    chip 361px, container 385px
//   contentContainer centered   chip  31px, container 385px  ← chip fixed, 330px dead band left behind
//   ScrollView flexGrow: 0      chip  31px, container  55px  ← both fixed
// So centring the content alone would have looked fixed in a screenshot of the
// chips while still pushing the task list down the pane.
check(
  'filter ScrollView carries a style prop, not only a contentContainerStyle',
  /<ScrollView[\s\S]{0,240}style=\{styles\.filterScroll\}[\s\S]{0,240}contentContainerStyle=\{styles\.filterRow\}/.test(source) ||
    /<ScrollView[\s\S]{0,240}contentContainerStyle=\{styles\.filterRow\}[\s\S]{0,240}style=\{styles\.filterScroll\}/.test(source),
);
check(
  'filterScroll pins flexGrow: 0 so the row is sized by its content',
  /filterScroll:\s*\{[^}]*flexGrow:\s*0[^}]*\}/.test(source),
);
check(
  'the row stays horizontally scrollable for narrow widths',
  /<ScrollView[\s\S]{0,120}\bhorizontal\b/.test(source),
);
// A height cap would hide the symptom while leaving the cause: the container
// would still be a stretched flex child, and a taller chip (longer label, larger
// font) would clip instead of growing.
check(
  'the fix is not a hard-coded height on the filter row',
  !/filterScroll:\s*\{[^}]*\bheight:\s*\d/.test(source) &&
    !/filterRow:\s*\{[^}]*\bheight:\s*\d/.test(source),
);

console.log('tasks-filter-row-layout contract ok');
