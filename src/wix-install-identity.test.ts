// #807 template contract. Actual installation is tested separately on Windows.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../src-tauri/windows/vendor/main.tauri-2.11.2.wxs', import.meta.url), 'utf8');
assert.match(source, /<\?define InstallIdentity = "Agent Network" \?>/);
for (const id of ['PrevInstallDirNoName', 'PrevInstallDirWithName']) {
  const search = source.match(new RegExp(`<RegistrySearch Id="${id}"[^>]+>`))![0];
  assert(search.includes('$(var.InstallIdentity)'), `${id} must search the legacy install key`);
  assert(!search.includes('{{product_name}}'), `${id} must not depend on display name`);
}
assert(source.includes('Name="InstallDir" Type="string" Value="[INSTALLDIR]"'));
assert(source.includes('<RegistryKey Root="HKCU" Key="Software\\\\{{manufacturer}}\\\\$(var.InstallIdentity)">'));
for (const id of ['INSTALLDIR', 'ApplicationProgramsFolder']) {
  assert(source.includes(`<Directory Id="${id}" Name="$(var.InstallIdentity)"/>`));
}
assert(source.includes('Name="{{product_name}}"'), 'display name remains configurable');
const cleanup = source.match(/<Component Id="LegacyNamedShortcuts"[\s\S]*?<\/Component>/)![0];
assert(cleanup.includes('<Condition>WIX_UPGRADE_DETECTED</Condition>'));
assert.equal((cleanup.match(/<RemoveFile /g) || []).length, 3);
assert(!cleanup.includes('Name="*'), 'no wildcard deletion');
for (const name of ['Agent Network.lnk', 'Uninstall Agent Network.lnk']) assert(cleanup.includes(`Name="${name}"`));
console.log('PASS WiX legacy directory searches, persistence, defaults and bounded shortcut migration');
