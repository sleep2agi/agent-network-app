// Source/config contracts only. Real installer upgrade is a separate validation.
import { readFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), 'utf8').replace(/\r\n/g, '\n');
const config = JSON.parse(read('src-tauri/tauri.conf.json'));
const script = read('src-tauri/windows/vendor/installer.tauri-2.11.2.nsi');
let passed = 0, total = 0;
function ck(label: string, ok: boolean) {
  total++;
  if (ok) passed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
}
// Expand only identity defines, not an NSIS runtime emulator.
function identity(source: string, display: string) {
  const values: Record<string, string> = {};
  for (const [, key, raw] of source.matchAll(/^!define (\w+) "([^"]*)"/gm)) {
    values[key] = raw.replace('{{product_name}}', display).replace('{{manufacturer}}', 'Example')
      .replace(/\$\{(\w+)\}/g, (_, name) => values[name] ?? `<missing:${name}>`);
  }
  return values;
}
for (const display of ['Agent Network', 'ANet']) {
  const d = identity(script, display);
  ck(`${display}: uninstall key keeps original identity`, d.UNINSTKEY === 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Agent Network');
  ck(`${display}: custom directory lookup keeps original identity`, d.MANUPRODUCTKEY === 'Software\\Example\\Agent Network');
  ck(`${display}: display name remains independent`, d.PRODUCTNAME === display);
}
ck('Tauri selects the adapted template', config.bundle.windows.nsis.template === './windows/vendor/installer.tauri-2.11.2.nsi');
ck('renamed product uses the stable installer identity', config.productName === 'ANet' && identity(script, config.productName).INSTALLIDENTITY === 'Agent Network');
const defaults = [...script.matchAll(/StrCpy \$INSTDIR "\$(?:PROGRAMFILES64|PROGRAMFILES|LOCALAPPDATA)\\([^\"]+)"/g)].map(m => m[1]);
ck('all default installation paths keep original identity', defaults.length === 5 && defaults.every(s => s === '${INSTALLIDENTITY}'));
ck('multiuser default keeps original identity', script.includes('!define MULTIUSER_INSTALLMODE_INSTDIR "${INSTALLIDENTITY}"'));
const restore = script.match(/Function RestorePreviousInstallLocation\n([\s\S]*?)FunctionEnd/)?.[1] ?? '';
ck('custom install directory is restored from the original registry key', restore.includes('ReadRegStr $4 SHCTX "${MANUPRODUCTKEY}" ""') && restore.includes('StrCpy $INSTDIR $4'));
ck('legacy MSI display name remains recognized', script.includes('${AndIf} "$R0$R1" != "${INSTALLIDENTITY}${MANUFACTURER}"'));
const migrate = script.match(/!macro ANET_MIGRATE_SHORTCUT DIRECTORY\n([\s\S]*?)!macroend/)?.[1] ?? '';
ck('shortcut migration checks the exact target and avoids an existing destination', migrate.includes('${IfNot} ${FileExists} "${DIRECTORY}\\${PRODUCTNAME}.lnk"') && migrate.includes('!insertmacro IsShortcutTarget "${DIRECTORY}\\${INSTALLIDENTITY}.lnk" "$INSTDIR\\${MAINBINARYNAME}.exe"') && /Pop \$0\s+\$\{If\} \$0 = 1\s+Rename/.test(migrate));
ck('desktop and both start-menu locations use the same migration', (script.match(/!insertmacro ANET_MIGRATE_SHORTCUT /g) ?? []).length === 3);
// A removed legacy-key binding must break the contract, even though display changes still work.
const mutated = script.replace('!define INSTALLIDENTITY "Agent Network"', '!define INSTALLIDENTITY "{{product_name}}"');
ck('mutation: display-derived identity is rejected', identity(mutated, 'ANet').UNINSTKEY !== identity(script, 'ANet').UNINSTKEY);
console.log(`${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
