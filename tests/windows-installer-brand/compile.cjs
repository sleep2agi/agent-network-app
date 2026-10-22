// Actual full locked NSIS template + real compiler; inert payload, never install.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const Handlebars = require('/usr/share/nodejs/handlebars');
assert(fs.existsSync('/.dockerenv'), 'Docker only');
const root = '/app';
process.chdir('/fixture');
function run(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', timeout: 120000 });
  assert.equal(result.status, 0, `${cmd}: ${result.error || ''}\n${result.stdout}\n${result.stderr}`);
}
// Generate the same icon that every desktop workflow prepares before bundling.
run('/app/node_modules/.bin/tauri', ['icon', '/app/assets/icon.png', '--output', '/app/src-tauri/icons']);
const config = JSON.parse(fs.readFileSync(`${root}/src-tauri/tauri.conf.json`));
const nsis = config.bundle.windows.nsis;
const path = value => `${root}/src-tauri/${value}`;
fs.writeFileSync('payload.nsi', 'Unicode true\nName "inert test payload"\nOutFile "agent-network-desktop.exe"\nSilentInstall silent\nSection\nSectionEnd\n');
run('makensis', ['-V2', 'payload.nsi']);
const values = {
  compression: 'lzma', manufacturer: 'vansin', version_with_build: `${config.version}.0`,
  version: config.version, product_name: config.productName, install_mode: 'currentUser',
  main_binary_name: 'agent-network-desktop', main_binary_path: '/fixture/agent-network-desktop.exe',
  bundle_id: config.identifier, arch: 'x64', additional_plugins_path: '/fixture/plugins',
  allow_downgrades: 'true', install_webview2_mode: 'skip', estimated_size: 1,
  languages: ['English'], language_files: ['English.nsh'],
  installer_icon: path(nsis.installerIcon), uninstaller_icon: path(nsis.uninstallerIcon),
  header_image: path(nsis.headerImage), uninstaller_header_image: path(nsis.uninstallerHeaderImage),
  sidebar_image: path(nsis.sidebarImage), out_file: '/fixture/TEST-ONLY-branded-installer.exe',
};
for (const key of ['installer_icon', 'uninstaller_icon', 'header_image', 'uninstaller_header_image', 'sidebar_image']) {
  assert(fs.statSync(values[key]).size > 0, `${key} available to the real compiler`);
}
const template = fs.readFileSync(path(nsis.template), 'utf8');
assert(template.includes('!define INSTALLIDENTITY "Agent Network"'));
fs.writeFileSync('branded.nsi', Handlebars.compile(template, { noEscape: true })(values));
run('makensis', ['-V3', 'branded.nsi']);
const exe = fs.readFileSync(values.out_file);
assert.equal(exe.subarray(0, 2).toString(), 'MZ');
assert(exe.length > 10000);
console.log(`PASS complete unchanged NSIS template compiled with actual branded icons/BMPs: ${exe.length} bytes TEST ONLY`);
