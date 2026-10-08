// Full upstream/candidate templates, real NSIS compiler and Wine registry/files.
// The payload is deliberately inert: this is installer compatibility, not app E2E.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const Handlebars = require('/usr/share/nodejs/handlebars');
assert(fs.existsSync('/.dockerenv'), 'Docker only');
function run(cmd, args, env = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 120000,
    env: { ...process.env, ...env }, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(r.status, 0, `${cmd} ${args.join(' ')}: ${r.error || ''}\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}
fs.writeFileSync('payload.nsi', 'Unicode true\nName "inert test payload"\nOutFile "agent-network-desktop.exe"\nSilentInstall silent\nSection\nSectionEnd\n');
run('makensis', ['-V2', 'payload.nsi']);
const common = { compression: 'lzma', manufacturer: 'vansin', version_with_build: '0.2.227.0',
  install_mode: 'currentUser', main_binary_name: 'agent-network-desktop',
  main_binary_path: '/fixture/agent-network-desktop.exe', bundle_id: 'top.vansin.agentnetwork.desktop',
  arch: 'x64', additional_plugins_path: '/fixture/plugins', allow_downgrades: 'true',
  install_webview2_mode: 'skip', estimated_size: 1, languages: ['English'],
  language_files: ['English.nsh'] };
for (const [kind, template, name, version] of [
  ['old', 'installer.nsi', 'Agent Network', '0.2.226'],
  ['new', 'template.nsi', 'ANet', '0.2.227'],
]) {
  let source = fs.readFileSync(template, 'utf8');
  if (kind === 'new' && process.argv.includes('--mutate-identity')) {
    assert(source.includes('!define INSTALLIDENTITY "Agent Network"'));
    source = source.replace('!define INSTALLIDENTITY "Agent Network"', '!define INSTALLIDENTITY "{{product_name}}"');
  }
  const rendered = Handlebars.compile(source, { noEscape: true })({
    ...common, product_name: name, version, out_file: `${kind}.exe`,
  });
  fs.writeFileSync(`${kind}.nsi`, rendered);
  run('makensis', ['-V2', `${kind}.nsi`]);
  console.log(`COMPILED ${kind}: complete ${template}`);
}
for (const custom of [false, true]) {
  const prefix = `/tmp/nsis-${custom ? 'custom' : 'default'}`;
  fs.mkdirSync(prefix);
  const env = { WINEPREFIX: prefix };
  const wine = (...args) => run('wine', args, env);
  console.log(`START ${custom ? 'custom' : 'default'} upgrade`);
  wine('wineboot', '-u');
  // Wine links every prefix's Desktop to the same Unix directory by default.
  // Make this disposable prefix private, otherwise the preceding case's ANet
  // shortcut correctly prevents migration in the second case.
  const desktop = `${prefix}/drive_c/users/root/Desktop`;
  if (fs.lstatSync(desktop).isSymbolicLink()) {
    fs.unlinkSync(desktop);
    fs.mkdirSync(desktop);
  }
  // NSIS requires /D= to be last and unquoted, including spaces in the path.
  if (custom) wine('cmd', '/c', 'Z:\\fixture\\old.exe /S /D=C:\\Chosen ANet Directory');
  else wine('Z:\\fixture\\old.exe', '/S');
  const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Agent Network';
  const before = wine('reg', 'query', key, '/v', 'InstallLocation');
  const location = before.match(/REG_SZ\s+"(.*)"/)[1];
  assert(custom ? location === 'C:\\Chosen ANet Directory' : location.endsWith('\\Agent Network'), `old fixture install location: ${location}`);
  const data = `${prefix}/drive_c/users/root/AppData/Roaming/top.vansin.agentnetwork.desktop`;
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(`${data}/account-sentinel`, 'retain-fixture-not-real-credentials');
  wine('Z:\\fixture\\new.exe', '/S', '/UPDATE');
  assert(wine('reg', 'query', key, '/v', 'DisplayName').includes('ANet'), 'existing uninstall identity must be updated');
  assert(wine('reg', 'query', key, '/v', 'DisplayVersion').includes('0.2.227'));
  assert(wine('reg', 'query', key, '/v', 'InstallLocation').includes(location));
  const all = wine('reg', 'query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall');
  assert(!all.split(/\r?\n/).some(line => line.trim().endsWith('\\ANet')), 'no second uninstall identity');
  assert.equal(fs.readFileSync(`${data}/account-sentinel`, 'utf8'), 'retain-fixture-not-real-credentials');
  assert(fs.existsSync(`${desktop}/ANet.lnk`), 'new shortcut exists');
  assert(!fs.existsSync(`${desktop}/Agent Network.lnk`), 'legacy shortcut migrated');
  console.log(`PASS ${custom ? 'custom' : 'default'}: same directory, one uninstall key, shortcut migrated, data retained`);
}
