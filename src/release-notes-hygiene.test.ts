// The desktop release workflow's `releaseBody` is not an internal note:
// tauri-action copies it verbatim into latest.json `notes`, and the in-app
// updater renders those notes to end users. v0.2.30 shipped
// "Publish this draft only after installation smoke tests pass." — a release
// instruction addressed to us, displayed to every user seeing the update
// prompt. This test keeps release discipline in docs/desktop-release-sop.md
// and keeps the notes user-facing.
import fs from 'node:fs';

const workflowPath = new URL(
  '../.github/workflows/release-desktop-auto-update.yml',
  import.meta.url,
);
const workflow = fs.readFileSync(workflowPath, 'utf8').replace(/\r\n?/g, '\n');

// Fail closed: a renamed key or a deleted step must red this test rather than
// silently assert nothing (the `0/0 passed` trap scripts/run-tests.mjs exists
// to prevent, one level down).
const bodyLine = /^(\s*)releaseBody:[ \t]*(.*)$/m.exec(workflow);
if (!bodyLine) {
  throw new Error(
    'FAIL: no `releaseBody:` in .github/workflows/release-desktop-auto-update.yml — ' +
      'the updater notes are unguarded (key renamed or step removed?)',
  );
}

const [, indent, inlineValue] = bodyLine;
const readBlockScalar = (): string => {
  // `releaseBody: >-` / `|` etc. — collect the more-indented lines that follow.
  const rest = workflow.slice(bodyLine.index + bodyLine[0].length + 1).split('\n');
  const lines: string[] = [];
  for (const line of rest) {
    if (line.trim() === '') continue;
    if (line.length - line.trimStart().length <= indent.length) break;
    lines.push(line.trim());
  }
  return lines.join(' ');
};

const releaseBody = /^[|>][-+]?\d*$/.test(inlineValue.trim())
  ? readBlockScalar()
  : inlineValue.trim().replace(/^['"]|['"]$/g, '');

if (releaseBody === '') {
  throw new Error('FAIL: releaseBody is empty — users would see blank update notes');
}

// Words that only make sense to whoever runs the release. `draft` and
// `publish` describe the maintainer's GitHub workflow; `smoke test` names an
// internal gate; "only after" is the instruction shape itself.
const internalInstructions: Array<[string, RegExp]> = [
  ['no "draft" (the GitHub draft state is ours, not the user\'s)', /\bdrafts?\b/i],
  ['no "publish" (publishing is a maintainer action)', /\bpublish(ing|ed|es)?\b/i],
  ['no "smoke test" (internal gate name)', /\bsmoke\b/i],
  ['no "only after ..." instruction shape', /\bonly after\b/i],
];

const userFacingContent: Array<[string, RegExp]> = [
  ['names the update as signed', /\bsigned\b/i],
  ['names macOS', /\bmacOS\b/],
  ['names Windows', /\bWindows\b/],
  ['describes an update', /\bupdates?\b/i],
];

const checks: Array<[string, boolean]> = [
  ...internalInstructions.map(
    ([name, pattern]) => [name, !pattern.test(releaseBody)] as [string, boolean],
  ),
  ...userFacingContent.map(
    ([name, pattern]) => [name, pattern.test(releaseBody)] as [string, boolean],
  ),
];

console.log(`releaseBody = ${releaseBody}`);
for (const [name, ok] of checks) {
  if (!ok) {
    throw new Error(
      `FAIL: ${name} — release discipline belongs in docs/desktop-release-sop.md, ` +
        'not in notes shipped to users',
    );
  }
  console.log(`PASS: ${name}`);
}
