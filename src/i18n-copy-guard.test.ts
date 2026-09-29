import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

let p = 0, t = 0;
const ck = (name: string, ok: boolean) => { t++; if (ok) p++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`); };
// Expand this explicit migration boundary as additional surfaces are translated.
const migrated = ['src/MobileNavRail.tsx', 'src/ServerSidebar.tsx', 'src/ChatScreen.tsx', 'src/ChatInfoPanel.tsx', 'src/ComposerRowParts.tsx', 'src/VoiceInputUI.tsx', 'src/DesktopVoiceBar.tsx'];
function untranslated(file: string, raw: string): string[] {
  const source = raw.replace(/\r\n?/g, '\n');
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const lines = source.split('\n');
  const failures: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      if (/\p{Script=Han}/u.test(node.text)) {
        const line = tree.getLineAndCharacterOfPosition(node.getStart(tree)).line;
        // Only a reasoned adjacent comment can waive a data/protocol literal.
        const allowed = /\/\/ i18n-allow: \S.+/.test(lines[line - 1] || '');
        if (!allowed) failures.push(`${file}:${line + 1} ${node.text.trim().slice(0, 60)}`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return failures;
}
ck('reject JSX Chinese', untranslated('x.tsx', '<Text>发送</Text>').length === 1);
ck('reject Chinese accessibility copy', untranslated('x.tsx', '<View accessibilityLabel="返回" />').length === 1);
ck('ignore explanatory comments', untranslated('x.tsx', '// 中文说明\nconst x = "key";').length === 0);
ck('reasoned data exception and CRLF', untranslated('x.tsx', '// i18n-allow: protocol marker, not UI\r\nconst x = "附件";').length === 0);
ck('reason-free exception is not accepted', untranslated('x.tsx', '// i18n-allow:\nconst x = "发送";').length === 1);
ck('scope paths are POSIX', migrated.every(file => file === path.posix.normalize(file) && !file.includes('\\')));
for (const file of migrated) {
  const failures = untranslated(file, readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
  ck(`${file} contains no untranslated UI literals${failures.length ? '\n' + failures.join('\n') : ''}`, failures.length === 0);
}
// App also contains login/onboarding, intentionally outside this first migration.
// Still scan every navigation definition instead of silently exempting the whole file.
const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const navigation = [...app.matchAll(/const (?:DESKTOP_TABS|MOBILE_TABS|MOBILE_RAIL_TABS) = \[([\s\S]*?)\] as const;/g)];
ck('all three App navigation definitions are guarded', navigation.length === 3 && navigation.every(match => untranslated('App.tsx', match[0]).length === 0));
console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
